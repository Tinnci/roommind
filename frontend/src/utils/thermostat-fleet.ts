/**
 * Structured multi-thermostat / multi-AC unit view model helpers.
 */
import type {
  CompressorGroup,
  DeviceActuationStatus,
  DeviceConfig,
  DeviceObservation,
  DeviceRole,
  DeviceType,
  HomeAssistant,
  RoomConfig,
} from "../types";
import { type ActuationFeedback, actuationFeedback } from "./actuation-status";
import { toCelsius } from "./temperature";

export interface ThermostatUnitStatus {
  entityId: string;
  name: string;
  type: DeviceType;
  role: DeviceRole;
  available: boolean;
  hvacMode: string | null;
  isActive: boolean;
  setpointC: number | null;
  setpointLowC: number | null;
  setpointHighC: number | null;
  unitTempC: number | null;
  fanMode: string | null;
  overdriveDeltaC: number | null;
  compressorGroupName: string | null;
  isMaster: boolean;
  feedback: ActuationFeedback | null;
  diagnostic: string | null;
  hasConflict: boolean;
}

export interface ThermostatFleetSummary {
  units: ThermostatUnitStatus[];
  total: number;
  active: number;
  hasConflict: boolean;
  sharedCompressorGroups: string[];
}

const ACTIVE_HA_MODES = new Set(["heat", "cool", "heat_cool", "auto", "dry", "fan_only"]);
const COOLING_FAMILY_MODES = new Set(["cool", "dry"]);

function normalizeConfiguredDevices(config: RoomConfig): DeviceConfig[] {
  if (config.devices && config.devices.length > 0) {
    return config.devices;
  }
  const seen = new Set<string>();
  const devices: DeviceConfig[] = [];
  for (const entityId of config.thermostats ?? []) {
    if (!seen.has(entityId)) {
      seen.add(entityId);
      devices.push({ entity_id: entityId, type: "trv", role: "auto" });
    }
  }
  for (const entityId of config.acs ?? []) {
    if (!seen.has(entityId)) {
      seen.add(entityId);
      devices.push({ entity_id: entityId, type: "ac", role: "auto" });
    }
  }
  return devices;
}

function getRoomReferenceTarget(config: RoomConfig, hvacMode: string | null): number | null {
  const live = config.live;
  if (!live) return null;
  if (hvacMode === "heat") return live.heat_target ?? live.target_temp;
  if (hvacMode === "cool") return live.cool_target ?? live.target_temp;
  return live.target_temp;
}

function pickBestActuation(
  operations: DeviceActuationStatus[],
  entityId: string,
): DeviceActuationStatus | undefined {
  const matching = operations.filter((op) => op.entity_id === entityId);
  if (matching.length === 0) return undefined;
  return (
    matching.find((op) =>
      ["failed", "unsupported", "not_confirmed"].includes(actuationFeedback(op)),
    ) ??
    matching.find((op) => op.service === "set_temperature") ??
    matching.find((op) => op.service === "set_hvac_mode") ??
    matching[0]
  );
}

function detectCompressorConflictGroupIds(
  compressorGroups: CompressorGroup[],
  hass: HomeAssistant,
  observationsById: Map<string, DeviceObservation>,
): Set<string> {
  const conflicted = new Set<string>();
  for (const group of compressorGroups) {
    let hasHeat = false;
    let hasCoolOrDry = false;
    for (const memberId of group.members) {
      const mode =
        observationsById.get(memberId)?.hvac_mode ?? hass?.states?.[memberId]?.state ?? null;
      if (mode === "heat") hasHeat = true;
      if (mode && COOLING_FAMILY_MODES.has(mode)) hasCoolOrDry = true;
    }
    if (hasHeat && hasCoolOrDry) conflicted.add(group.id);
  }
  return conflicted;
}

export function buildThermostatFleet(
  config: RoomConfig | null | undefined,
  hass: HomeAssistant,
  compressorGroups: CompressorGroup[] = [],
): ThermostatFleetSummary {
  if (!config) {
    return { units: [], total: 0, active: 0, hasConflict: false, sharedCompressorGroups: [] };
  }

  const devices = normalizeConfiguredDevices(config);
  const live = config.live;
  const obsById = new Map((live?.device_observations ?? []).map((obs) => [obs.entity_id, obs]));
  const operations = live?.device_actuation_status ?? [];
  const conflictedGroupIds = detectCompressorConflictGroupIds(compressorGroups, hass, obsById);

  const sharedGroupNames = new Set<string>();
  const units: ThermostatUnitStatus[] = devices.map((device) => {
    const haState = hass?.states?.[device.entity_id];
    const obs = obsById.get(device.entity_id);
    const actuation = pickBestActuation(operations, device.entity_id);

    const hvacMode = obs?.hvac_mode ?? (haState?.state || null);
    const available =
      obs?.available ?? (haState ? !["unavailable", "unknown"].includes(haState.state) : false);
    const isActive = available && hvacMode !== null && ACTIVE_HA_MODES.has(hvacMode);

    let setpointC: number | null = obs?.temperature ?? null;
    if (
      setpointC == null &&
      typeof haState?.attributes?.temperature === "number" &&
      hvacMode !== "off"
    ) {
      setpointC = toCelsius(haState.attributes.temperature, hass);
    }

    const setpointLowC =
      obs?.target_temp_low ??
      (typeof haState?.attributes?.target_temp_low === "number"
        ? toCelsius(haState.attributes.target_temp_low, hass)
        : null);
    const setpointHighC =
      obs?.target_temp_high ??
      (typeof haState?.attributes?.target_temp_high === "number"
        ? toCelsius(haState.attributes.target_temp_high, hass)
        : null);

    const unitTempC =
      typeof haState?.attributes?.current_temperature === "number"
        ? toCelsius(haState.attributes.current_temperature, hass)
        : null;

    const fanMode =
      typeof haState?.attributes?.fan_mode === "string"
        ? haState.attributes.fan_mode
        : typeof actuation?.desired?.fan_mode === "string"
          ? actuation.desired.fan_mode
          : null;

    const refTarget = getRoomReferenceTarget(config, hvacMode);
    let overdriveDeltaC: number | null = null;
    if (
      isActive &&
      setpointC != null &&
      refTarget != null &&
      (hvacMode === "heat" || hvacMode === "cool")
    ) {
      const delta = setpointC - refTarget;
      if (Math.abs(delta) >= 0.3) {
        overdriveDeltaC = delta;
      }
    }

    const group = compressorGroups.find((g) => g.members.includes(device.entity_id));
    if (group) sharedGroupNames.add(group.name);

    const feedback = actuation ? actuationFeedback(actuation) : null;
    const actuationProblem =
      feedback === "failed" || feedback === "not_confirmed" || feedback === "unsupported";
    const groupConflict = group ? conflictedGroupIds.has(group.id) && isActive : false;

    return {
      entityId: device.entity_id,
      name: String(haState?.attributes?.friendly_name || device.entity_id),
      type: device.type,
      role: device.role,
      available,
      hvacMode,
      isActive,
      setpointC,
      setpointLowC,
      setpointHighC,
      unitTempC,
      fanMode,
      overdriveDeltaC,
      compressorGroupName: group?.name ?? null,
      isMaster: group?.master_entity === device.entity_id,
      feedback,
      diagnostic: actuation?.diagnostic ?? null,
      hasConflict: !available || actuationProblem || groupConflict,
    };
  });

  return {
    units,
    total: units.length,
    active: units.filter((u) => u.isActive).length,
    hasConflict: units.some((u) => u.hasConflict),
    sharedCompressorGroups: [...sharedGroupNames],
  };
}
