import "../components/rs-room-detail";
import { registerHaPreviewStubs } from "./ha-element-stubs";
import { createRoomDetailPreviewModel } from "./room-detail-preview-data";

registerHaPreviewStubs();

const model = createRoomDetailPreviewModel();
const root = document.querySelector<HTMLDivElement>("#app");

if (!root) {
  throw new Error("Missing #app root");
}

const detail = document.createElement("rs-room-detail");
detail.hass = model.hass;
detail.area = model.area;
detail.config = model.config;
detail.presenceEnabled = true;
detail.presencePersons = model.presencePersons;
detail.climateControlActive = true;
detail.valveProtectionEnabled = true;

root.appendChild(detail);
