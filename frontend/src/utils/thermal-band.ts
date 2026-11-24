/**
 * Pure computation helpers for the visual thermal comfort-band bar.
 */
import type { DeviceRole, HomeAssistant, RoomConfig } from "../types";
import { toCelsius } from "./temperature";

export interface ThermalBandPin {
  entityId: string;
  name: string;
  tempC: number;
  percent: number;
  hvacMode: string | null;
  role: DeviceRole;
}

export interface ThermalBandModel {
  minC: number;
  maxC: number;
  midC: number;
  currentTempC: number | null;
  currentPct: number | null;
  perceivedTempC: number | null;
  perceivedPct: number | null;
  targetTempC: number | null;
  targetPct: number | null;
  bandLowC: number | null;
  bandHighC: number | null;
  bandStartPct: number | null;
  bandWidthPct: number | null;
  devicePins: ThermalBandPin[];
}

const MIN_SPAN_C = 6;

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function toPercent(valueC: number, minC: number, maxC: number): number {
  return clampPercent(((valueC - minC) / (maxC - minC)) * 100);
}

function configuredDevices(config: RoomConfig): { entityId: string; role: DeviceRole }[] {
  if (config.devices && config.devices.length > 0) {
    return config.devices.map((device) => ({
      entityId: device.entity_id,
      role: device.role,
    }));
  }
  const seen = new Set<string>();
  const result: { entityId: string; role: DeviceRole }[] = [];
  for (const entityId of [...(config.thermostats ?? []), ...(config.acs ?? [])]) {
    if (!seen.has(entityId)) {
      seen.add(entityId);
      result.push({ entityId, role: "auto" });
    }
  }
  return result;
}

export function computeThermalBand(
  config: RoomConfig,
  hass: HomeAssistant,
): ThermalBandModel | null {
  const live = config.live;
  const currentTempC = live?.current_temp ?? null;
  const perceivedTempC =
    live?.perceived_temp != null &&
    (currentTempC == null || Math.abs(live.perceived_temp - currentTempC) >= 0.05)
      ? live.perceived_temp
      : null;

  const isNonTempMode =
    config.climate_mode === "off" ||
    config.climate_mode === "fan_only" ||
    config.climate_mode === "dry";

  const heatTargetC =
    !isNonTempMode && config.climate_mode !== "cool_only" ? (live?.heat_target ?? null) : null;
  const coolTargetC =
    !isNonTempMode && config.climate_mode !== "heat_only" ? (live?.cool_target ?? null) : null;
  const targetTempC = !isNonTempMode ? (live?.target_temp ?? null) : null;

  let bandLowC: number | null = null;
  let bandHighC: number | null = null;
  if (heatTargetC != null && coolTargetC != null) {
    bandLowC = Math.min(heatTargetC, coolTargetC);
    bandHighC = Math.max(heatTargetC, coolTargetC);
  } else if (targetTempC != null) {
    bandLowC = targetTempC - 0.5;
    bandHighC = targetTempC + 0.5;
  } else if (heatTargetC != null) {
    bandLowC = heatTargetC - 0.5;
    bandHighC = heatTargetC + 0.5;
  } else if (coolTargetC != null) {
    bandLowC = coolTargetC - 0.5;
    bandHighC = coolTargetC + 0.5;
  }

  const obsById = new Map((live?.device_observations ?? []).map((obs) => [obs.entity_id, obs]));
  const rawPins: {
    entityId: string;
    name: string;
    tempC: number;
    hvacMode: string | null;
    role: DeviceRole;
  }[] = [];

  for (const device of configuredDevices(config)) {
    const obs = obsById.get(device.entityId);
    const haState = hass?.states?.[device.entityId];
    const hvacMode = obs?.hvac_mode ?? (haState?.state || null);
    let tempC: number | null = null;

    if (obs?.available) {
      if (obs.temperature != null) {
        tempC = obs.temperature;
      } else if (obs.target_temp_low != null && obs.target_temp_high != null) {
        if (hvacMode === "heat") tempC = obs.target_temp_low;
        else if (hvacMode === "cool") tempC = obs.target_temp_high;
        else tempC = (obs.target_temp_low + obs.target_temp_high) / 2;
      }
    } else if (
      haState &&
      !["off", "unavailable", "unknown"].includes(haState.state) &&
      typeof haState.attributes?.temperature === "number"
    ) {
      tempC = toCelsius(haState.attributes.temperature, hass);
    }

    if (tempC != null && Number.isFinite(tempC) && hvacMode !== "off") {
      rawPins.push({
        entityId: device.entityId,
        name: String(haState?.attributes?.friendly_name || device.entityId),
        tempC,
        hvacMode,
        role: device.role,
      });
    }
  }

  const numericValues: number[] = [];
  if (currentTempC != null) numericValues.push(currentTempC);
  if (perceivedTempC != null) numericValues.push(perceivedTempC);
  if (targetTempC != null) numericValues.push(targetTempC);
  if (bandLowC != null) numericValues.push(bandLowC);
  if (bandHighC != null) numericValues.push(bandHighC);
  for (const pin of rawPins) numericValues.push(pin.tempC);

  if (numericValues.length === 0) return null;

  let minC = Math.floor(Math.min(...numericValues) - 1.5);
  let maxC = Math.ceil(Math.max(...numericValues) + 1.5);
  if (maxC - minC < MIN_SPAN_C) {
    const mid = (minC + maxC) / 2;
    minC = Math.floor(mid - MIN_SPAN_C / 2);
    maxC = Math.ceil(mid + MIN_SPAN_C / 2);
  }
  const midC = (minC + maxC) / 2;

  const bandStartPct = bandLowC != null ? toPercent(bandLowC, minC, maxC) : null;
  const bandEndPct = bandHighC != null ? toPercent(bandHighC, minC, maxC) : null;
  const bandWidthPct =
    bandStartPct != null && bandEndPct != null ? Math.max(2, bandEndPct - bandStartPct) : null;

  return {
    minC,
    maxC,
    midC,
    currentTempC,
    currentPct: currentTempC != null ? toPercent(currentTempC, minC, maxC) : null,
    perceivedTempC,
    perceivedPct: perceivedTempC != null ? toPercent(perceivedTempC, minC, maxC) : null,
    targetTempC,
    targetPct: targetTempC != null ? toPercent(targetTempC, minC, maxC) : null,
    bandLowC,
    bandHighC,
    bandStartPct,
    bandWidthPct,
    devicePins: rawPins.map((pin) => ({
      ...pin,
      percent: toPercent(pin.tempC, minC, maxC),
    })),
  };
}
