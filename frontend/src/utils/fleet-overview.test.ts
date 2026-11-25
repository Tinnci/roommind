import { describe, expect, it } from "bun:test";
import type { AreaInfo, HomeAssistant, RoomConfig } from "../types";
import { matchesFleetFilter, summarizeFleetOverview } from "./fleet-overview";

function makeHass(): HomeAssistant {
  return {
    callWS: async () => undefined as never,
    callService: async () => undefined,
    states: {
      "climate.lr_1": {
        entity_id: "climate.lr_1",
        state: "dry",
        attributes: { friendly_name: "LR AC 1" },
      },
      "climate.lr_2": {
        entity_id: "climate.lr_2",
        state: "dry",
        attributes: { friendly_name: "LR AC 2" },
      },
      "climate.bed_1": {
        entity_id: "climate.bed_1",
        state: "off",
        attributes: { friendly_name: "Bed AC" },
      },
    },
    areas: {},
    entities: {},
    devices: {},
    language: "en",
    config: { unit_system: { temperature: "°C" } },
  };
}

function makeAreaInfo(areaId: string, config: RoomConfig): AreaInfo {
  return {
    area: { area_id: areaId, name: areaId, picture: null, floor_id: null },
    config,
    climateEntityCount: 1,
    tempSensorCount: 1,
  };
}

function makeRoom(overrides: Partial<RoomConfig>): RoomConfig {
  return {
    area_id: "room",
    thermostats: [],
    acs: [],
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

describe("fleet-overview", () => {
  const hass = makeHass();
  const living = makeAreaInfo(
    "living",
    makeRoom({
      area_id: "living",
      climate_mode: "dry",
      devices: [
        { entity_id: "climate.lr_1", type: "ac", role: "primary" },
        { entity_id: "climate.lr_2", type: "ac", role: "secondary" },
      ],
      live: {
        current_temp: 25,
        current_humidity: 68,
        target_temp: null,
        heat_target: null,
        cool_target: null,
        mode: "dry",
        commanded_mode: "dry",
        observed_mode: "dry",
        heating_power: 0,
        device_setpoint: null,
        override_active: false,
        override_type: null,
        override_temp: null,
        override_until: null,
        override_suppressed: false,
        active_schedule_index: -1,
        window_open: false,
        confidence: 0.9,
        mpc_active: false,
        presence_away: false,
        mold_risk_level: "warning",
        mold_surface_rh: 78,
        mold_prevention_active: false,
        mold_prevention_delta: 0,
        blind_position: null,
        cover_auto_paused: false,
        cover_forced_reason: "",
        active_cover_schedule_index: -1,
        active_heat_sources: null,
        learning_paused_reason: null,
      },
    }),
  );

  const bedroom = makeAreaInfo(
    "bedroom",
    makeRoom({
      area_id: "bedroom",
      climate_mode: "off",
      devices: [{ entity_id: "climate.bed_1", type: "ac", role: "auto" }],
      live: {
        current_temp: 23,
        current_humidity: 50,
        target_temp: null,
        heat_target: null,
        cool_target: null,
        mode: "idle",
        observed_mode: "idle",
        heating_power: 0,
        device_setpoint: null,
        override_active: false,
        override_type: null,
        override_temp: null,
        override_until: null,
        override_suppressed: false,
        active_schedule_index: -1,
        window_open: false,
        confidence: 0.9,
        mpc_active: false,
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
      },
    }),
  );

  it("summarizes rooms, multi-unit counts, dry/cooling, off, and attention rooms", () => {
    const stats = summarizeFleetOverview([living, bedroom], hass, true);
    expect(stats.configuredRooms).toBe(2);
    expect(stats.totalUnits).toBe(3);
    expect(stats.activeUnits).toBe(2);
    expect(stats.activeRooms).toBe(1);
    expect(stats.coolingDryingRooms).toBe(1);
    expect(stats.heatingRooms).toBe(0);
    expect(stats.offIdleRooms).toBe(1);
    expect(stats.attentionRooms).toBe(1);
    expect(stats.multiUnitRooms).toBe(1);
  });

  it("filters areas cleanly by fleet filter", () => {
    expect(matchesFleetFilter(living, "multi_unit", hass, true)).toBe(true);
    expect(matchesFleetFilter(bedroom, "multi_unit", hass, true)).toBe(false);
    expect(matchesFleetFilter(living, "cooling", hass, true)).toBe(true);
    expect(matchesFleetFilter(bedroom, "off", hass, true)).toBe(true);
    expect(matchesFleetFilter(living, "attention", hass, true)).toBe(true);
    expect(matchesFleetFilter(bedroom, "attention", hass, true)).toBe(false);
  });

  it("counts and filters monitor-only rooms without mixing active climate unit counts", () => {
    const hallway = makeAreaInfo(
      "hallway",
      makeRoom({
        area_id: "hallway",
        devices: [],
        temperature_sensor: "sensor.hall_temp",
        live: {
          current_temp: 22,
          current_humidity: 70,
          target_temp: null,
          heat_target: null,
          cool_target: null,
          mode: "idle",
          heating_power: 0,
          device_setpoint: null,
          override_active: false,
          override_type: null,
          override_temp: null,
          override_until: null,
          override_suppressed: false,
          active_schedule_index: -1,
          window_open: false,
          confidence: null,
          mpc_active: false,
          presence_away: false,
          mold_risk_level: "warning",
          mold_surface_rh: 76,
          mold_prevention_active: false,
          mold_prevention_delta: 0,
          blind_position: null,
          cover_auto_paused: false,
          cover_forced_reason: "",
          active_cover_schedule_index: -1,
          active_heat_sources: null,
          learning_paused_reason: null,
        },
      }),
    );

    const stats = summarizeFleetOverview([living, bedroom, hallway], hass, true);
    expect(stats.configuredRooms).toBe(2);
    expect(stats.monitoredRooms).toBe(1);
    expect(stats.attentionRooms).toBe(2);
    expect(matchesFleetFilter(hallway, "monitored", hass, true)).toBe(true);
    expect(matchesFleetFilter(hallway, "attention", hass, true)).toBe(true);
    expect(matchesFleetFilter(living, "monitored", hass, true)).toBe(false);
  });
});
