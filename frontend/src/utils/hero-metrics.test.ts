import { describe, expect, test } from "bun:test";

import { selectHeroMetricIds } from "./hero-metrics";
import type { RoomLiveData } from "../types";

const baseLive: RoomLiveData = {
  current_temp: 21,
  current_humidity: null,
  target_temp: 21,
  heat_target: 21,
  cool_target: 24,
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
};

describe("selectHeroMetricIds", () => {
  test("limits noisy indoor metrics to the three highest priority items", () => {
    const ids = selectHeroMetricIds({
      isOutdoor: false,
      climateControlActive: true,
      live: {
        ...baseLive,
        current_humidity: 58,
        perceived_temp: 22,
        night_mode: { active: true },
        rapid_recovery_active: true,
        device_setpoint: 23,
        active_heat_sources: "both",
        mold_surface_rh: 82,
        mold_risk_level: "warning",
      },
    });

    expect(ids).toEqual(["moldRisk", "rapidRecovery", "nightMode"]);
  });

  test("keeps outdoor hero metrics minimal", () => {
    const ids = selectHeroMetricIds({
      isOutdoor: true,
      climateControlActive: true,
      live: {
        ...baseLive,
        current_humidity: 58,
        perceived_temp: 22,
        night_mode: { active: true },
        device_setpoint: 23,
      },
    });

    expect(ids).toEqual(["humidity"]);
  });
});
