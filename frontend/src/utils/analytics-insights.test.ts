import { describe, expect, test } from "bun:test";
import type { AnalyticsData } from "../types";
import { buildAnalyticsInsights } from "./analytics-insights";

const sampleData: AnalyticsData = {
  history: [
    {
      ts: 1_000,
      room_temp: 24.0,
      outdoor_temp: 30.0,
      target_temp: 24.0,
      heat_target: 20.0,
      cool_target: 24.0,
      mode: "cooling",
      predicted_temp: 24.1,
      window_open: false,
      heating_power: 0,
      solar_irradiance: null,
      room_humidity: 55,
      device_setpoint: 23.0,
      perceived_temp: 24.4,
      airflow_plan_level: 0.6,
    },
    {
      ts: 2_000,
      room_temp: 25.2,
      outdoor_temp: 31.0,
      target_temp: 24.0,
      heat_target: 20.0,
      cool_target: 24.0,
      mode: "dry",
      predicted_temp: 24.8,
      window_open: true,
      heating_power: 0,
      solar_irradiance: null,
      room_humidity: 64,
    },
    {
      ts: 3_000,
      room_temp: 23.8,
      outdoor_temp: 29.0,
      target_temp: 24.0,
      heat_target: 20.0,
      cool_target: 24.0,
      mode: "fan_only",
      predicted_temp: null,
      window_open: false,
      heating_power: null,
      solar_irradiance: null,
      room_humidity: 58,
    },
  ],
  detail: [
    {
      ts: 4_000,
      room_temp: 22.0,
      outdoor_temp: 18.0,
      target_temp: 22.0,
      heat_target: 20.0,
      cool_target: 24.0,
      mode: "idle",
      predicted_temp: null,
      window_open: false,
      heating_power: 0,
      solar_irradiance: null,
      room_humidity: 52,
    },
  ],
  forecast: [
    {
      ts: 4_000 + 2 * 3600,
      room_temp: null,
      outdoor_temp: 18.0,
      target_temp: 24.0,
      mode: "idle",
      predicted_temp: 23.0,
      window_open: false,
      heating_power: null,
      solar_irradiance: null,
    },
  ],
  model: {
    confidence: 0.85,
    model: { C: 1, U: 0.1, Q_heat: 2, Q_cool: 3, Q_solar: 0.2, Q_occupancy: 0 },
    n_samples: 100,
    n_observations: 100,
    n_heating: 20,
    n_cooling: 30,
    applicable_modes: ["heating", "cooling"],
    mpc_active: true,
    sigma_e: 0.1,
    prediction_std_idle: 0.2,
    prediction_std_heating: 0.3,
    has_occupancy_sensors: false,
  },
};

describe("buildAnalyticsInsights", () => {
  test("computes temperature range, comfort adherence, humidity, and runtime share", () => {
    const insights = buildAnalyticsInsights(sampleData, { isOutdoor: false });
    expect(insights).not.toBeNull();
    expect(insights?.dataPoints).toBe(4);
    expect(insights?.temp?.latest).toBe(22.0);
    expect(insights?.temp?.min).toBe(22.0);
    expect(insights?.temp?.max).toBe(25.2);
    expect(insights?.comfortAdherencePct).toBe(75);
    expect(insights?.humidity?.latest).toBe(52);
    expect(insights?.humidity?.max).toBe(64);
    expect(insights?.runtime.coolingPct).toBe(25);
    expect(insights?.runtime.dryPct).toBe(25);
    expect(insights?.runtime.fanOnlyPct).toBe(25);
    expect(insights?.runtime.idlePct).toBe(25);
    expect(insights?.runtime.windowOpenPct).toBe(25);
    expect(insights?.forecastHorizonHours).toBe(2);
    expect(insights?.hasDeviceSetpoint).toBe(true);
    expect(insights?.hasPerceivedTemp).toBe(true);
    expect(insights?.hasHumidity).toBe(true);
    expect(insights?.hasActivityLens).toBe(true);
  });

  test("omits indoor comfort and activity lens for outdoor areas", () => {
    const insights = buildAnalyticsInsights(sampleData, { isOutdoor: true });
    expect(insights?.comfortAdherencePct).toBeNull();
    expect(insights?.avgTarget).toBeNull();
    expect(insights?.hasDeviceSetpoint).toBe(false);
    expect(insights?.hasActivityLens).toBe(false);
    expect(insights?.hasHumidity).toBe(true);
  });

  test("returns null when there are no observed points", () => {
    expect(
      buildAnalyticsInsights({ ...sampleData, history: [], detail: [], forecast: [] }),
    ).toBeNull();
  });
});
