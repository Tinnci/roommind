import { describe, expect, test } from "bun:test";
import {
  airflowBehaviorPreferenceCount,
  airflowModelingPreferenceCount,
  airflowSettingTier,
} from "./airflow-settings-layout";
import type { AirflowDeviceConfig } from "../types";

describe("airflow settings layout", () => {
  test("keeps daily airflow controls separate from behavior and modeling fields", () => {
    expect(airflowSettingTier("role")).toBe("daily");
    expect(airflowSettingTier("controllable")).toBe("daily");
    expect(airflowSettingTier("control_enabled")).toBe("daily");
    expect(airflowSettingTier("preferred_preset_mode_night")).toBe("behavior");
    expect(airflowSettingTier("preferred_swing_horizontal_mode")).toBe("behavior");
    expect(airflowSettingTier("power_sensor_entity")).toBe("modeling");
    expect(airflowSettingTier("fan_capacity_curve")).toBe("modeling");
  });

  test("summarizes configured behavior preferences without counting empty defaults", () => {
    const device: AirflowDeviceConfig = {
      entity_id: "fan.bedroom",
      role: "circulation",
      controllable: true,
      control_enabled: true,
      preferred_direction: "",
      preferred_oscillating: null,
      preferred_preset_mode: "sleep",
      preferred_preset_mode_night: "quiet",
      preferred_swing_mode: "",
      preferred_swing_horizontal_mode: "",
    };

    expect(airflowBehaviorPreferenceCount(device)).toBe(2);
  });

  test("summarizes advanced modeling preferences and ignores the default observer", () => {
    const device: AirflowDeviceConfig = {
      entity_id: "climate.bedroom",
      role: "hvac_fan",
      controllable: true,
      control_enabled: false,
      compressor_stage_observer: "auto",
      assumed_state_ttl_s: 120,
      fan_capacity_curve: [{ level: 0.5, capacity_factor: 1.1 }],
      fan_power_curve: [],
    };

    expect(airflowModelingPreferenceCount(device)).toBe(1);
  });
});
