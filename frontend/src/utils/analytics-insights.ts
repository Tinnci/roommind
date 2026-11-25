import type { AnalyticsData, AnalyticsDataPoint } from "../types";

export interface AnalyticsRangeStat {
  latest: number;
  avg: number;
  min: number;
  max: number;
}

export interface AnalyticsRuntimeBreakdown {
  heatingPct: number;
  coolingPct: number;
  dryPct: number;
  fanOnlyPct: number;
  idlePct: number;
  windowOpenPct: number;
}

export interface AnalyticsInsights {
  dataPoints: number;
  temp: AnalyticsRangeStat | null;
  avgTarget: number | null;
  avgDeviation: number | null;
  comfortAdherencePct: number | null;
  runtime: AnalyticsRuntimeBreakdown;
  humidity: AnalyticsRangeStat | null;
  forecastHorizonHours: number | null;
  hasDeviceSetpoint: boolean;
  hasPerceivedTemp: boolean;
  hasHumidity: boolean;
  hasActivityLens: boolean;
}

export interface AnalyticsInsightsOptions {
  isOutdoor?: boolean;
}

function sortedObservedPoints(data: AnalyticsData | null): AnalyticsDataPoint[] {
  return [...(data?.history ?? []), ...(data?.detail ?? [])]
    .filter((point) => Number.isFinite(point.ts))
    .sort((a, b) => a.ts - b.ts);
}

function computeRangeStat(values: Array<number | null | undefined>): AnalyticsRangeStat | null {
  const finite = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (finite.length === 0) return null;
  const latest = finite[finite.length - 1]!;
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const v of finite) {
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
  }
  return {
    latest,
    avg: sum / finite.length,
    min,
    max,
  };
}

function average(values: Array<number | null | undefined>): number | null {
  const finite = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (finite.length === 0) return null;
  return finite.reduce((sum, v) => sum + v, 0) / finite.length;
}

function computeForecastHorizonHours(
  points: AnalyticsDataPoint[],
  forecast: AnalyticsDataPoint[],
): number | null {
  const lastObservedTs = points.at(-1)?.ts;
  const forecastTimestamps = forecast
    .map((p) => p.ts)
    .filter((ts) => Number.isFinite(ts))
    .sort((a, b) => a - b);
  const lastForecastTs = forecastTimestamps.at(-1);
  if (lastObservedTs == null || lastForecastTs == null || lastForecastTs <= lastObservedTs) {
    return null;
  }
  return (lastForecastTs - lastObservedTs) / 3600;
}

export function buildAnalyticsInsights(
  data: AnalyticsData | null,
  options: AnalyticsInsightsOptions = {},
): AnalyticsInsights | null {
  const points = sortedObservedPoints(data);
  if (points.length === 0) return null;

  const isOutdoor = Boolean(options.isOutdoor);
  const total = points.length;
  const temp = computeRangeStat(points.map((p) => p.room_temp));
  const humidity = computeRangeStat(points.map((p) => p.room_humidity));

  let avgTarget: number | null = null;
  let avgDeviation: number | null = null;
  let comfortAdherencePct: number | null = null;

  if (!isOutdoor) {
    avgTarget = average(points.map((p) => p.target_temp));
    avgDeviation = average(
      points
        .filter((p) => p.room_temp != null && p.target_temp != null)
        .map((p) => Math.abs(p.room_temp! - p.target_temp!)),
    );

    const comfortEligible = points.filter(
      (p) =>
        p.room_temp != null &&
        ((p.heat_target != null && p.cool_target != null) || p.target_temp != null),
    );
    if (comfortEligible.length > 0) {
      const comfortableCount = comfortEligible.filter((p) => {
        const roomT = p.room_temp!;
        if (p.heat_target != null && p.cool_target != null) {
          return roomT >= p.heat_target - 0.5 && roomT <= p.cool_target + 0.5;
        }
        return Math.abs(roomT - p.target_temp!) <= 0.5;
      }).length;
      comfortAdherencePct = (comfortableCount / comfortEligible.length) * 100;
    }
  }

  let heatCount = 0;
  let coolCount = 0;
  let dryCount = 0;
  let fanOnlyCount = 0;
  let windowCount = 0;

  let hasDeviceSetpoint = false;
  let hasPerceivedTemp = false;
  let hasActivitySignal = false;

  for (const p of points) {
    if (p.mode === "heating") heatCount += 1;
    else if (p.mode === "cooling") coolCount += 1;
    else if (p.mode === "dry") dryCount += 1;
    else if (p.mode === "fan_only") fanOnlyCount += 1;
    if (p.window_open) windowCount += 1;

    if (p.device_setpoint != null) hasDeviceSetpoint = true;
    if (p.perceived_temp != null) hasPerceivedTemp = true;
    if (
      p.heating_power != null ||
      p.airflow_plan_level != null ||
      p.blind_position != null ||
      (p.mode && p.mode !== "idle")
    ) {
      hasActivitySignal = true;
    }
  }

  const idleCount = Math.max(0, total - heatCount - coolCount - dryCount - fanOnlyCount);

  return {
    dataPoints: total,
    temp,
    avgTarget,
    avgDeviation,
    comfortAdherencePct,
    runtime: {
      heatingPct: (heatCount / total) * 100,
      coolingPct: (coolCount / total) * 100,
      dryPct: (dryCount / total) * 100,
      fanOnlyPct: (fanOnlyCount / total) * 100,
      idlePct: (idleCount / total) * 100,
      windowOpenPct: (windowCount / total) * 100,
    },
    humidity,
    forecastHorizonHours: computeForecastHorizonHours(points, data?.forecast ?? []),
    hasDeviceSetpoint: !isOutdoor && hasDeviceSetpoint,
    hasPerceivedTemp: !isOutdoor && hasPerceivedTemp,
    hasHumidity: humidity !== null,
    hasActivityLens: !isOutdoor && hasActivitySignal,
  };
}
