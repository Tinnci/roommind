import { describe, expect, test } from "bun:test";
import type { AnalyticsDataPoint, HomeAssistant } from "../types";
import { buildChartOptions, buildChartSeries } from "./chart-builder";

const hass: HomeAssistant = {
  language: "en",
  states: {},
  areas: {},
  floors: {},
  entities: {},
  devices: {},
  callWS: (async () => ({})) as HomeAssistant["callWS"],
  callService: async () => undefined,
  config: { unit_system: { temperature: "°C" } },
};

const points: AnalyticsDataPoint[] = [
  {
    ts: 1_000,
    room_temp: 24.5,
    outdoor_temp: 30.0,
    target_temp: 24.0,
    mode: "cooling",
    predicted_temp: 24.4,
    window_open: false,
    heating_power: 45,
    solar_irradiance: null,
    device_setpoint: 23.0,
    perceived_temp: 24.9,
    airflow_plan_level: 0.6,
    blind_position: 40,
    room_humidity: 58,
    outdoor_humidity: 72,
    mold_surface_rh: 63,
  },
  {
    ts: 2_000,
    room_temp: 24.0,
    outdoor_temp: 29.0,
    target_temp: 24.0,
    mode: "dry",
    predicted_temp: 24.1,
    window_open: true,
    heating_power: 0,
    solar_irradiance: null,
    airflow_plan_level: 0.3,
    room_humidity: 54,
  },
  {
    ts: 3_000,
    room_temp: 23.8,
    outdoor_temp: 28.0,
    target_temp: 24.0,
    mode: "fan_only",
    predicted_temp: null,
    window_open: false,
    heating_power: 0,
    solar_irradiance: null,
    airflow_plan_level: 0.4,
    room_humidity: 52,
  },
];

describe("chart-builder multi-lens", () => {
  test("builds temperature lens with device setpoint, perceived temp, dry/fan bands, and theme-neutral now_marker", () => {
    const series = buildChartSeries(points, {
      hass,
      language: "en",
      chartAnchor: 3_000_000,
      rangeStart: 1_000_000,
      rangeEnd: 3_000_000,
      lens: "temperature",
    });

    const ids = series.map((s) => s.id);
    expect(ids).toContain("room_temp");
    expect(ids).toContain("target_temp");
    expect(ids).toContain("predicted_temp");
    expect(ids).toContain("device_setpoint");
    expect(ids).toContain("perceived_temp");
    expect(ids).toContain("outdoor_temp");
    expect(ids).toContain("cooling_events");
    expect(ids).toContain("dry_events");
    expect(ids).toContain("fan_events");
    expect(ids).toContain("window_events");

    const marker = series.find((s) => s.id === "now_marker");
    expect(marker?.color).toBe("rgba(128, 128, 128, 0.55)");
  });

  test("builds activity lens on 0-100% scale", () => {
    const series = buildChartSeries(points, {
      hass,
      language: "en",
      chartAnchor: 3_000_000,
      rangeStart: 1_000_000,
      rangeEnd: 3_000_000,
      lens: "activity",
    });

    const ids = series.map((s) => s.id);
    expect(ids).toContain("heating_power");
    expect(ids).toContain("airflow_level");
    expect(ids).toContain("blind_position");
    const airflow = series.find((s) => s.id === "airflow_level");
    expect(airflow?.data).toEqual([
      [1_000_000, 60],
      [2_000_000, 30],
      [3_000_000, 40],
    ]);

    const options = buildChartOptions([0, 60], points, {
      hass,
      language: "en",
      chartAnchor: 3_000_000,
      rangeStart: 1_000_000,
      rangeEnd: 3_000_000,
      lens: "activity",
    });
    const yAxis = options.yAxis as { min: number; max: number; name: string };
    expect(yAxis.min).toBe(0);
    expect(yAxis.max).toBe(100);
    expect(yAxis.name).toBe("%");
  });

  test("builds humidity lens with room, surface, and outdoor RH series", () => {
    const series = buildChartSeries(points, {
      hass,
      language: "en",
      chartAnchor: 3_000_000,
      rangeStart: 1_000_000,
      rangeEnd: 3_000_000,
      lens: "humidity",
    });

    const ids = series.map((s) => s.id);
    expect(ids).toContain("room_humidity");
    expect(ids).toContain("mold_surface_rh");
    expect(ids).toContain("outdoor_humidity");

    const options = buildChartOptions([52, 63], points, {
      hass,
      language: "en",
      chartAnchor: 3_000_000,
      rangeStart: 1_000_000,
      rangeEnd: 3_000_000,
      lens: "humidity",
    });
    const yAxis = options.yAxis as { min: number; max: number; name: string };
    expect(yAxis.name).toBe("%");
    expect(yAxis.min).toBeGreaterThanOrEqual(0);
    expect(yAxis.max).toBeLessThanOrEqual(100);
  });
});
