import { describe, expect, it } from "bun:test";
import type { CompressorGroup, HomeAssistant, RoomConfig } from "../types";
import { buildThermostatFleet } from "./thermostat-fleet";

function makeHass(): HomeAssistant {
  return {
    callWS: async () => undefined as never,
    callService: async () => undefined,
    states: {
      "climate.living_main": {
        entity_id: "climate.living_main",
        state: "cool",
        attributes: {
          friendly_name: "Living Main AC",
          current_temperature: 26.2,
          temperature: 22.0,
          fan_mode: "high",
        },
      },
      "climate.living_aux": {
        entity_id: "climate.living_aux",
        state: "dry",
        attributes: {
          friendly_name: "Living Aux AC",
          current_temperature: 25.8,
          temperature: null,
          fan_mode: "low",
        },
      },
      "climate.study_ac": {
        entity_id: "climate.study_ac",
        state: "heat",
        attributes: {
          friendly_name: "Study AC",
          current_temperature: 20.0,
          temperature: 22.0,
        },
      },
    },
    areas: {},
    entities: {},
    devices: {},
    language: "en",
    config: { unit_system: { temperature: "°C" } },
  };
}

function makeRoom(overrides: Partial<RoomConfig> = {}): RoomConfig {
  return {
    area_id: "living",
    thermostats: [],
    acs: ["climate.living_main", "climate.living_aux"],
    devices: [
      { entity_id: "climate.living_main", type: "ac", role: "primary" },
      { entity_id: "climate.living_aux", type: "ac", role: "secondary" },
    ],
    temperature_sensor: "sensor.living_temp",
    humidity_sensor: "",
    window_sensors: [],
    window_open_delay: 0,
    window_close_delay: 0,
    climate_mode: "cool_only",
    schedules: [],
    schedule_selector_entity: "",
    comfort_heat: 21,
    comfort_cool: 24,
    eco_heat: 18,
    eco_cool: 27,
    live: {
      current_temp: 26.0,
      current_humidity: 64,
      target_temp: 24.0,
      heat_target: 21.0,
      cool_target: 24.0,
      mode: "cooling",
      heating_power: 70,
      device_setpoint: 22.0,
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
          entity_id: "climate.living_main",
          available: true,
          assumed_state: false,
          hvac_mode: "cool",
          temperature: 22.0,
          target_temp_low: null,
          target_temp_high: null,
        },
        {
          entity_id: "climate.living_aux",
          available: true,
          assumed_state: false,
          hvac_mode: "dry",
          temperature: null,
          target_temp_low: null,
          target_temp_high: null,
        },
      ],
      device_actuation_status: [
        {
          entity_id: "climate.living_main",
          service: "set_temperature",
          desired: { temperature: 22.0 },
          dispatch: "sent",
          acceptance: "accepted",
          application: "confirmed",
        },
        {
          entity_id: "climate.living_aux",
          service: "set_hvac_mode",
          desired: { hvac_mode: "dry" },
          dispatch: "sent",
          acceptance: "accepted",
          application: "confirmed",
        },
      ],
    },
    ...overrides,
  };
}

describe("buildThermostatFleet", () => {
  it("merges per-unit observations, overdrive offset, fan mode, and feedback", () => {
    const groups: CompressorGroup[] = [
      {
        id: "vrf_1",
        name: "Outdoor VRF",
        members: ["climate.living_main", "climate.living_aux"],
        min_run_minutes: 3,
        min_off_minutes: 3,
        master_entity: "climate.living_main",
        conflict_resolution: "cooling_priority",
        action_script: "",
        enforce_uniform_mode: true,
      },
    ];
    const fleet = buildThermostatFleet(makeRoom(), makeHass(), groups);
    expect(fleet.total).toBe(2);
    expect(fleet.active).toBe(2);
    expect(fleet.hasConflict).toBe(false);
    expect(fleet.sharedCompressorGroups).toEqual(["Outdoor VRF"]);

    const [main, aux] = fleet.units;
    expect(main!.name).toBe("Living Main AC");
    expect(main!.role).toBe("primary");
    expect(main!.isMaster).toBe(true);
    expect(main!.fanMode).toBe("high");
    expect(main!.overdriveDeltaC).toBeCloseTo(-2.0, 2);
    expect(main!.feedback).toBe("confirmed");

    expect(aux!.hvacMode).toBe("dry");
    expect(aux!.isMaster).toBe(false);
    expect(aux!.overdriveDeltaC).toBeNull();
  });

  it("flags compressor conflict when shared compressor members oppose in heat vs cool", () => {
    const groups: CompressorGroup[] = [
      {
        id: "vrf_1",
        name: "Outdoor VRF",
        members: ["climate.living_main", "climate.study_ac"],
        min_run_minutes: 3,
        min_off_minutes: 3,
        master_entity: "climate.living_main",
        conflict_resolution: "cooling_priority",
        action_script: "",
        enforce_uniform_mode: true,
      },
    ];
    const fleet = buildThermostatFleet(makeRoom(), makeHass(), groups);
    expect(fleet.hasConflict).toBe(true);
    expect(fleet.units[0]!.hasConflict).toBe(true);
  });

  it("falls back to legacy thermostats + acs arrays when devices is omitted", () => {
    const room = makeRoom({
      thermostats: ["climate.living_main"],
      acs: ["climate.living_aux"],
    });
    delete room.devices;
    const fleet = buildThermostatFleet(room, makeHass());
    expect(fleet.total).toBe(2);
    expect(fleet.units[0]!.type).toBe("trv");
    expect(fleet.units[1]!.type).toBe("ac");
  });
});
