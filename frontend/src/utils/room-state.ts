/**
 * Shared utilities for reading and formatting RoomMind room state.
 */
import type {
  ClimateMode,
  HassDeviceRegistryEntry,
  HassEntityRegistryEntry,
  RoomLiveData,
  RoomMode,
} from "../types";
import { localize, type TranslationKey } from "./localize";

export function isRoomMindEntity(
  entityId: string,
  entities?: Record<string, Pick<HassEntityRegistryEntry, "platform">>,
): boolean {
  return (
    entities?.[entityId]?.platform === "roommind" ||
    entityId.split(".")[1]?.startsWith("roommind_") === true
  );
}

export function getObservedMode(
  live: Pick<RoomLiveData, "mode" | "observed_mode" | "observation_status"> | undefined,
): RoomMode | null {
  if (!live || live.observation_status === "unknown") return null;
  return live.observed_mode !== undefined ? live.observed_mode : live.mode;
}

export function isTemperatureCached(
  live: Pick<RoomLiveData, "current_temp" | "current_temp_raw">,
): boolean {
  return live.current_temp !== null && live.current_temp_raw === null;
}

export function getComfortDelta(
  live: Pick<
    RoomLiveData,
    | "current_temp"
    | "current_temp_raw"
    | "target_temp"
    | "heat_target"
    | "cool_target"
    | "perceived_temp"
    | "effective_control_target"
  >,
  mode: ClimateMode,
): number | null {
  const current =
    live.effective_control_target === "perceived_temperature"
      ? live.perceived_temp
      : live.current_temp;
  if (current == null || isTemperatureCached(live)) return null;
  const heat = mode !== "cool_only" ? live.heat_target : null;
  const cool = mode !== "heat_only" ? live.cool_target : null;
  if (heat != null && current < heat) return current - heat;
  if (cool != null && current > cool) return current - cool;
  if (heat != null || cool != null) return 0;
  return live.target_temp != null ? current - live.target_temp : null;
}

/**
 * Resolve the effective area_id for an entity.
 * Entities may have area_id set directly, or inherit it from their device.
 */
function getEntityAreaId(
  entity: HassEntityRegistryEntry,
  devices: Record<string, HassDeviceRegistryEntry> | undefined,
): string | null {
  if (entity.area_id) return entity.area_id;
  if (entity.device_id && devices) {
    const device = devices[entity.device_id];
    if (device?.area_id) return device.area_id;
  }
  return null;
}

/**
 * Get all entities belonging to a specific area (including device-inherited area).
 */
export function getEntitiesForArea(
  areaId: string,
  entities: Record<string, HassEntityRegistryEntry> | undefined,
  devices: Record<string, HassDeviceRegistryEntry> | undefined,
): HassEntityRegistryEntry[] {
  if (!entities) return [];
  return Object.values(entities).filter((e) => getEntityAreaId(e, devices) === areaId);
}

/**
 * Return the CSS class name corresponding to a room mode.
 */
export function getModeClass(mode: RoomMode | null | undefined): string {
  switch (mode) {
    case "heating":
      return "mode-heating";
    case "cooling":
      return "mode-cooling";
    case "fan_only":
      return "mode-idle";
    case "idle":
      return "mode-idle";
    default:
      return "mode-other";
  }
}

const modeKeys: Record<RoomMode, TranslationKey> = {
  heating: "mode.heating",
  cooling: "mode.cooling",
  fan_only: "mode.fan_only",
  idle: "mode.idle",
};

/**
 * Format a room mode for display (localized).
 */
export function formatMode(mode: RoomMode, language: string): string {
  return localize(modeKeys[mode], language);
}
