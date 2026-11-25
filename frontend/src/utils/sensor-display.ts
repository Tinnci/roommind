import type { HomeAssistant, SensorFusionStatus } from "../types";
import { localize } from "./localize";
import { isRoomMindEntity } from "./room-state";
import { tempUnit } from "./temperature";

export function freshnessLabel(status: string, lang: string): string {
  switch (status) {
    case "aging":
      return localize("devices.sensor_freshness_aging", lang);
    case "stale":
      return localize("devices.sensor_freshness_stale", lang);
    default:
      return localize("devices.sensor_freshness_fresh", lang);
  }
}

export function freshnessSourceLabel(source: string, lang: string): string {
  switch (source) {
    case "observed_at":
    case "current_temperature_observed_at":
      return localize("devices.sensor_source_observed", lang);
    case "last_reported":
      return localize("devices.sensor_source_reported", lang);
    case "last_updated":
      return localize("devices.sensor_source_updated", lang);
    case "last_changed":
      return localize("devices.sensor_source_changed", lang);
    default:
      return localize("devices.sensor_source_none", lang);
  }
}

export function formatSensorAge(ageSeconds: number): string {
  const age = Math.max(0, Number(ageSeconds) || 0);
  if (age < 60) return `${Math.round(age)}s`;
  if (age < 3600) return `${Math.round(age / 60)}m`;
  return `${Math.round(age / 3600)}h`;
}

export function formatSensorValue(
  hass: HomeAssistant,
  entityId: string,
  kind: "temp" | "humidity",
): string {
  const state = hass.states[entityId];
  const unit = kind === "temp" ? tempUnit(hass) : "%";
  const currentValue = entityId.startsWith("climate.")
    ? state?.attributes?.current_temperature
    : state?.state;
  if (currentValue == null || currentValue === "unknown" || currentValue === "unavailable") {
    return "";
  }
  const value = Number(currentValue);
  if (!Number.isFinite(value)) return "";
  return `${kind === "humidity" ? Math.round(value) : value.toFixed(1)}${unit}`;
}

export function resolveSensorHealth(
  hass: HomeAssistant,
  sensorFusionStatus: SensorFusionStatus[],
  entityId: string,
): { label: string; className: string } {
  const lang = hass.language;
  const fusion = sensorFusionStatus.find((status) => status.entity_id === entityId);
  if (fusion) {
    return {
      label: freshnessLabel(fusion.freshness_status, lang),
      className: fusion.freshness_status,
    };
  }
  const state = hass.states[entityId];
  if (!state || state.state === "unknown" || state.state === "unavailable") {
    return {
      label: localize("devices.sensor_freshness_stale", lang),
      className: "unavailable",
    };
  }
  return {
    label: localize("devices.sensor_freshness_fresh", lang),
    className: "fresh",
  };
}

export interface ConfiguredSensorIds {
  temperatureSensor: string;
  temperatureSensors: Set<string>;
  humiditySensor: string;
  humiditySensors: Set<string>;
  occupancySensors: Set<string>;
  windowSensors: Set<string>;
}

export function isGlobalSensorCandidate(
  hass: HomeAssistant,
  entityId: string,
  configured: ConfiguredSensorIds,
): boolean {
  if (isRoomMindEntity(entityId, hass.entities)) return false;
  if (configured.temperatureSensor === entityId) return false;
  if (configured.temperatureSensors.has(entityId)) return false;
  if (configured.humiditySensor === entityId) return false;
  if (configured.humiditySensors.has(entityId)) return false;
  if (configured.occupancySensors.has(entityId)) return false;
  if (configured.windowSensors.has(entityId)) return false;
  if (entityId.startsWith("sensor.")) {
    const dc = hass.states[entityId]?.attributes?.device_class;
    return dc === "temperature" || dc === "humidity";
  }
  if (entityId.startsWith("binary_sensor.")) {
    const dc = hass.states[entityId]?.attributes?.device_class;
    return (
      dc === "occupancy" ||
      dc === "motion" ||
      dc === "presence" ||
      dc === "window" ||
      dc === "door" ||
      dc === "opening"
    );
  }
  if (entityId.startsWith("climate.")) {
    return hass.states[entityId]?.attributes?.current_temperature != null;
  }
  return entityId.startsWith("input_number.") || entityId.startsWith("input_boolean.");
}
