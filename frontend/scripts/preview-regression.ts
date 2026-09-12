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
  const result = response.result as { result?: { value?: T }; exceptionDetails?: unknown };
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
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

async function checkGlobalSetback(cdp: CdpSession): Promise<void> {
  const result = await evaluate<{ saved: number; reloaded: string; invalidIgnored: boolean }>(
    cdp,
    `(async () => {
      const settings = document.querySelector("rs-settings");
      const control = settings.shadowRoot.querySelector("rs-settings-control");
      const field = [...control.shadowRoot.querySelectorAll("ha-textfield")]
        .find(field => field.label === "Default setback offset");
      field.value = "3.5";
      field.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 650));
      const saved = (await settings.hass.callWS({ type: "roommind/settings/get" })).settings.setback_offset;
      await settings._loadSettings();
      await settings.updateComplete;
      await control.updateComplete;
      const reloaded = field.value;
      field.value = "0";
      field.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 650));
      const invalidIgnored = (await settings.hass.callWS({ type: "roommind/settings/get" })).settings.setback_offset === saved;
      field.value = reloaded;
      return { saved, reloaded, invalidIgnored };
    })()`,
  );
  if (result?.saved !== 3.5 || result.reloaded !== "3.5" || !result.invalidIgnored) {
    throw new Error(`Global setback round-trip failed: ${JSON.stringify(result)}`);
  }
}

async function checkRoomSetback(cdp: CdpSession): Promise<void> {
  await openRoomEditSection(cdp, "devices");
  const result = await evaluate<{
    saved: number;
    reloaded: string;
    reset: number | null;
    inherited: string;
    disabled: boolean;
    invalidIgnored: boolean;
  }>(
    cdp,
    `(async () => {
      const detail = document.querySelector("rs-room-detail");
      const saved = [];
      const callWS = detail.hass.callWS;
      detail.hass = { ...detail.hass, callWS: async msg => {
        if (msg.type === "roommind/rooms/save") saved.push(structuredClone(msg));
        return callWS(msg);
      } };
      detail.globalSetbackOffset = 3;
      const router = detail.shadowRoot.querySelector("rs-room-edit-dialog-router");
      const devices = router.querySelector("rs-device-section");
      const settle = async () => {
        await detail.updateComplete;
        await router.updateComplete;
        await devices.updateComplete;
      };
      devices._selectedForEdit = devices.devices.find(device => device.type === "ac").entity_id;
      await settle();
      const idle = [...devices.shadowRoot.querySelectorAll("ha-select")]
        .find(field => field.label === "When idle");
      idle.dispatchEvent(new CustomEvent("selected", { detail: { value: "setback" } }));
      await settle();
      const checkbox = devices.shadowRoot.querySelector(".setback-inherit ha-checkbox");
      const field = [...devices.shadowRoot.querySelectorAll("ha-textfield")]
        .find(field => field.label === "Room setback offset");
      checkbox.checked = false;
      checkbox.dispatchEvent(new Event("change", { bubbles: true }));
      await settle();
      field.value = "3.5";
      field.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 650));
      const savedOffset = saved.at(-1).setback_offset;
      detail.config = { ...detail.config, ...saved.at(-1) };
      await settle();
      const reloaded = field.value;
      const count = saved.length;
      field.value = "0";
      field.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 650));
      const invalidIgnored = saved.length === count;
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 650));
      detail.globalSetbackOffset = 4;
      await settle();
      return { saved: savedOffset, reloaded, reset: saved.at(-1).setback_offset,
        inherited: field.value, disabled: field.disabled, invalidIgnored };
    })()`,
  );
  if (
    result?.saved !== 3.5 ||
    result.reloaded !== "3.5" ||
    result.reset !== null ||
    result.inherited !== "4.0" ||
    !result.disabled ||
    !result.invalidIgnored
  ) {
    throw new Error(`Room setback round-trip failed: ${JSON.stringify(result)}`);
  }
  await screenshot(cdp, "setback-desktop");
}

async function checkComfortFeedback(cdp: CdpSession): Promise<void> {
  const checks = await evaluate<Record<string, boolean>>(
    cdp,
    String.raw`(async () => {
      const detail = document.querySelector("rs-room-detail");
      const original = detail.config;
      const originalHass = detail.hass;
      const originalSnapshot = JSON.stringify(original);
      const hero = detail.shadowRoot.querySelector("rs-hero-status");
      const feedback = detail.shadowRoot.querySelector("rs-control-details");
      const panel = detail.shadowRoot.querySelector("rs-temperature-control-panel");
      const disclosure = feedback.shadowRoot.querySelector("details");
      const checks = {
        lazyDetails: !disclosure.open && !feedback.shadowRoot.querySelector(".body"),
        comfortFirst: !hero.shadowRoot.textContent.includes("Planned device setpoint"),
      };
      feedback.shadowRoot.querySelector("summary").click();
      await new Promise(resolve => setTimeout(resolve, 50));
      await feedback.updateComplete;
      checks.disclosureOpens = disclosure.open && !!feedback.shadowRoot.querySelector(".body");
      const observed = () => feedback.shadowRoot.querySelector(".observation").textContent;
      checks.observationSeparateFromPlan = observed().includes("20.5°C")
        && feedback.shadowRoot.querySelector(".operations").textContent.includes("21.5°C");
      let openedEntity = "";
      feedback.addEventListener("hass-more-info", event => { openedEntity = event.detail.entityId; }, { once: true });
      feedback.shadowRoot.querySelector("article button").click();
      checks.deviceMoreInfo = openedEntity === "climate.bedroom_radiator";

      const update = async patch => {
        detail.config = { ...detail.config, live: { ...detail.config.live, ...patch } };
        await detail.updateComplete;
        await Promise.all([hero.updateComplete, feedback.updateComplete, panel.updateComplete]);
      };
      await update({ observed_mode: null, observation_status: "unknown" });
      const before = observed();
      await update({
        device_actuation_status: original.live.device_actuation_status.map(operation => ({
          ...operation, application: "confirmed",
        })),
      });
      checks.confirmationIsNotActivity = hero.shadowRoot.querySelector(".mode-pill").textContent.includes("Device output unknown")
        && hero.shadowRoot.querySelector("ha-card").dataset.activity === "unknown";
      checks.confirmationKeepsObservation = observed() === before;
      checks.disclosureSurvivesUpdates = disclosure === feedback.shadowRoot.querySelector("details") && disclosure.open;
      checks.confirmedSettingsVisible = feedback.shadowRoot.querySelector(".operations").textContent.includes("Device confirmed settings");

      await update({
        override_active: true, override_type: "custom", override_temp: 19, override_until: null,
      });
      checks.overrideUsesLatestSnapshot = hero.shadowRoot.querySelector(".hero-target").textContent.includes("Custom");
      await update({});
      checks.overridePreservesEffectiveRange = hero.shadowRoot.querySelector(".hero-target-value").textContent.replace(/\s+/g, " ").trim() === "21.0 – 24.5°C";
      await update({
        current_temp_raw: null,
        device_actuation_status: original.live.device_actuation_status.map(operation => ({
          ...operation, dispatch: "failed", application: "confirmed",
        })),
      });
      checks.cachedTemperatureLabel = hero.shadowRoot.textContent.includes("Last known temperature");
      checks.failureVisibleWhenCollapsed = feedback.shadowRoot.querySelector("summary").textContent.includes("Dispatch failed");
      await update({
        device_actuation_status: [],
        night_control_status: [{ entity_id: "switch.beeper", role: "beeper", active: true, outcome: "unsupported" }],
      });
      checks.accessoryFailureVisible = feedback.shadowRoot.querySelector("summary").textContent.includes("Unsupported operation");

      const calls = [];
      detail.hass = {
        ...originalHass,
        config: { ...originalHass.config, unit_system: { temperature: "°F" } },
        callWS: async message => { calls.push(message); return { ok: true }; },
      };
      await update({
        ...original.live,
        device_actuation_status: original.live.device_actuation_status.map(operation => ({
          ...operation,
          ...(operation.service === "set_temperature" ? { temperature_unit: "°F", desired: { temperature: 70.7 } } : {}),
        })),
      });
      checks.fahrenheitObservation = observed().includes("68.9°F");
      checks.fahrenheitPlan = feedback.shadowRoot.querySelector(".operations").textContent.includes("70.7°F");
      const input = panel.shadowRoot.querySelector("input");
      input.value = "75.2";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await panel.updateComplete;
      panel.shadowRoot.querySelector(".action-button.primary").click();
      await new Promise(resolve => setTimeout(resolve, 50));
      checks.comfortWriteInCelsius = calls.some(message => message.type === "roommind/override/set" && Math.abs(message.temperature - 24) < 0.001);
      checks.editKeepsPhysicalObservation = observed().includes("68.9°F");
      checks.inputSnapshotUnchanged = JSON.stringify(original) === originalSnapshot;
      return checks;
    })()`,
  );
  for (const [name, passed] of Object.entries(checks)) {
    if (!passed)
      throw new Error("Comfort feedback regression failed: " + name + " " + JSON.stringify(checks));
  }
}

async function run(): Promise<void> {
  await mkdir(ARTIFACT_DIR, { recursive: true });
  const profileDir = join(ARTIFACT_DIR, "chrome-profile");
  await rm(profileDir, { recursive: true, force: true });

  const vite = Bun.spawn(
    [
      process.execPath,
      join(import.meta.dir, "..", "node_modules/vite/bin/vite.js"),
      "--host",
      HOST,
      "--port",
      String(VITE_PORT),
      "--strictPort",
    ],
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
    await navigate(cdp, "/dev/panel-preview.html");
    await waitForText(cdp, "Living room");
    const overviewChecks = await evaluate<Record<string, boolean>>(
      cdp,
      `(async () => {
        const panel = document.querySelector("roommind-panel");
        const areaId = Object.keys(panel._rooms)[0];
        const deviceCount = panel._computeAreaInfos().find(info => info.area.area_id === areaId).climateEntityCount;
        panel.hass = {
          ...panel.hass,
          entities: { ...panel.hass.entities, "climate.renamed_comfort": {
            entity_id: "climate.renamed_comfort", area_id: areaId, platform: "roommind",
          }},
        };
        panel._rooms = Object.fromEntries(Object.entries(panel._rooms).map(([id, config]) => [id, {
          ...config, live: { ...config.live, mode: "heating", observed_mode: null, observation_status: "unknown",
            window_open: false, mold_risk_level: "ok", learning_paused_reason: null },
        }]));
        await panel.updateComplete;
        const groups = [...panel.shadowRoot.querySelectorAll("h4")].map(heading => heading.textContent);
        const headline = panel.shadowRoot.querySelector("h2").textContent;
        const card = panel.shadowRoot.querySelector("rs-area-card");
        await card.updateComplete;
        const link = card.shadowRoot.querySelector("ha-card");
        const checks = {
          unknownIsNotAdjusting: !groups.includes("Adjusting now") && groups.includes("Monitoring"),
          unknownHeadline: headline.includes("awaiting device feedback"),
          ownEntityExcluded: panel._computeAreaInfos().find(info => info.area.area_id === areaId).climateEntityCount === deviceCount,
          keyboardLink: link.getAttribute("role") === "link" && link.tabIndex === 0,
        };
        link.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        await panel.updateComplete;
        checks.keyboardOpensRoom = panel._selectedAreaId === card.area.area_id && !!panel.shadowRoot.querySelector("rs-room-detail");
        return checks;
      })()`,
    );
    for (const [name, passed] of Object.entries(overviewChecks)) {
      if (!passed)
        throw new Error(
          "Room overview regression failed: " + name + " " + JSON.stringify(overviewChecks),
        );
    }
    console.log("Unknown overview grouping, entity ownership and keyboard navigation checked");
    await navigate(cdp, "/dev/settings-preview.html");
    const settingsText = await waitForText(cdp, "Advanced control tuning");
    assertIncludes(settingsText, "MPC");
    assertIncludes(settingsText, "Comfort 70");
    assertIncludes(settingsText, "Optimizer strategy");
    assertIncludes(settingsText, "Horizon search");
    await openAllDetails(cdp);
    await screenshot(cdp, "settings-desktop", true);
    console.log("Settings preview checked");
    await checkGlobalSetback(cdp);
    console.log("Global setback save and reload checked");

    await navigate(cdp, "/dev/room-detail-preview.html");
    const detailText = await waitForText(cdp, "Device plans and feedback");
    assertIncludes(detailText, "Room comfort target");
    assertIncludes(detailText, "Room configuration");
    await screenshot(cdp, "room-detail-desktop", true);
    console.log("Room detail desktop checked");
    await checkComfortFeedback(cdp);
    console.log("Comfort target, dispatch, confirmation, observation and units checked");
    await navigate(cdp, "/dev/room-detail-preview.html");
    await waitForText(cdp, "Device plans and feedback");
    await checkRoomSetback(cdp);
    console.log("Room setback save, reload and inheritance checked");

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
    await navigate(cdp, "/dev/room-detail-preview.html");
    await waitForText(cdp, "Device plans and feedback");
    await screenshot(cdp, "room-detail-mobile", true);
    await cdp.send("Emulation.setEmulatedMedia", {
      features: [
        { name: "prefers-color-scheme", value: "dark" },
        { name: "prefers-reduced-motion", value: "reduce" },
      ],
    });
    const mobileLayout = await evaluate<{
      fits: boolean;
      transition: string;
      targetHeight: number;
    }>(
      cdp,
      `(() => {
        const detail = document.querySelector("rs-room-detail");
        const panel = detail.shadowRoot.querySelector("rs-temperature-control-panel");
        const button = panel.shadowRoot.querySelector(".step-button");
        return {
          fits: document.documentElement.scrollWidth <= innerWidth,
          transition: getComputedStyle(button).transitionDuration,
          targetHeight: button.getBoundingClientRect().height,
        };
      })()`,
    );
    if (
      !mobileLayout.fits ||
      mobileLayout.targetHeight < 44 ||
      mobileLayout.transition.split(",").some((value) => value.trim() !== "0s")
    ) {
      throw new Error(
        "Mobile comfort layout or reduced motion failed: " + JSON.stringify(mobileLayout),
      );
    }
    await screenshot(cdp, "room-detail-mobile-dark", true);
    console.log("Mobile comfort layout, touch targets and reduced motion checked");
    await cdp.send("Emulation.setEmulatedMedia", { features: [] });
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
