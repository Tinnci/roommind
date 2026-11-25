/**
 * Shared utilities for reading and formatting RoomMind room state.
 */
import type {
  ClimateMode,
  DisplayMode,
  HassDeviceRegistryEntry,
  HassEntityRegistryEntry,
  RoomConfig,
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
  if (mode === "off" || mode === "fan_only" || mode === "dry") return null;
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
 * Resolve the user-facing activity badge mode for UI components, surfacing
 * Asian HVAC modes (dry, fan_only, off) from commanded state and live device
 * observations without altering thermal EKF observation semantics.
 */
export function getDisplayMode(
  live:
    | Pick<
        RoomLiveData,
        "mode" | "observed_mode" | "observation_status" | "commanded_mode" | "device_observations"
      >
    | undefined,
  config?: Pick<RoomConfig, "climate_mode"> | null,
): DisplayMode | null {
  if (!live) return null;
  const observed = getObservedMode(live);
  if (observed === "heating" || observed === "cooling") return observed;

  const observations = live.device_observations ?? [];
  const observedNonThermal = observations.find(
    (obs) =>
      obs.available &&
      !obs.assumed_state &&
      (obs.hvac_mode === "dry" || obs.hvac_mode === "fan_only"),
  );
  if (observedNonThermal?.hvac_mode === "dry") return "dry";
  if (observedNonThermal?.hvac_mode === "fan_only") return "fan_only";

  if (live.commanded_mode === "dry") return "dry";
  if (live.commanded_mode === "fan_only") return "fan_only";
  if (config?.climate_mode === "off" && (live.commanded_mode ?? "idle") === "idle") {
    return "off";
  }
  return observed;
}

/**
 * Return the CSS class name corresponding to a room mode.
 */
export function getModeClass(mode: DisplayMode | null | undefined): string {
  switch (mode) {
    case "heating":
      return "mode-heating";
    case "cooling":
      return "mode-cooling";
    case "dry":
      return "mode-dry";
    case "fan_only":
      return "mode-fan";
    case "off":
      return "mode-off";
    case "idle":
      return "mode-idle";
    default:
      return "mode-other";
  }
}

export type RoomModeSource =
  "observed" | "mode_only" | "offline" | "assumed" | "conflict" | "waiting";

export interface RoomModePresentation {
  mode: DisplayMode | null;
  source: RoomModeSource;
  labelKey: TranslationKey;
  hintKey?: TranslationKey;
}

const modeKeys: Record<DisplayMode, TranslationKey> = {
  heating: "mode.heating",
  cooling: "mode.cooling",
  dry: "mode.dry",
  fan_only: "mode.fan_only",
  off: "mode.off",
  idle: "mode.idle",
};

/**
 * Format a room mode for display (localized).
 */
export function formatMode(mode: DisplayMode, language: string): string {
  return localize(modeKeys[mode], language);
}

/**
 * Distinguish confirmed mode-only devices (e.g. TCL ACs without hvac_action
 * telemetry) from offline, assumed-state, or conflicting devices in UI labels
 * without altering strict backend thermal observation semantics.
 */
export function resolveRoomModePresentation(
  live:
    | Pick<
        RoomLiveData,
        "mode" | "observed_mode" | "observation_status" | "commanded_mode" | "device_observations"
      >
    | undefined,
  config?: Pick<RoomConfig, "climate_mode"> | null,
): RoomModePresentation {
  const displayMode = getDisplayMode(live, config);
  if (displayMode !== null) {
    return {
      mode: displayMode,
      source: "observed",
      labelKey: modeKeys[displayMode],
    };
  }

  const observations = live?.device_observations ?? [];
  const confirmed = observations.filter(
    (obs) => obs.available && !obs.assumed_state && Boolean(obs.hvac_mode),
  );
  if (confirmed.length > 0) {
    const modes = new Set(confirmed.map((obs) => String(obs.hvac_mode).toLowerCase()));
    const hasHeat = modes.has("heat");
    const hasCool = modes.has("cool");
    if (hasHeat && hasCool) {
      return {
        mode: null,
        source: "conflict",
        labelKey: "hero.output_conflict",
        hintKey: "hero.output_conflict_hint",
      };
    }
    if (hasHeat) {
      return {
        mode: "heating",
        source: "mode_only",
        labelKey: "mode.heating_mode",
        hintKey: "hero.mode_only_hint",
      };
    }
    if (hasCool) {
      return {
        mode: "cooling",
        source: "mode_only",
        labelKey: "mode.cooling_mode",
        hintKey: "hero.mode_only_hint",
      };
    }
    if (modes.has("dry")) {
      return {
        mode: "dry",
        source: "mode_only",
        labelKey: "mode.dry",
        hintKey: "hero.mode_only_hint",
      };
    }
    if (modes.has("fan_only")) {
      return {
        mode: "fan_only",
        source: "mode_only",
        labelKey: "mode.fan_only",
      };
    }
    if (modes.has("auto") || modes.has("heat_cool")) {
      return {
        mode: "idle",
        source: "mode_only",
        labelKey: "mode.auto_mode",
        hintKey: "hero.mode_only_hint",
      };
    }
  }

  if (observations.length > 0 && observations.every((obs) => !obs.available)) {
    return {
      mode: null,
      source: "offline",
      labelKey: "hero.device_offline",
      hintKey: "hero.device_offline_hint",
    };
  }

  if (observations.some((obs) => obs.assumed_state)) {
    return {
      mode: null,
      source: "assumed",
      labelKey: "hero.assumed_state",
      hintKey: "hero.assumed_state_hint",
    };
  }

  return {
    mode: null,
    source: "waiting",
    labelKey: "hero.output_unknown",
    hintKey: "hero.output_unknown_hint",
  };
}
