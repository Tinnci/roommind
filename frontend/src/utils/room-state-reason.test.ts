import { describe, expect, it } from "bun:test";
import type { RoomConfig } from "../types";
import { resolveRoomReason } from "./room-state-reason";

function makeRoom(overrides: Partial<RoomConfig> = {}): RoomConfig {
  return {
    area_id: "living_room",
    thermostats: [],
    acs: ["climate.ac"],
    temperature_sensor: "sensor.temp",
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

describe("resolveRoomReason", () => {
  it("returns null for unconfigured or outdoor areas", () => {
    expect(resolveRoomReason(null, true)).toBeNull();
    expect(resolveRoomReason(makeRoom({ is_outdoor: true }), true)).toBeNull();
  });

  it("prioritizes global pause above room pause and window open", () => {
    const room = makeRoom({
      climate_control_enabled: false,
      live: {
        current_temp: 22,
        current_humidity: 50,
        target_temp: 23,
        heat_target: 21,
        cool_target: 24,
        mode: "idle",
        heating_power: 0,
        device_setpoint: null,
        override_active: true,
        override_type: "boost",
        override_temp: 25,
        override_until: null,
        override_suppressed: false,
        active_schedule_index: -1,
        window_open: true,
        confidence: null,
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
    });
    expect(resolveRoomReason(room, false)).toEqual({
      key: "reason.global_paused",
      tone: "warning",
    });
    expect(resolveRoomReason(room, true)).toEqual({
      key: "reason.room_paused",
      tone: "warning",
    });
  });

  it("surfaces window open, mold guard, presence away, override, night mode, and schedule", () => {
    const baseLive = {
      current_temp: 22,
      current_humidity: 50,
      target_temp: 23,
      heat_target: 21,
      cool_target: 24,
      mode: "heating" as const,
      heating_power: 50,
      device_setpoint: 23,
      override_active: false,
      override_type: null,
      override_temp: null,
      override_until: null,
      override_suppressed: false,
      active_schedule_index: 0,
      window_open: false,
      confidence: 0.9,
      mpc_active: true,
      presence_away: false,
      mold_risk_level: "ok" as const,
      mold_surface_rh: null,
      mold_prevention_active: false,
      mold_prevention_delta: 0,
      blind_position: null,
      cover_auto_paused: false,
      cover_forced_reason: "",
      active_cover_schedule_index: -1,
      active_heat_sources: null,
      learning_paused_reason: null,
    };

    expect(
      resolveRoomReason(makeRoom({ live: { ...baseLive, window_open: true } }), true)?.key,
    ).toBe("reason.window_open");
    expect(
      resolveRoomReason(makeRoom({ live: { ...baseLive, mold_prevention_active: true } }), true)
        ?.key,
    ).toBe("reason.mold_prevention");
    expect(
      resolveRoomReason(makeRoom({ live: { ...baseLive, presence_away: true } }), true)?.key,
    ).toBe("reason.presence_away");
    expect(
      resolveRoomReason(
        makeRoom({ live: { ...baseLive, override_active: true, override_type: "eco" } }),
        true,
      )?.key,
    ).toBe("reason.override_eco");
    expect(
      resolveRoomReason(makeRoom({ live: { ...baseLive, night_mode: { active: true } } }), true)
        ?.key,
    ).toBe("reason.night_mode");
    expect(
      resolveRoomReason(
        makeRoom({ schedules: [{ entity_id: "schedule.living" }], live: baseLive }),
        true,
      )?.key,
    ).toBe("reason.following_schedule");
    expect(resolveRoomReason(makeRoom({ schedules: [], live: baseLive }), true)?.key).toBe(
      "reason.holding_target",
    );
  });

  it("shows schedule/target reason for confirmed mode-only units and flags offline devices", () => {
    const unknownBase = {
      current_temp: 20,
      current_humidity: 45,
      target_temp: 21,
      heat_target: 21,
      cool_target: 24,
      mode: "idle" as const,
      observation_status: "unknown" as const,
      observed_mode: null,
      heating_power: 0,
      device_setpoint: 28,
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
      mold_risk_level: "ok" as const,
      mold_surface_rh: null,
      mold_prevention_active: false,
      mold_prevention_delta: 0,
      blind_position: null,
      cover_auto_paused: false,
      cover_forced_reason: "",
      active_cover_schedule_index: -1,
      active_heat_sources: null,
      learning_paused_reason: null,
    };

    const modeOnlyRoom = makeRoom({
      schedules: [],
      live: {
        ...unknownBase,
        device_observations: [
          {
            entity_id: "climate.ac",
            available: true,
            assumed_state: false,
            hvac_mode: "heat",
            temperature: 28,
            target_temp_low: null,
            target_temp_high: null,
          },
        ],
      },
    });
    expect(resolveRoomReason(modeOnlyRoom, true)?.key).toBe("reason.holding_target");

    const offlineRoom = makeRoom({
      live: {
        ...unknownBase,
        device_observations: [
          {
            entity_id: "climate.ac",
            available: false,
            assumed_state: false,
            hvac_mode: null,
            temperature: null,
            target_temp_low: null,
            target_temp_high: null,
          },
        ],
      },
    });
    expect(resolveRoomReason(offlineRoom, true)?.key).toBe("reason.device_offline");
  });
});
