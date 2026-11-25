import { describe, expect, it } from "bun:test";
import type { HomeAssistant } from "../types";
import {
  buildSleepSafetyBadges,
  discoverSleepDeviceInArea,
  parseQushuiCurveWindow,
} from "./sleep-device";

describe("sleep-device", () => {
  it("parses qushui sleep curve payload strings", () => {
    expect(parseQushuiCurveWindow("0-1-23000700-031-00-10090708")).toEqual({
      enabled: true,
      start: "23:00",
      end: "07:00",
    });
    expect(parseQushuiCurveWindow("invalid")).toBeNull();
  });

  it("discovers all qushui.blanket.8hz1 entities in an area", () => {
    const devId = "dev_blanket";
    const hass = {
      language: "en",
      areas: {
        wo_shi: { area_id: "wo_shi", name: "Master Bedroom", picture: null, floor_id: null },
      },
      devices: {
        [devId]: { id: devId, area_id: "wo_shi", name: "8H Blanket Z1", name_by_user: null },
      },
      entities: {
        "switch.qushui_cn_1_8hz1_on_p_2_1": {
          entity_id: "switch.qushui_cn_1_8hz1_on_p_2_1",
          area_id: null,
          device_id: devId,
          platform: "xiaomi_home",
        },
        "select.qushui_cn_1_8hz1_heat_level_p_2_7": {
          entity_id: "select.qushui_cn_1_8hz1_heat_level_p_2_7",
          area_id: null,
          device_id: devId,
          platform: "xiaomi_home",
        },
        "text.qushui_cn_1_8hz1_a_b_gears_p_6_2": {
          entity_id: "text.qushui_cn_1_8hz1_a_b_gears_p_6_2",
          area_id: null,
          device_id: devId,
          platform: "xiaomi_home",
        },
        "switch.qushui_cn_1_8hz1_ab_sleep_switch_p_7_4": {
          entity_id: "switch.qushui_cn_1_8hz1_ab_sleep_switch_p_7_4",
          area_id: null,
          device_id: devId,
          platform: "xiaomi_home",
        },
        "text.qushui_cn_1_8hz1_a_sleep_p_7_1": {
          entity_id: "text.qushui_cn_1_8hz1_a_sleep_p_7_1",
          area_id: null,
          device_id: devId,
          platform: "xiaomi_home",
        },
        "text.qushui_cn_1_8hz1_b_sleep_p_7_2": {
          entity_id: "text.qushui_cn_1_8hz1_b_sleep_p_7_2",
          area_id: null,
          device_id: devId,
          platform: "xiaomi_home",
        },
        "binary_sensor.qushui_cn_1_8hz1_flag_remote_switch_p_9_1": {
          entity_id: "binary_sensor.qushui_cn_1_8hz1_flag_remote_switch_p_9_1",
          area_id: null,
          device_id: devId,
          platform: "xiaomi_home",
        },
        "binary_sensor.qushui_cn_1_8hz1_mite_removal_p_6_9": {
          entity_id: "binary_sensor.qushui_cn_1_8hz1_mite_removal_p_6_9",
          area_id: null,
          device_id: devId,
          platform: "xiaomi_home",
        },
      },
      states: {},
      config: { unit_system: { temperature: "°C" } },
      callWS: async () => ({}),
      callService: async () => ({}),
    } as unknown as HomeAssistant;

    const detected = discoverSleepDeviceInArea("wo_shi", hass);
    expect(detected).not.toBeNull();
    expect(detected?.name).toBe("8H Blanket Z1");
    expect(detected?.power_entity).toBe("switch.qushui_cn_1_8hz1_on_p_2_1");
    expect(detected?.gears_entity).toBe("text.qushui_cn_1_8hz1_a_b_gears_p_6_2");
    expect(detected?.sleep_switch_entity).toBe("switch.qushui_cn_1_8hz1_ab_sleep_switch_p_7_4");
    expect(detected?.remote_switch_entity).toBe(
      "binary_sensor.qushui_cn_1_8hz1_flag_remote_switch_p_9_1",
    );
  });

  it("builds warning and status badges cleanly", () => {
    const badges = buildSleepSafetyBadges({
      configured: true,
      power_on: true,
      sleep_switch_on: false,
      remote_enabled: false,
      mite_removal_active: true,
      anti_scald_on: true,
      fault_ok: false,
      heating_active: false,
    });
    expect(badges.map((b) => b.key)).toEqual([
      "sleep.safety.fault",
      "sleep.safety.remote_disabled",
      "sleep.safety.mite_removal",
      "sleep.safety.anti_scald",
    ]);
  });
});
