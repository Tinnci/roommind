import type { AreaInfo, CompressorGroup, HomeAssistant, RoomConfig } from "../types";
import { localize } from "./localize";
import {
  formatMode,
  getDisplayMode,
  getEntitiesForArea,
  isRoomMindEntity,
  resolveRoomModePresentation,
} from "./room-state";
import { hasConfiguredSensors } from "./environment-monitor";
import { isRoomControlEffective } from "./room-overview-status";
import { formatTemp, tempUnit } from "./temperature";
import { buildThermostatFleet } from "./thermostat-fleet";

export type AreaGroupTone = "attention" | "active" | "normal" | "setup";

export interface AreaGroup {
  id: string;
  name: string;
  tone: AreaGroupTone;
  items: AreaInfo[];
}

export function resolveAreaPriorityGroup(
  info: AreaInfo,
  hass: HomeAssistant,
  compressorGroups: CompressorGroup[],
  climateControlActive: boolean,
): AreaGroup["id"] {
  const live = info.config?.live;
  const mode = resolveRoomModePresentation(live, info.config).mode;
  const hasClimateSelected =
    (info.config?.devices?.length ?? 0) > 0 ||
    (info.config?.thermostats?.length ?? 0) > 0 ||
    (info.config?.acs?.length ?? 0) > 0;
  const hasSensors = hasConfiguredSensors(info.config);
  if (!info.config || (!hasClimateSelected && !hasSensors && !info.config.is_outdoor)) {
    return "setup";
  }
  const fleet = buildThermostatFleet(info.config, hass, compressorGroups);
  if (
    live?.window_open ||
    live?.mold_risk_level === "warning" ||
    live?.mold_risk_level === "critical" ||
    live?.learning_paused_reason ||
    fleet.hasConflict
  ) {
    return "attention";
  }
  if (
    hasClimateSelected &&
    isRoomControlEffective(info.config, climateControlActive) &&
    (mode === "heating" || mode === "cooling" || mode === "dry" || mode === "fan_only")
  ) {
    return "active";
  }
  return "monitoring";
}

export function buildPriorityGroups(
  areaInfos: AreaInfo[],
  hass: HomeAssistant,
  compressorGroups: CompressorGroup[],
  climateControlActive: boolean,
): AreaGroup[] {
  const groups: AreaGroup[] = [
    {
      id: "attention",
      name: localize("panel.group.attention", hass.language),
      tone: "attention",
      items: [],
    },
    {
      id: "active",
      name: localize("panel.group.active", hass.language),
      tone: "active",
      items: [],
    },
    {
      id: "monitoring",
      name: localize("panel.group.monitoring", hass.language),
      tone: "normal",
      items: [],
    },
    {
      id: "setup",
      name: localize("panel.group.setup", hass.language),
      tone: "setup",
      items: [],
    },
  ];
  const byId = new Map(groups.map((group) => [group.id, group]));

  for (const info of areaInfos) {
    byId
      .get(resolveAreaPriorityGroup(info, hass, compressorGroups, climateControlActive))!
      .items.push(info);
  }

  return groups.filter((group) => group.items.length > 0);
}

export function computeAreaInfos(
  hass: HomeAssistant,
  rooms: Record<string, RoomConfig>,
  roomOrder: string[],
): AreaInfo[] {
  if (!hass?.areas) return [];

  const areas = Object.values(hass.areas);
  const infos: AreaInfo[] = areas.map((area) => {
    const areaEntities = getEntitiesForArea(area.area_id, hass.entities, hass.devices).filter(
      (entity) => !isRoomMindEntity(entity.entity_id, hass.entities),
    );

    const climateEntityCount = areaEntities.filter((e) =>
      e.entity_id.startsWith("climate."),
    ).length;
    const tempSensorCount = areaEntities.filter(
      (e) =>
        e.entity_id.startsWith("sensor.") &&
        hass.states[e.entity_id]?.attributes?.device_class === "temperature",
    ).length;
    const humiditySensorCount = areaEntities.filter(
      (e) =>
        e.entity_id.startsWith("sensor.") &&
        hass.states[e.entity_id]?.attributes?.device_class === "humidity",
    ).length;

    return {
      area,
      config: rooms[area.area_id] ?? null,
      climateEntityCount,
      tempSensorCount,
      humiditySensorCount,
    };
  });

  const orderIndex = new Map(roomOrder.map((id, i) => [id, i]));
  infos.sort((a, b) => {
    const aIdx = orderIndex.get(a.area.area_id);
    const bIdx = orderIndex.get(b.area.area_id);
    if (aIdx !== undefined && bIdx !== undefined) return aIdx - bIdx;
    if (aIdx !== undefined) return -1;
    if (bIdx !== undefined) return 1;
    const aScore = a.config
      ? 2
      : a.climateEntityCount > 0 || a.tempSensorCount > 0 || (a.humiditySensorCount ?? 0) > 0
        ? 1
        : 0;
    const bScore = b.config
      ? 2
      : b.climateEntityCount > 0 || b.tempSensorCount > 0 || (b.humiditySensorCount ?? 0) > 0
        ? 1
        : 0;
    if (aScore !== bScore) return bScore - aScore;
    return a.area.name.localeCompare(b.area.name);
  });

  return infos;
}

export function buildFloorGroups(
  areaInfos: AreaInfo[],
  hass: HomeAssistant,
  groupByFloor: boolean,
): { name: string; items: AreaInfo[] }[] {
  if (!groupByFloor || !hass.floors) return [{ name: "", items: areaInfos }];

  const floors = hass.floors;
  const lang = hass.language;
  const groups = new Map<string | null, AreaInfo[]>();
  const floorOrder: (string | null)[] = [];

  for (const info of areaInfos) {
    const fid = info.area.floor_id ?? null;
    if (!groups.has(fid)) {
      groups.set(fid, []);
      floorOrder.push(fid);
    }
    groups.get(fid)!.push(info);
  }

  floorOrder.sort((a, b) => {
    if (a === null) return 1;
    if (b === null) return -1;
    const fa = floors[a];
    const fb = floors[b];
    if (fa?.level != null && fb?.level != null) return fb.level - fa.level;
    if (fa?.level != null) return -1;
    if (fb?.level != null) return 1;
    return (fa?.name ?? "").localeCompare(fb?.name ?? "");
  });

  return floorOrder.map((fid) => ({
    name:
      fid === null
        ? localize("panel.floor_other", lang)
        : (floors[fid]?.name ?? localize("panel.floor_other", lang)),
    items: groups.get(fid)!,
  }));
}

export function formatHiddenRoomMeta(info: AreaInfo, hass: HomeAssistant, lang: string): string {
  const live = info.config?.live;
  const hasDevices =
    (info.config?.devices?.length ?? 0) > 0 ||
    (info.config?.thermostats?.length ?? 0) > 0 ||
    (info.config?.acs?.length ?? 0) > 0;
  if (live && !hasDevices) {
    const parts: string[] = [];
    if (live.current_temp !== null) {
      parts.push(`${formatTemp(live.current_temp, hass)}${tempUnit(hass)}`);
    }
    if (live.current_humidity !== null) {
      parts.push(`${live.current_humidity.toFixed(0)}%`);
    }
    if (parts.length > 0) return parts.join(" · ");
    return localize("card.monitor_only", lang);
  }
  if (live && live.current_temp !== null) {
    const mode = getDisplayMode(live, info.config) ?? "idle";
    return `${formatTemp(live.current_temp, hass)}${tempUnit(hass)} · ${formatMode(mode, lang)}`;
  }
  if (info.config) {
    return localize("card.waiting", lang);
  }
  if (info.climateEntityCount > 0) {
    return `${info.climateEntityCount} ${localize(
      info.climateEntityCount !== 1 ? "card.climate_devices" : "card.climate_device",
      lang,
    )}`;
  }
  if (info.tempSensorCount > 0) {
    return `${info.tempSensorCount} ${localize(
      info.tempSensorCount !== 1 ? "card.temp_sensors" : "card.temp_sensor",
      lang,
    )}`;
  }
  return localize("panel.hidden_unconfigured", lang);
}
