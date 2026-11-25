import { readFileSync } from "node:fs";

const out = new URL("../../custom_components/roommind/frontend/", import.meta.url);
const bundles = [
  ["roommind-panel.js", "roommind-panel"],
  ["roommind-card.js", "roommind-room-card"],
];

let failed = false;
for (const [file, tag] of bundles) {
  const code = readFileSync(new URL(file, out), "utf8");
  if (!code.includes("customElements.define") || !code.includes(tag)) {
    console.error(`check-bundles: ${file} does not define <${tag}>`);
    failed = true;
  }
}
process.exit(failed ? 1 : 0);
