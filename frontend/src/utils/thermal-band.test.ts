import { describe, expect, it } from "bun:test";
import type { HomeAssistant, RoomConfig } from "../types";
import { computeThermalBand } from "./thermal-band";

function makeHass(unit: "°C" | "°F" = "°C"): HomeAssistant {
  return {
    callWS: async () => undefined as never,
    callService: async () => undefined,
    states: {
      "climate.living_ac_1": {
        entity_id: "climate.living_ac_1",
        state: "cool",
        attributes: { friendly_name: "Living Main AC", temperature: unit === "°F" ? 73.4 : 23.0 },
      },
      "climate.living_ac_2": {
        entity_id: "climate.living_ac_2",
        state: "cool",
        attributes: { friendly_name: "Living Aux AC", temperature: unit === "°F" ? 75.2 : 24.0 },
      },
    },
    areas: {},
    entities: {},
    devices: {},
    language: "en",
    config: { unit_system: { temperature: unit } },
  };
}

function makeRoom(overrides: Partial<RoomConfig> = {}): RoomConfig {
  return {
    area_id: "living",
    thermostats: [],
    acs: ["climate.living_ac_1", "climate.living_ac_2"],
    devices: [
      { entity_id: "climate.living_ac_1", type: "ac", role: "primary" },
      { entity_id: "climate.living_ac_2", type: "ac", role: "secondary" },
    ],
    temperature_sensor: "sensor.living_temp",
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
    live: {
      current_temp: 25.0,
      perceived_temp: 26.2,
      current_humidity: 60,
      target_temp: 24.0,
      heat_target: 21.0,
      cool_target: 24.0,
      mode: "cooling",
      heating_power: 60,
      device_setpoint: 23.0,
      override_active: false,
      override_type: null,
      override_temp: null,
      override_until: null,
      override_suppressed: false,
      active_schedule_index: -1,
      window_open: false,
      confidence: 0.9,
      mpc_active: true,
      presence_away: false,
      mold_risk_level: "ok",
      mold_surface_rh: null,
      mold_prevention_active: false,
      mold_prevention_delta: 0,
      blind_position: null,
      cover_auto_paused: false,
      cover_forced_reason: "",
      active_cover_schedule_index: -1,
      active_heat_sources: null,
      learning_paused_reason: null,
      device_observations: [
        {
          entity_id: "climate.living_ac_1",
          available: true,
          assumed_state: false,
          hvac_mode: "cool",
          temperature: 23.0,
          target_temp_low: null,
          target_temp_high: null,
        },
        {
          entity_id: "climate.living_ac_2",
          available: true,
          assumed_state: false,
          hvac_mode: "cool",
          temperature: 24.0,
          target_temp_low: null,
          target_temp_high: null,
        },
      ],
    },
    ...overrides,
  };
}

describe("computeThermalBand", () => {
  it("computes scale, comfort band, perceived pin, and multi-device pins", () => {
    const model = computeThermalBand(makeRoom(), makeHass());
    expect(model).not.toBeNull();
    expect(model!.bandLowC).toBe(21.0);
    expect(model!.bandHighC).toBe(24.0);
    expect(model!.currentTempC).toBe(25.0);
    expect(model!.perceivedTempC).toBe(26.2);
    expect(model!.devicePins).toHaveLength(2);
    expect(model!.devicePins[0]!.name).toBe("Living Main AC");
    expect(model!.devicePins[0]!.percent).toBeLessThan(model!.devicePins[1]!.percent);
    expect(model!.bandStartPct).toBeGreaterThan(0);
    expect(model!.bandWidthPct).toBeGreaterThan(0);
  });

  it("omits comfort band and target in off/dry/fan_only modes while preserving current temp", () => {
    const room = makeRoom({ climate_mode: "dry" });
    const model = computeThermalBand(room, makeHass());
    expect(model).not.toBeNull();
    expect(model!.bandLowC).toBeNull();
    expect(model!.targetTempC).toBeNull();
    expect(model!.currentTempC).toBe(25.0);
  });

  it("converts Fahrenheit HA state fallback into Celsius when observation is absent", () => {
    const room = makeRoom();
    room.live!.device_observations = [];
    const model = computeThermalBand(room, makeHass("°F"));
    expect(model).not.toBeNull();
    expect(model!.devicePins[0]!.tempC).toBeCloseTo(23.0, 1);
  });

  it("returns null when there are no numeric temperatures at all", () => {
    const room = makeRoom({
      climate_mode: "off",
      devices: [],
      acs: [],
    });
    delete room.live;
    expect(computeThermalBand(room, makeHass())).toBeNull();
  });
});
