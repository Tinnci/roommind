/**
 * Helpers for monitor-only rooms, sensor discovery, comfort assessment, dew point, and 24h sparklines.
 */
import type { AnalyticsDataPoint, HomeAssistant, RoomConfig } from "../types";
import type { TranslationKey } from "./localize";
import { hasClimateDevice } from "./room-overview-status";
import { getEntitiesForArea, isRoomMindEntity } from "./room-state";

export type ComfortStatus = "mold_risk" | "humid" | "dry" | "cool" | "warm" | "comfortable";
export type ComfortTone = "critical" | "warning" | "info" | "success";

export interface ComfortAssessment {
  status: ComfortStatus;
  tone: ComfortTone;
  labelKey: TranslationKey;
  icon: string;
}

export interface DiscoveredTempSensor {
  entityId: string;
  name: string;
  valueC: number | null;
  rawValue: number | null;
  unit: string;
  configured: boolean;
  isPrimary: boolean;
}

export interface DiscoveredHumiditySensor {
  entityId: string;
  name: string;
  value: number | null;
  configured: boolean;
  isPrimary: boolean;
}

export interface DiscoveredAirQualitySensor {
  entityId: string;
  name: string;
  value: number | null;
  displayValue: string;
  unit: string;
  deviceClass: string;
  icon: string;
}

export interface DiscoveredBinarySensor {
  entityId: string;
  name: string;
  isOn: boolean | null;
  deviceClass: string;
  configured: boolean;
}

export interface AreaSensorInventory {
  temperatureSensors: DiscoveredTempSensor[];
  humiditySensors: DiscoveredHumiditySensor[];
  airQualitySensors: DiscoveredAirQualitySensor[];
  binarySensors: DiscoveredBinarySensor[];
  previewTempC: number | null;
  previewHumidity: number | null;
  unlinkedSensorCount: number;
}

export interface TrendSummary {
  min: number;
  max: number;
  current: number;
  delta: number;
  path: string;
  areaPath: string;
  count: number;
}

const AIR_QUALITY_DEVICE_CLASSES = new Set([
  "pm25",
  "pm10",
  "carbon_dioxide",
  "volatile_organic_compounds",
  "aqi",
  "atmospheric_pressure",
  "pressure",
  "illuminance",
]);

const BINARY_ENV_DEVICE_CLASSES = new Set([
  "window",
  "door",
  "opening",
  "occupancy",
  "motion",
  "presence",
]);

const WINDOW_LIKE_CLASSES = new Set(["window", "door", "opening"]);

export function hasConfiguredSensors(config: RoomConfig | null | undefined): boolean {
  if (!config) return false;
  return Boolean(
    config.temperature_sensor ||
    (config.temperature_sensors?.length ?? 0) > 0 ||
    config.humidity_sensor ||
    (config.humidity_sensors?.length ?? 0) > 0 ||
    config.co2_sensor ||
    config.voc_sensor ||
    config.pm25_sensor ||
    (config.pm25_sensors?.length ?? 0) > 0 ||
    (config.window_sensors?.length ?? 0) > 0 ||
    (config.occupancy_sensors?.length ?? 0) > 0,
  );
}

export interface ThermalNeighbor {
  areaId: string;
  name: string;
  currentTemp: number | null;
  deltaC: number | null;
  mode: string;
  borrowedConditioning: boolean;
  hasClimate: boolean;
}

export function findThermalNeighbors(
  areaId: string,
  config: RoomConfig | null | undefined,
  rooms: Record<string, RoomConfig> | null | undefined,
  hass: HomeAssistant | null | undefined,
  currentTempC: number | null | undefined,
): ThermalNeighbor[] {
  if (!rooms) return [];
  const byArea = new Map<string, { borrowedConditioning: boolean }>();

  for (const adj of config?.adjacent_rooms ?? []) {
    if (!adj.area_id || adj.area_id === areaId || adj.enabled === false) continue;
    byArea.set(adj.area_id, {
      borrowedConditioning: adj.allow_borrowed_conditioning !== false,
    });
  }

  for (const [otherId, otherCfg] of Object.entries(rooms)) {
    if (!otherCfg || otherId === areaId) continue;
    for (const adj of otherCfg.adjacent_rooms ?? []) {
      if (adj.area_id !== areaId || adj.enabled === false) continue;
      const existing = byArea.get(otherId);
      const borrowed = adj.allow_borrowed_conditioning !== false;
      byArea.set(otherId, {
        borrowedConditioning: existing ? existing.borrowedConditioning || borrowed : borrowed,
      });
    }
  }

  const neighbors: ThermalNeighbor[] = [];
  for (const [neighborId, meta] of byArea) {
    const neighborCfg = rooms[neighborId];
    const neighborTemp = neighborCfg?.live?.current_temp ?? null;
    const deltaC =
      currentTempC != null &&
      Number.isFinite(currentTempC) &&
      neighborTemp != null &&
      Number.isFinite(neighborTemp)
        ? Math.round((neighborTemp - currentTempC) * 10) / 10
        : null;
    const name = neighborCfg?.display_name || hass?.areas?.[neighborId]?.name || neighborId;
    neighbors.push({
      areaId: neighborId,
      name,
      currentTemp: neighborTemp,
      deltaC,
      mode: neighborCfg?.live?.mode ?? "idle",
      borrowedConditioning: meta.borrowedConditioning,
      hasClimate: neighborCfg ? hasClimateDevice(neighborCfg) : false,
    });
  }

  return neighbors.sort((a, b) => a.name.localeCompare(b.name));
}

export function isMonitorOnlyRoom(config: RoomConfig | null | undefined): boolean {
  return Boolean(config && !config.is_outdoor && !hasClimateDevice(config));
}

/**
 * Magnus-Tetens dew point in °C rounded to 0.1 °C.
 */
export function calculateDewPointC(
  tempC: number | null | undefined,
  humidity: number | null | undefined,
): number | null {
  if (
    tempC == null ||
    humidity == null ||
    !Number.isFinite(tempC) ||
    !Number.isFinite(humidity) ||
    humidity <= 0 ||
    humidity > 100
  ) {
    return null;
  }
  const a = 17.625;
  const b = 243.04;
  const gamma = Math.log(humidity / 100) + (a * tempC) / (b + tempC);
  const dewPoint = (b * gamma) / (a - gamma);
  return Number.isFinite(dewPoint) ? Math.round(dewPoint * 10) / 10 : null;
}

export function assessRoomComfort(
  tempC: number | null | undefined,
  humidity: number | null | undefined,
  moldRisk?: string | null,
): ComfortAssessment | null {
  const validTemp = tempC != null && Number.isFinite(tempC) ? tempC : null;
  const validRh = humidity != null && Number.isFinite(humidity) ? humidity : null;

  if (moldRisk === "critical") {
    return {
      status: "mold_risk",
      tone: "critical",
      labelKey: "monitor.comfort.mold_risk",
      icon: "mdi:water-alert",
    };
  }
  if (moldRisk === "warning") {
    return {
      status: "mold_risk",
      tone: "warning",
      labelKey: "monitor.comfort.mold_risk",
      icon: "mdi:water-alert",
    };
  }
  if (validTemp === null && validRh === null) {
    return null;
  }
  if (validRh !== null && validRh >= 65) {
    return {
      status: "humid",
      tone: "warning",
      labelKey: "monitor.comfort.humid",
      icon: "mdi:water-percent",
    };
  }
  if (validRh !== null && validRh < 30) {
    return {
      status: "dry",
      tone: "warning",
      labelKey: "monitor.comfort.dry",
      icon: "mdi:water-off-outline",
    };
  }
  if (validTemp !== null && validTemp < 18) {
    return {
      status: "cool",
      tone: "info",
      labelKey: "monitor.comfort.cool",
      icon: "mdi:snowflake",
    };
  }
  if (validTemp !== null && validTemp > 26) {
    return {
      status: "warm",
      tone: "warning",
      labelKey: "monitor.comfort.warm",
      icon: "mdi:weather-sunny-alert",
    };
  }
  return {
    status: "comfortable",
    tone: "success",
    labelKey: "monitor.comfort.comfortable",
    icon: "mdi:check-circle-outline",
  };
}

function parseNumericState(stateStr: string | undefined): number | null {
  if (!stateStr || stateStr === "unavailable" || stateStr === "unknown") return null;
  const val = Number.parseFloat(stateStr);
  return Number.isFinite(val) ? val : null;
}

function airQualityIcon(deviceClass: string): string {
  switch (deviceClass) {
    case "pm25":
    case "pm10":
    case "aqi":
      return "mdi:air-filter";
    case "carbon_dioxide":
      return "mdi:molecule-co2";
    case "volatile_organic_compounds":
      return "mdi:molecule";
    case "atmospheric_pressure":
    case "pressure":
      return "mdi:gauge";
    case "illuminance":
      return "mdi:brightness-6";
    default:
      return "mdi:leaf";
  }
}

export function inspectAreaSensors(
  areaId: string,
  hass: HomeAssistant | null | undefined,
  config?: RoomConfig | null,
): AreaSensorInventory {
  const empty: AreaSensorInventory = {
    temperatureSensors: [],
    humiditySensors: [],
    airQualitySensors: [],
    binarySensors: [],
    previewTempC: null,
    previewHumidity: null,
    unlinkedSensorCount: 0,
  };
  if (!hass) return empty;

  const configuredTemp = new Set<string>([
    ...(config?.temperature_sensor ? [config.temperature_sensor] : []),
    ...(config?.temperature_sensors ?? []),
  ]);
  const configuredHum = new Set<string>([
    ...(config?.humidity_sensor ? [config.humidity_sensor] : []),
    ...(config?.humidity_sensors ?? []),
  ]);
  const configuredWin = new Set<string>(config?.window_sensors ?? []);
  const configuredOcc = new Set<string>(config?.occupancy_sensors ?? []);

  const primaryTemp = config?.temperature_sensor || config?.temperature_sensors?.[0] || "";
  const primaryHum = config?.humidity_sensor || config?.humidity_sensors?.[0] || "";

  const areaEntities = getEntitiesForArea(areaId, hass.entities, hass.devices).filter(
    (e) => !isRoomMindEntity(e.entity_id, hass.entities),
  );
  const candidateIds = new Set<string>(areaEntities.map((e) => e.entity_id));
  for (const id of configuredTemp) candidateIds.add(id);
  for (const id of configuredHum) candidateIds.add(id);
  for (const id of configuredWin) candidateIds.add(id);
  for (const id of configuredOcc) candidateIds.add(id);

  const areaEntitySet = new Set(areaEntities.map((e) => e.entity_id));
  const temperatureSensors: DiscoveredTempSensor[] = [];
  const humiditySensors: DiscoveredHumiditySensor[] = [];
  const airQualitySensors: DiscoveredAirQualitySensor[] = [];
  const binarySensors: DiscoveredBinarySensor[] = [];

  for (const entityId of candidateIds) {
    const entityState = hass.states?.[entityId];
    const attrs = entityState?.attributes ?? {};
    const deviceClass = String(attrs.device_class ?? "");
    const name = String(attrs.friendly_name || entityId);

    if (entityId.startsWith("sensor.")) {
      if (deviceClass === "temperature" || configuredTemp.has(entityId)) {
        const rawValue = parseNumericState(entityState?.state);
        const unit = String(attrs.unit_of_measurement ?? "°C");
        const valueC =
          rawValue === null
            ? null
            : unit === "°F" || unit === "F"
              ? Math.round((((rawValue - 32) * 5) / 9) * 10) / 10
              : rawValue;
        temperatureSensors.push({
          entityId,
          name,
          valueC,
          rawValue,
          unit,
          configured: configuredTemp.has(entityId),
          isPrimary: entityId === primaryTemp,
        });
      } else if (deviceClass === "humidity" || configuredHum.has(entityId)) {
        const value = parseNumericState(entityState?.state);
        humiditySensors.push({
          entityId,
          name,
          value,
          configured: configuredHum.has(entityId),
          isPrimary: entityId === primaryHum,
        });
      } else if (AIR_QUALITY_DEVICE_CLASSES.has(deviceClass)) {
        const value = parseNumericState(entityState?.state);
        const unit = String(attrs.unit_of_measurement ?? "");
        const displayValue =
          value !== null ? (Number.isInteger(value) ? String(value) : value.toFixed(1)) : "--";
        airQualitySensors.push({
          entityId,
          name,
          value,
          displayValue,
          unit,
          deviceClass,
          icon: airQualityIcon(deviceClass),
        });
      }
    } else if (entityId.startsWith("binary_sensor.")) {
      const configured = configuredWin.has(entityId) || configuredOcc.has(entityId);
      if (BINARY_ENV_DEVICE_CLASSES.has(deviceClass) || configured) {
        const rawState = entityState?.state;
        const isOn = rawState === "on" ? true : rawState === "off" ? false : null;
        binarySensors.push({
          entityId,
          name,
          isOn,
          deviceClass: deviceClass || (configuredWin.has(entityId) ? "window" : "occupancy"),
          configured,
        });
      }
    }
  }

  // Sort primary first, configured next, then alphabetical
  temperatureSensors.sort(
    (a, b) =>
      Number(b.isPrimary) - Number(a.isPrimary) ||
      Number(b.configured) - Number(a.configured) ||
      a.name.localeCompare(b.name),
  );
  humiditySensors.sort(
    (a, b) =>
      Number(b.isPrimary) - Number(a.isPrimary) ||
      Number(b.configured) - Number(a.configured) ||
      a.name.localeCompare(b.name),
  );
  binarySensors.sort(
    (a, b) => Number(b.configured) - Number(a.configured) || a.name.localeCompare(b.name),
  );

  const validTemps = temperatureSensors.map((s) => s.valueC).filter((v): v is number => v !== null);
  const validHums = humiditySensors.map((s) => s.value).filter((v): v is number => v !== null);

  const previewTempC =
    validTemps.length > 0
      ? Math.round((validTemps.reduce((acc, v) => acc + v, 0) / validTemps.length) * 10) / 10
      : null;
  const previewHumidity =
    validHums.length > 0
      ? Math.round(validHums.reduce((acc, v) => acc + v, 0) / validHums.length)
      : null;

  let unlinkedSensorCount = 0;
  for (const s of temperatureSensors) {
    if (areaEntitySet.has(s.entityId) && !s.configured) unlinkedSensorCount += 1;
  }
  for (const s of humiditySensors) {
    if (areaEntitySet.has(s.entityId) && !s.configured) unlinkedSensorCount += 1;
  }
  for (const s of binarySensors) {
    if (!areaEntitySet.has(s.entityId) || s.configured) continue;
    if (WINDOW_LIKE_CLASSES.has(s.deviceClass) || BINARY_ENV_DEVICE_CLASSES.has(s.deviceClass)) {
      unlinkedSensorCount += 1;
    }
  }

  return {
    temperatureSensors,
    humiditySensors,
    airQualitySensors,
    binarySensors,
    previewTempC,
    previewHumidity,
    unlinkedSensorCount,
  };
}

export function buildTrendSummary(
  points: AnalyticsDataPoint[],
  metric: "temp" | "humidity",
  width = 180,
  height = 44,
): TrendSummary | null {
  const valid: Array<{ ts: number; val: number }> = [];
  for (const p of points) {
    const val = metric === "temp" ? p.room_temp : p.room_humidity;
    if (typeof val === "number" && Number.isFinite(val)) {
      valid.push({ ts: p.ts, val });
    }
  }
  if (valid.length < 2) return null;

  valid.sort((a, b) => a.ts - b.ts);
  let min = valid[0]!.val;
  let max = valid[0]!.val;
  for (const pt of valid) {
    if (pt.val < min) min = pt.val;
    if (pt.val > max) max = pt.val;
  }

  const first = valid[0]!.val;
  const current = valid[valid.length - 1]!.val;
  const delta = Math.round((current - first) * 10) / 10;

  const minTs = valid[0]!.ts;
  const maxTs = valid[valid.length - 1]!.ts;
  const tsSpan = maxTs - minTs;
  const valSpan = max - min;
  const padY = 4;
  const usableH = Math.max(1, height - padY * 2);

  const coords = valid.map((pt, idx) => {
    const x =
      tsSpan > 0
        ? ((pt.ts - minTs) / tsSpan) * width
        : (idx / Math.max(1, valid.length - 1)) * width;
    const normY = valSpan > 0 ? (pt.val - min) / valSpan : 0.5;
    const y = height - padY - normY * usableH;
    return [Number(x.toFixed(1)), Number(y.toFixed(1))] as const;
  });

  const path = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x},${y}`).join(" ");
  const lastX = coords[coords.length - 1]![0];
  const firstX = coords[0]![0];
  const areaPath = `${path} L${lastX},${height} L${firstX},${height} Z`;

  return {
    min,
    max,
    current,
    delta,
    path,
    areaPath,
    count: valid.length,
  };
}
