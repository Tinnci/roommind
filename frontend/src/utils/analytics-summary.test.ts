import { describe, expect, test } from "bun:test";

import { buildAnalyticsSummary } from "./analytics-summary";
import type { AnalyticsData } from "../types";

const data: AnalyticsData = {
  history: [
    {
      ts: 1_000,
      room_temp: 20,
      outdoor_temp: 5,
      target_temp: 21,
      mode: "heating",
      predicted_temp: null,
      window_open: false,
      heating_power: 70,
      solar_irradiance: null,
    },
    {
      ts: 2_000,
      room_temp: 22,
      outdoor_temp: 6,
      target_temp: 21,
      mode: "cooling",
      predicted_temp: null,
      window_open: true,
      heating_power: null,
      solar_irradiance: null,
    },
  ],
  detail: [
    {
      ts: 3_000,
      room_temp: 21,
      outdoor_temp: 7,
      target_temp: 21,
      mode: "idle",
      predicted_temp: null,
      window_open: false,
      heating_power: 0,
      solar_irradiance: null,
    },
  ],
  forecast: [
    {
      ts: 3_000 + 3 * 60 * 60,
      room_temp: null,
      outdoor_temp: 8,
      target_temp: 21,
      mode: "idle",
      predicted_temp: 21.5,
      window_open: false,
      heating_power: null,
      solar_irradiance: null,
    },
  ],
  model: {
    confidence: 0,
    model: { C: 0, U: 0, Q_heat: 0, Q_cool: 0, Q_solar: 0, Q_occupancy: 0 },
    n_samples: 0,
    n_observations: 0,
    n_heating: 0,
    n_cooling: 0,
    applicable_modes: [],
    mpc_active: false,
    sigma_e: 0,
    prediction_std_idle: 0,
    prediction_std_heating: 0,
    has_occupancy_sensors: false,
  },
};

describe("buildAnalyticsSummary", () => {
  test("builds indoor chart summary metrics from history and detail points", () => {
    const summary = buildAnalyticsSummary(data, { isOutdoor: false });

    expect(summary.map((metric) => metric.id)).toEqual([
      "latest_temp",
      "avg_temp",
      "avg_target",
      "avg_deviation",
      "heating_share",
      "cooling_share",
      "window_open_share",
      "forecast_horizon",
      "data_points",
    ]);
    expect(summary.find((metric) => metric.id === "latest_temp")?.value).toBe(21);
    expect(summary.find((metric) => metric.id === "avg_temp")?.value).toBe(21);
    expect(summary.find((metric) => metric.id === "avg_deviation")?.value).toBeCloseTo(0.67, 2);
    expect(summary.find((metric) => metric.id === "heating_share")?.value).toBeCloseTo(33.33, 2);
    expect(summary.find((metric) => metric.id === "forecast_horizon")?.value).toBe(3);
  });

  test("omits indoor-only target and runtime metrics for outdoor areas", () => {
    const summary = buildAnalyticsSummary(data, { isOutdoor: true });

    expect(summary.map((metric) => metric.id)).toEqual([
      "latest_temp",
      "avg_temp",
      "forecast_horizon",
      "data_points",
    ]);
  });

  test("returns no metrics when there are no chart points", () => {
    expect(buildAnalyticsSummary({ ...data, history: [], detail: [], forecast: [] })).toEqual([]);
  });
});
