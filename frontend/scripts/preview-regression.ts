import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

const HOST = "127.0.0.1";
const VITE_PORT = Number(Bun.env.VITE_PORT ?? 5176);
const DEBUG_PORT = Number(Bun.env.DEBUG_PORT ?? 9326);
const BASE_URL = `http://${HOST}:${VITE_PORT}`;
const ARTIFACT_DIR = join(import.meta.dir, "..", ".preview-artifacts");
const CHROME_PATH =
  Bun.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

interface CdpMessage {
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
}

class CdpSession {
  private id = 0;
  private pending = new Map<number, (value: CdpMessage) => void>();

  public constructor(private readonly ws: WebSocket) {
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as CdpMessage;
      if (message.id && this.pending.has(message.id)) {
        this.pending.get(message.id)?.(message);
        this.pending.delete(message.id);
      }
    });
  }

  public send(method: string, params: Record<string, unknown> = {}): Promise<CdpMessage> {
    const id = ++this.id;
    const payload = { id, method, params };
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for CDP ${method}`));
      }, 8_000);
      this.pending.set(id, (message) => {
        clearTimeout(timeout);
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message);
      });
      this.ws.send(JSON.stringify(payload));
    });
  }

  public close(): void {
    this.ws.close();
  }
}

const DEEP_TEXT_EXPR = String.raw`
(() => {
  const walk = (node) => {
    let text = "";
    if (node.nodeType === Node.TEXT_NODE) text += node.textContent || "";
    if (node.shadowRoot) text += " " + walk(node.shadowRoot);
    for (const child of node.childNodes || []) text += " " + walk(child);
    return text;
  };
  return walk(document.body).replace(/\s+/g, " ").trim();
})()
`;

async function waitFor(url: string, timeoutMs = 10_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {
      // Retry until the dev server or debugger endpoint is ready.
    }
    await Bun.sleep(150);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function openCdp(): Promise<CdpSession> {
  await waitFor(`http://${HOST}:${DEBUG_PORT}/json/version`, 20_000);
  const started = Date.now();
  let wsUrl = "";
  while (!wsUrl && Date.now() - started < 8_000) {
    const tabs = (await fetch(`http://${HOST}:${DEBUG_PORT}/json`).then((r) => r.json())) as Array<{
      type: string;
      url: string;
      webSocketDebuggerUrl: string;
    }>;
    wsUrl =
      tabs.find((tab) => tab.type === "page" && tab.url.startsWith(BASE_URL))
        ?.webSocketDebuggerUrl ?? "";
    if (!wsUrl) await Bun.sleep(150);
  }
  if (!wsUrl) throw new Error("Chrome did not expose the preview page as a debuggable tab");
  const ws = new WebSocket(wsUrl);
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve(), { once: true });
    ws.addEventListener("error", () => reject(new Error("Failed to connect to Chrome")), {
      once: true,
    });
  });
  const cdp = new CdpSession(ws);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  return cdp;
}

async function navigate(cdp: CdpSession, path: string): Promise<void> {
  await cdp.send("Page.navigate", { url: `${BASE_URL}${path}` });
  await Bun.sleep(900);
}

async function evaluate<T>(cdp: CdpSession, expression: string): Promise<T> {
  const response = await cdp.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  const result = response.result as { result?: { value?: T } };
  return result.result?.value as T;
}

async function openRoomEditSection(cdp: CdpSession, section: string): Promise<void> {
  await evaluate(
    cdp,
    `(async () => {
      const detail = document.querySelector("rs-room-detail");
      detail._editing = null;
      detail.requestUpdate("_editing");
      await detail.updateComplete;
      detail._editing = "${section}";
      detail.requestUpdate("_editing");
      await detail.updateComplete;
      await detail.shadowRoot.querySelector("rs-room-edit-dialog-router")?.updateComplete;
    })()`,
  );
  await Bun.sleep(500);
}

async function openAllDetails(cdp: CdpSession): Promise<void> {
  await evaluate(
    cdp,
    `(() => {
      const open = (root) => {
        for (const child of root.querySelectorAll("*")) {
          if (child.tagName === "DETAILS") child.open = true;
          if (child.shadowRoot) open(child.shadowRoot);
        }
      };
      open(document);
    })()`,
  );
}

async function screenshot(cdp: CdpSession, name: string, fullPage = false): Promise<void> {
  const response = await cdp.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: fullPage,
  });
  const result = response.result as { data: string };
  await Bun.write(join(ARTIFACT_DIR, `${name}.png`), Buffer.from(result.data, "base64"));
}

function assertIncludes(text: string, label: string): void {
  if (!text.includes(label)) {
    throw new Error(`Expected preview text to include "${label}". Text was: ${text.slice(0, 600)}`);
  }
}

async function waitForText(cdp: CdpSession, label: string, timeoutMs = 6_000): Promise<string> {
  const started = Date.now();
  let text = "";
  while (Date.now() - started < timeoutMs) {
    text = await evaluate<string>(cdp, DEEP_TEXT_EXPR);
    if (text.includes(label)) return text;
    await Bun.sleep(200);
  }
  const state = await evaluate<Record<string, unknown>>(
    cdp,
    `({
      href: location.href,
      readyState: document.readyState,
      body: document.body.innerHTML.slice(0, 300),
      appChildren: document.querySelector("#app")?.children.length ?? null,
      customElements: {
        settings: !!customElements.get("rs-settings"),
        detail: !!customElements.get("rs-room-detail")
      }
    })`,
  );
  console.log(`Preview state while waiting for "${label}": ${JSON.stringify(state)}`);
  assertIncludes(text, label);
  return text;
}

async function run(): Promise<void> {
  await mkdir(ARTIFACT_DIR, { recursive: true });
  const profileDir = join(ARTIFACT_DIR, "chrome-profile");
  await rm(profileDir, { recursive: true, force: true });

  const vite = Bun.spawn(
    ["bun", "--bun", "vite", "--host", HOST, "--port", String(VITE_PORT), "--strictPort"],
    {
      cwd: join(import.meta.dir, ".."),
      stdout: "ignore",
      stderr: "ignore",
    },
  );

  let chrome: ReturnType<typeof Bun.spawn> | undefined;

  try {
    await waitFor(`${BASE_URL}/dev/room-detail-preview.html`);
    console.log("Preview server ready");
    chrome = Bun.spawn(
      [
        CHROME_PATH,
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        `--remote-debugging-address=${HOST}`,
        `--remote-debugging-port=${DEBUG_PORT}`,
        `--user-data-dir=${profileDir}`,
        `${BASE_URL}/dev/room-detail-preview.html`,
      ],
      {
        stdout: "ignore",
        stderr: "ignore",
      },
    );
    const cdp = await openCdp();
    console.log("Chrome debugger ready");

    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 1200,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await navigate(cdp, "/dev/settings-preview.html");
    const settingsText = await waitForText(cdp, "Advanced control tuning");
    assertIncludes(settingsText, "MPC");
    assertIncludes(settingsText, "Comfort 70");
    assertIncludes(settingsText, "Optimizer strategy");
    assertIncludes(settingsText, "Horizon search");
    await openAllDetails(cdp);
    await screenshot(cdp, "settings-desktop", true);
    console.log("Settings preview checked");

    await navigate(cdp, "/dev/room-detail-preview.html");
    const detailText = await waitForText(cdp, "Primary sensor");
    assertIncludes(detailText, "Device setpoint");
    assertIncludes(detailText, "Configuration");
    await screenshot(cdp, "room-detail-desktop", true);
    console.log("Room detail desktop checked");

    await openRoomEditSection(cdp, "sensors");
    const sensorsText = await waitForText(cdp, "Temperature source priority");
    assertIncludes(sensorsText, "Humidity sensors");
    assertIncludes(sensorsText, "Changes save automatically");
    assertIncludes(sensorsText, "Done");
    await screenshot(cdp, "sensors-desktop");
    console.log("Sensors desktop checked");

    await openRoomEditSection(cdp, "comfort");
    const comfortText = await waitForText(cdp, "Advanced control constraints");
    assertIncludes(comfortText, "Night controls");
    await screenshot(cdp, "comfort-desktop");
    console.log("Comfort desktop checked");

    await openRoomEditSection(cdp, "airflow");
    const airflowText = await waitForText(cdp, "Behavior preferences");
    assertIncludes(airflowText, "Advanced modeling");
    await screenshot(cdp, "airflow-desktop");
    console.log("Airflow desktop checked");

    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 900,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await openRoomEditSection(cdp, "sensors");
    await waitForText(cdp, "Temperature source priority");
    const backdropBackground = await evaluate<string>(
      cdp,
      `(() => {
        const detail = document.querySelector("rs-room-detail");
        const router = detail?.shadowRoot?.querySelector("rs-room-edit-dialog-router");
        const dialog = router?.querySelector("rs-edit-dialog");
        const backdrop = dialog?.shadowRoot?.querySelector(".backdrop");
        return backdrop ? getComputedStyle(backdrop).backgroundColor : "";
      })()`,
    );
    if (backdropBackground !== "rgba(0, 0, 0, 0.54)") {
      throw new Error(`Expected themed dialog backdrop, got ${backdropBackground}`);
    }
    const topPath = await evaluate<string>(
      cdp,
      `(() => {
        const names = [];
        let root = document;
        let el = root.elementFromPoint(50, 150);
        while (el) {
          names.push(el.tagName.toLowerCase());
          if (!el.shadowRoot) break;
          root = el.shadowRoot;
          el = root.elementFromPoint(50, 150);
        }
        return names.join(">");
      })()`,
    );
    if (!topPath.includes("rs-sensor-section")) {
      throw new Error(`Expected dialog stack above room detail, got ${topPath}`);
    }
    await Bun.sleep(700);
    await screenshot(cdp, "sensors-mobile");
    console.log("Sensors mobile checked");

    await openRoomEditSection(cdp, "airflow");
    await screenshot(cdp, "airflow-mobile");
    await waitForText(cdp, "Airflow preference");
    console.log("Airflow mobile checked");

    await cdp.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-color-scheme", value: "dark" }],
    });
    await openRoomEditSection(cdp, "comfort");
    await waitForText(cdp, "Advanced control constraints");
    await screenshot(cdp, "comfort-mobile-dark");
    console.log("Comfort dark checked");
    cdp.close();
  } finally {
    chrome?.kill();
    vite.kill();
  }

  console.log(`Preview regression passed. Screenshots: ${ARTIFACT_DIR}`);
}

await run();
