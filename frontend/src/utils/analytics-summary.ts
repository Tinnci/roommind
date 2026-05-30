import type { AnalyticsData, AnalyticsDataPoint } from "../types";

export type AnalyticsSummaryMetricId =
  | "latest_temp"
  | "avg_temp"
  | "avg_target"
  | "avg_deviation"
  | "heating_share"
  | "cooling_share"
  | "window_open_share"
  | "forecast_horizon"
  | "data_points";

export type AnalyticsSummaryKind = "temperature" | "delta" | "percent" | "hours" | "count";

export interface AnalyticsSummaryMetric {
  id: AnalyticsSummaryMetricId;
  kind: AnalyticsSummaryKind;
  value: number;
  tone?: "neutral" | "heating" | "cooling" | "warning";
}

export interface AnalyticsSummaryOptions {
  isOutdoor?: boolean;
}

export function buildAnalyticsSummary(
  data: AnalyticsData | null,
  options: AnalyticsSummaryOptions = {},
): AnalyticsSummaryMetric[] {
  const points = sortedObservedPoints(data);
  if (points.length === 0) return [];

  const metrics: AnalyticsSummaryMetric[] = [];
  const latestTemp = latestNumber(points, "room_temp");
  const avgTemp = average(points.map((point) => point.room_temp));
  if (latestTemp != null) {
    metrics.push({ id: "latest_temp", kind: "temperature", value: latestTemp });
  }
  if (avgTemp != null) {
    metrics.push({ id: "avg_temp", kind: "temperature", value: avgTemp });
  }

  if (!options.isOutdoor) {
    const avgTarget = average(points.map((point) => point.target_temp));
    const avgDeviation = average(
      points
        .filter((point) => point.room_temp != null && point.target_temp != null)
        .map((point) => Math.abs(point.room_temp! - point.target_temp!)),
    );
    if (avgTarget != null) {
      metrics.push({ id: "avg_target", kind: "temperature", value: avgTarget });
    }
    if (avgDeviation != null) {
      metrics.push({ id: "avg_deviation", kind: "delta", value: avgDeviation });
    }
    metrics.push(
      {
        id: "heating_share",
        kind: "percent",
        value: share(points, (point) => point.mode === "heating"),
        tone: "heating",
      },
      {
        id: "cooling_share",
        kind: "percent",
        value: share(points, (point) => point.mode === "cooling"),
        tone: "cooling",
      },
      {
        id: "window_open_share",
        kind: "percent",
        value: share(points, (point) => point.window_open),
        tone: "warning",
      },
    );
  }

  const horizon = forecastHorizonHours(points, data?.forecast ?? []);
  if (horizon != null && horizon > 0) {
    metrics.push({ id: "forecast_horizon", kind: "hours", value: horizon });
  }
  metrics.push({ id: "data_points", kind: "count", value: points.length });
  return metrics;
}

function sortedObservedPoints(data: AnalyticsData | null): AnalyticsDataPoint[] {
  return [...(data?.history ?? []), ...(data?.detail ?? [])]
    .filter((point) => Number.isFinite(point.ts))
    .sort((a, b) => a.ts - b.ts);
}

function latestNumber(points: AnalyticsDataPoint[], key: keyof AnalyticsDataPoint): number | null {
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const value = points[index]?.[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function average(values: Array<number | null | undefined>): number | null {
  const finite = values.filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value),
  );
  if (finite.length === 0) return null;
  return finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

function share(
  points: AnalyticsDataPoint[],
  predicate: (point: AnalyticsDataPoint) => boolean,
): number {
  if (points.length === 0) return 0;
  return (points.filter(predicate).length / points.length) * 100;
}

function forecastHorizonHours(
  points: AnalyticsDataPoint[],
  forecast: AnalyticsDataPoint[],
): number | null {
  const lastObservedTs = points.at(-1)?.ts;
  const forecastTimestamps = forecast
    .map((point) => point.ts)
    .filter((ts) => Number.isFinite(ts))
    .sort((a, b) => a - b);
  const lastForecastTs = forecastTimestamps.at(-1);
  if (lastObservedTs == null || lastForecastTs == null || lastForecastTs <= lastObservedTs) {
    return null;
  }
  return (lastForecastTs - lastObservedTs) / 3600;
}
