import { describe, expect, test } from "bun:test";
import { comfortSettingTier, globalControlSettingTier } from "./comfort-settings-layout";

describe("comfort settings layout", () => {
  test("keeps target and quiet-hours controls in the daily tier", () => {
    expect(comfortSettingTier("control_target")).toBe("daily");
    expect(comfortSettingTier("night_mode_enabled")).toBe("daily");
    expect(comfortSettingTier("quiet_hours")).toBe("daily");
  });

  test("puts model and constraint tuning behind the advanced tier", () => {
    expect(comfortSettingTier("room_volume_m3")).toBe("advanced");
    expect(comfortSettingTier("max_fan_level_night")).toBe("advanced");
    expect(comfortSettingTier("rapid_recovery_delta_c")).toBe("advanced");
    expect(comfortSettingTier("sleep_temp_ramp_c")).toBe("advanced");
    expect(comfortSettingTier("adjacent_rooms")).toBe("advanced");
  });

  test("treats optimizer strategy as advanced global control tuning", () => {
    expect(globalControlSettingTier("control_mode")).toBe("daily");
    expect(globalControlSettingTier("optimizer_strategy")).toBe("advanced");
  });
});
