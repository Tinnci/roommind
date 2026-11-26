import type { HomeAssistant } from "../types";

export type NonAmbientReason = "diagnostic" | "appliance" | "outdoor";

const NON_AMBIENT_CATEGORIES = new Set(["diagnostic", "config"]);
const NON_AMBIENT_DEVICE_DOMAINS = new Set([
  "water_heater",
  "vacuum",
  "lawn_mower",
  "camera",
  "media_player",
  "device_tracker",
]);

const OUTDOOR_TEMP_KEYWORDS = [
  "outdoor",
  "outside",
  "exterior",
  "室外",
  "außen",
  "aussen",
] as const;

const APPLIANCE_TEMP_KEYWORDS = [
  "water_heater",
  "waterheater",
  "water_temp",
  "input_water",
  "output_water",
  "hot_water",
  "cold_water",
  "inlet_temp",
  "outlet_temp",
  "boiler",
  "kettle",
  "fryer",
  "oven",
  "fridge",
  "freezer",
  "refrigerator",
  "dishwasher",
  "washer",
  "coffee",
  "dispenser",
  "purifier",
  ".ysj.",
  "_ysj_",
  "coil",
  "exhaust",
  "compressor",
  "condenser",
  "evaporator",
  "pipe_temp",
  "battery",
  "cpu",
  "gpu",
  "soc_temp",
  "chip",
  "board_temp",
  "body_temp",
  "body temperature",
  "nvme",
  "ssd",
  "hdd",
  "热水器",
  "饮水机",
  "净饮机",
  "净水器",
  "出水",
  "进水",
  "水温",
  "沸点",
  "炸锅",
  "冰箱",
  "烤箱",
  "洗衣机",
  "洗碗机",
  "咖啡机",
  "盘管",
  "排气",
  "压缩机",
  "冷凝",
  "蒸发",
  "电池",
  "芯片",
  "机身",
  "体温",
  "主板",
  "硬盘",
  "warmwasser",
  "heizkessel",
  "wasserkocher",
  "backofen",
  "kühlschrank",
  "batterie",
  "akku",
  "körper",
] as const;

export function isDiagnosticOrConfigEntity(
  entityId: string,
  hass: HomeAssistant | null | undefined,
): boolean {
  const entry = hass?.entities?.[entityId];
  if (!entry) return false;
  if (entry.hidden === true) return true;
  const cat = entry.entity_category;
  return typeof cat === "string" && NON_AMBIENT_CATEGORIES.has(cat.toLowerCase());
}

export function classifyNonAmbientTempSensor(
  entityId: string,
  hass: HomeAssistant | null | undefined,
): NonAmbientReason | null {
  if (!entityId.startsWith("sensor.")) return null;
  if (isDiagnosticOrConfigEntity(entityId, hass)) {
    return "diagnostic";
  }

  const entry = hass?.entities?.[entityId];
  const deviceId = entry?.device_id ?? null;
  if (deviceId && hass?.entities) {
    for (const sibling of Object.values(hass.entities)) {
      if (sibling.device_id !== deviceId) continue;
      const domain = sibling.entity_id.split(".", 1)[0] ?? "";
      if (NON_AMBIENT_DEVICE_DOMAINS.has(domain)) {
        return "appliance";
      }
    }
  }

  const state = hass?.states?.[entityId];
  const device = deviceId ? hass?.devices?.[deviceId] : undefined;
  const friendlyName = state?.attributes?.friendly_name;
  const searchable = [
    entityId,
    typeof friendlyName === "string" ? friendlyName : "",
    entry?.name ?? "",
    device?.name ?? "",
    device?.name_by_user ?? "",
    device?.model ?? "",
    device?.model_id ?? "",
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (OUTDOOR_TEMP_KEYWORDS.some((kw) => searchable.includes(kw))) {
    return "outdoor";
  }
  if (APPLIANCE_TEMP_KEYWORDS.some((kw) => searchable.includes(kw))) {
    return "appliance";
  }
  return null;
}
