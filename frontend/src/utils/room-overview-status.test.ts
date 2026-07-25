import { describe, expect, test } from "bun:test";

import type { RoomConfig } from "../types";
import { summarizeRoomOverview } from "./room-overview-status";

function room(overrides: Partial<RoomConfig>): RoomConfig {
  return {
    area_id: "room",
    thermostats: [],
    acs: [],
    devices: [{ entity_id: "climate.room", type: "ac", role: "primary" }],
    temperature_sensor: "sensor.room_temperature",
    temperature_sensors: ["sensor.room_temperature"],
    humidity_sensor: "",
    window_sensors: [],
    window_open_delay: 0,
    window_close_delay: 0,
    climate_mode: "auto",
    schedules: [],
    schedule_selector_entity: "",
    comfort_heat: 21,
    comfort_cool: 25,
    eco_heat: 17,
    eco_cool: 28,
    climate_control_enabled: true,
    live: {
      current_temp: 24,
      current_humidity: 50,
      target_temp: 21,
      heat_target: 21,
      cool_target: 25,
      mode: "cooling",
      heating_power: 50,
      device_setpoint: 21,
      override_active: false,
      override_type: null,
      override_temp: null,
      override_until: null,
      override_suppressed: false,
      active_schedule_index: -1,
      window_open: false,
      confidence: 0.8,
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
    },
    ...overrides,
  };
}

describe("summarizeRoomOverview", () => {
  test("separates effective room overrides from stored but paused overrides", () => {
    const effective = room({
      area_id: "effective",
      live: { ...room({}).live!, override_active: true },
    });
    const paused = room({
      area_id: "paused",
      climate_control_enabled: false,
      live: { ...room({}).live!, override_active: true },
    });

    expect(summarizeRoomOverview([effective, paused], true)).toEqual({
      activeCount: 1,
      heatingCount: 0,
      coolingCount: 1,
      externalActiveCount: 1,
      effectiveOverrideCount: 1,
      pausedOverrideCount: 1,
    });
  });

  test("does not call rooms active when global control is paused", () => {
    expect(summarizeRoomOverview([room({})], false)).toEqual({
      activeCount: 0,
      heatingCount: 0,
      coolingCount: 0,
      externalActiveCount: 1,
      effectiveOverrideCount: 0,
      pausedOverrideCount: 0,
    });
  });
});
