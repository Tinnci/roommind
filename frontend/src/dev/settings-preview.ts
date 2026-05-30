import "../components/rs-settings";
import { registerHaPreviewStubs } from "./ha-element-stubs";
import { createSettingsPreviewModel } from "./settings-preview-data";

registerHaPreviewStubs();

const model = createSettingsPreviewModel();
const root = document.querySelector<HTMLDivElement>("#app");

if (!root) {
  throw new Error("Missing #app root");
}

const settings = document.createElement("rs-settings");
settings.hass = model.hass;
settings.rooms = model.rooms;

root.appendChild(settings);
