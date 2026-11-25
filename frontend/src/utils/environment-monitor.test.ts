import { describe, expect, test } from "bun:test";
import type { AnalyticsDataPoint, HomeAssistant, RoomConfig } from "../types";
import {
  assessRoomComfort,
  buildTrendSummary,
  calculateDewPointC,
  findThermalNeighbors,
  hasConfiguredSensors,
  inspectAreaSensors,
  isMonitorOnlyRoom,
} from "./environment-monitor";

function makeRoom(overrides: Partial<RoomConfig> = {}): RoomConfig {
  return {
    area_id: "living",
    thermostats: [],
    acs: [],
    devices: [],
    temperature_sensor: "",
    humidity_sensor: "",
    window_sensors: [],
    window_open_delay: 0,
    window_close_delay: 0,
    climate_mode: "auto",
    schedules: [],
    schedule_selector_entity: "",
    comfort_heat: 21,
    comfort_cool: 24,
    eco_heat: 18,
    eco_cool: 27,
    ...overrides,
  };
}

describe("environment-monitor", () => {
  test("detects monitor-only rooms and configured sensors cleanly", () => {
    const monitored = makeRoom({ temperature_sensor: "sensor.temp" });
    const aqOnly = makeRoom({ co2_sensor: "sensor.co2" });
    const withDevice = makeRoom({
      devices: [{ entity_id: "climate.ac", type: "ac", role: "auto" }],
      temperature_sensor: "sensor.temp",
    });
    const outdoor = makeRoom({ is_outdoor: true, temperature_sensor: "sensor.temp" });

    expect(hasConfiguredSensors(monitored)).toBe(true);
    expect(hasConfiguredSensors(aqOnly)).toBe(true);
    expect(hasConfiguredSensors(makeRoom())).toBe(false);
    expect(isMonitorOnlyRoom(monitored)).toBe(true);
    expect(isMonitorOnlyRoom(withDevice)).toBe(false);
    expect(isMonitorOnlyRoom(outdoor)).toBe(false);
    expect(isMonitorOnlyRoom(null)).toBe(false);
  });

  test("finds bidirectional thermal neighbors for monitor-only rooms", () => {
    const living = makeRoom({ area_id: "ke_ting" });
    const bedroom = makeRoom({
      area_id: "wo_shi",
      devices: [{ entity_id: "climate.bedroom_ac", type: "ac", role: "auto" }],
      adjacent_rooms: [{ area_id: "ke_ting", enabled: true, allow_borrowed_conditioning: true }],
      live: { current_temp: 21.2, mode: "heating" } as NonNullable<RoomConfig["live"]>,
    });
    const hass = {
      areas: {
        ke_ting: { area_id: "ke_ting", name: "Living Room", picture: null, floor_id: null },
        wo_shi: { area_id: "wo_shi", name: "Bedroom", picture: null, floor_id: null },
      },
    } as unknown as HomeAssistant;

    const neighbors = findThermalNeighbors(
      "ke_ting",
      living,
      { ke_ting: living, wo_shi: bedroom },
      hass,
      19.8,
    );
    expect(neighbors).toEqual([
      {
        areaId: "wo_shi",
        name: "Bedroom",
        currentTemp: 21.2,
        deltaC: 1.4,
        mode: "heating",
        borrowedConditioning: true,
        hasClimate: true,
      },
    ]);
  });

  test("computes Magnus-Tetens dew point accurately", () => {
    expect(calculateDewPointC(20, 50)).toBe(9.3);
    expect(calculateDewPointC(25, 60)).toBe(16.7);
    expect(calculateDewPointC(null, 50)).toBeNull();
    expect(calculateDewPointC(20, 0)).toBeNull();
    expect(calculateDewPointC(20, 110)).toBeNull();
  });

  test("assesses room comfort with clear priority order", () => {
    expect(assessRoomComfort(21, 50, "critical")?.status).toBe("mold_risk");
    expect(assessRoomComfort(21, 50, "warning")?.tone).toBe("warning");
    expect(assessRoomComfort(22, 68, "ok")?.status).toBe("humid");
    expect(assessRoomComfort(22, 25, "ok")?.status).toBe("dry");
    expect(assessRoomComfort(16.5, 45, "ok")?.status).toBe("cool");
    expect(assessRoomComfort(27.5, 45, "ok")?.status).toBe("warm");
    expect(assessRoomComfort(22.0, 48, "ok")?.status).toBe("comfortable");
    expect(assessRoomComfort(null, null, "ok")).toBeNull();
  });

  test("inspects area sensors including Fahrenheit conversion, AQ sensors, and unlinked count", () => {
    const hass: HomeAssistant = {
      callWS: async () => undefined as never,
      callService: async () => undefined,
      language: "en",
      config: { unit_system: { temperature: "°C" } },
      areas: {
        living: { area_id: "living", name: "Living Room", picture: null, floor_id: null },
      },
      devices: {
        dev_aq: { id: "dev_aq", area_id: "living" },
      },
      entities: {
        "sensor.lr_temp": {
          entity_id: "sensor.lr_temp",
          area_id: "living",
          device_id: null,
          platform: "xiaomi",
        },
        "sensor.lr_temp_f": {
          entity_id: "sensor.lr_temp_f",
          area_id: null,
          device_id: "dev_aq",
          platform: "xiaomi",
        },
        "sensor.lr_hum": {
          entity_id: "sensor.lr_hum",
          area_id: "living",
          device_id: null,
          platform: "xiaomi",
        },
        "sensor.lr_pm25": {
          entity_id: "sensor.lr_pm25",
          area_id: null,
          device_id: "dev_aq",
          platform: "xiaomi",
        },
        "binary_sensor.lr_win": {
          entity_id: "binary_sensor.lr_win",
          area_id: "living",
          device_id: null,
          platform: "xiaomi",
        },
        "sensor.roommind_living_temp": {
          entity_id: "sensor.roommind_living_temp",
          area_id: "living",
          device_id: null,
          platform: "roommind",
        },
      },
      states: {
        "sensor.lr_temp": {
          entity_id: "sensor.lr_temp",
          state: "22.0",
          attributes: {
            device_class: "temperature",
            unit_of_measurement: "°C",
            friendly_name: "LR Temp",
          },
        },
        "sensor.lr_temp_f": {
          entity_id: "sensor.lr_temp_f",
          state: "68.0",
          attributes: {
            device_class: "temperature",
            unit_of_measurement: "°F",
            friendly_name: "LR F Temp",
          },
        },
        "sensor.lr_hum": {
          entity_id: "sensor.lr_hum",
          state: "48",
          attributes: {
            device_class: "humidity",
            unit_of_measurement: "%",
            friendly_name: "LR Hum",
          },
        },
        "sensor.lr_pm25": {
          entity_id: "sensor.lr_pm25",
          state: "14",
          attributes: {
            device_class: "pm25",
            unit_of_measurement: "μg/m³",
            friendly_name: "LR PM2.5",
          },
        },
        "binary_sensor.lr_win": {
          entity_id: "binary_sensor.lr_win",
          state: "off",
          attributes: { device_class: "window", friendly_name: "LR Window" },
        },
        "sensor.roommind_living_temp": {
          entity_id: "sensor.roommind_living_temp",
          state: "22.0",
          attributes: { device_class: "temperature", unit_of_measurement: "°C" },
        },
      },
    };

    const config = makeRoom({
      area_id: "living",
      temperature_sensor: "sensor.lr_temp",
      temperature_sensors: ["sensor.lr_temp"],
    });

    const inv = inspectAreaSensors("living", hass, config);
    expect(
      inv.temperatureSensors.map((s) => [s.entityId, s.valueC, s.isPrimary, s.configured]),
    ).toEqual([
      ["sensor.lr_temp", 22.0, true, true],
      ["sensor.lr_temp_f", 20.0, false, false],
    ]);
    expect(inv.humiditySensors).toHaveLength(1);
    expect(inv.humiditySensors[0]?.value).toBe(48);
    expect(inv.airQualitySensors.map((s) => s.entityId)).toEqual(["sensor.lr_pm25"]);
    expect(inv.binarySensors[0]?.isOn).toBe(false);
    expect(inv.previewTempC).toBe(21.0);
    expect(inv.previewHumidity).toBe(48);
    // lr_temp_f + lr_hum + lr_win are unlinked
    expect(inv.unlinkedSensorCount).toBe(3);
  });

  test("builds 24h SVG trend summary and requires at least 2 points", () => {
    const singlePoint: AnalyticsDataPoint[] = [
      {
        ts: 100,
        room_temp: 21.0,
        outdoor_temp: 10,
        target_temp: null,
        mode: "idle",
        predicted_temp: null,
        window_open: false,
        heating_power: 0,
        solar_irradiance: 0,
      },
    ];
    expect(buildTrendSummary(singlePoint, "temp")).toBeNull();

    const points: AnalyticsDataPoint[] = [
      {
        ts: 100,
        room_temp: 20.0,
        room_humidity: 50,
        outdoor_temp: 10,
        target_temp: null,
        mode: "idle",
        predicted_temp: null,
        window_open: false,
        heating_power: 0,
        solar_irradiance: 0,
      },
      {
        ts: 200,
        room_temp: 21.5,
        room_humidity: 46,
        outdoor_temp: 10,
        target_temp: null,
        mode: "idle",
        predicted_temp: null,
        window_open: false,
        heating_power: 0,
        solar_irradiance: 0,
      },
      {
        ts: 300,
        room_temp: 21.0,
        room_humidity: 48,
        outdoor_temp: 10,
        target_temp: null,
        mode: "idle",
        predicted_temp: null,
        window_open: false,
        heating_power: 0,
        solar_irradiance: 0,
      },
    ];
    const summary = buildTrendSummary(points, "temp");
    expect(summary).not.toBeNull();
    expect(summary!.min).toBe(20.0);
    expect(summary!.max).toBe(21.5);
    expect(summary!.current).toBe(21.0);
    expect(summary!.delta).toBe(1.0);
    expect(summary!.path.startsWith("M0,")).toBe(true);
    expect(summary!.areaPath.endsWith("Z")).toBe(true);
  });
});
