import { describe, expect, test } from "bun:test";
import type { HomeAssistant } from "../types";
import { classifyNonAmbientTempSensor, isDiagnosticOrConfigEntity } from "./ambient-sensor-filter";

function makeHass(): HomeAssistant {
  return {
    language: "zh-Hans",
    config: { unit_system: { temperature: "°C" } },
    areas: {},
    devices: {
      dev_waterheater: {
        id: "dev_waterheater",
        area_id: "can_ting",
        name: "米家智能恒温燃气热水器16L S10",
        model: "xiaomi.waterheater.ymm5",
      },
      dev_purifier: {
        id: "dev_purifier",
        area_id: "can_ting",
        name: "小米台式净饮机",
        model: "chunmi.ysj.tsa1",
      },
      dev_ac2: {
        id: "dev_ac2",
        area_id: "wo_shi_2",
        name: "TCL AC",
        model: "KFRd-35G/D-STA22Bp(B1)",
      },
      dev_ble: {
        id: "dev_ble",
        area_id: "ke_ting",
        name: "Temperature/Humidity sensor",
        model: "LYWSD03MMC",
      },
    },
    entities: {
      "water_heater.xiaomi_cn_2060084384_ymm5_s_2_water_heater": {
        entity_id: "water_heater.xiaomi_cn_2060084384_ymm5_s_2_water_heater",
        area_id: null,
        device_id: "dev_waterheater",
        platform: "xiaomi_home",
      },
      "sensor.xiaomi_cn_2060084384_ymm5_temperature_p_4_4": {
        entity_id: "sensor.xiaomi_cn_2060084384_ymm5_temperature_p_4_4",
        area_id: null,
        device_id: "dev_waterheater",
        platform: "xiaomi_home",
      },
      "sensor.chunmi_cn_395394739_tsa1_temperature_p_2_5": {
        entity_id: "sensor.chunmi_cn_395394739_tsa1_temperature_p_2_5",
        area_id: null,
        device_id: "dev_purifier",
        platform: "xiaomi_home",
      },
      "sensor.wo_shi_2_kong_diao_2_2": {
        entity_id: "sensor.wo_shi_2_kong_diao_2_2",
        area_id: null,
        device_id: "dev_ac2",
        platform: "tcl_udp_ac",
        entity_category: "diagnostic",
      },
      "sensor.wo_shi_2_kong_diao_2_22": {
        entity_id: "sensor.wo_shi_2_kong_diao_2_22",
        area_id: null,
        device_id: "dev_ac2",
        platform: "tcl_udp_ac",
      },
      "sensor.wo_shi_atc_6e73_temperature": {
        entity_id: "sensor.wo_shi_atc_6e73_temperature",
        area_id: "ke_ting",
        device_id: "dev_ble",
        platform: "bthome",
      },
      "sensor.wo_shi_zm1_ad46_temperature": {
        entity_id: "sensor.wo_shi_zm1_ad46_temperature",
        area_id: "wo_shi",
        device_id: null,
        platform: "zm1",
      },
    },
    states: {
      "sensor.xiaomi_cn_2060084384_ymm5_temperature_p_4_4": {
        entity_id: "sensor.xiaomi_cn_2060084384_ymm5_temperature_p_4_4",
        state: "45",
        attributes: { device_class: "temperature", friendly_name: "使用记录 温度" },
      },
      "sensor.chunmi_cn_395394739_tsa1_temperature_p_2_5": {
        entity_id: "sensor.chunmi_cn_395394739_tsa1_temperature_p_2_5",
        state: "27",
        attributes: { device_class: "temperature", friendly_name: "出水温度" },
      },
      "sensor.wo_shi_2_kong_diao_2_2": {
        entity_id: "sensor.wo_shi_2_kong_diao_2_2",
        state: "21",
        attributes: { device_class: "temperature", friendly_name: "室内机盘管温度" },
      },
      "sensor.wo_shi_2_kong_diao_2_22": {
        entity_id: "sensor.wo_shi_2_kong_diao_2_22",
        state: "18",
        attributes: { device_class: "temperature", friendly_name: "室外温度" },
      },
      "sensor.wo_shi_atc_6e73_temperature": {
        entity_id: "sensor.wo_shi_atc_6e73_temperature",
        state: "21.8",
        attributes: { device_class: "temperature", friendly_name: "客厅 温度" },
      },
      "sensor.wo_shi_zm1_ad46_temperature": {
        entity_id: "sensor.wo_shi_zm1_ad46_temperature",
        state: "22.1",
        attributes: { device_class: "temperature", friendly_name: "卧室 温度" },
      },
    },
  } as unknown as HomeAssistant;
}

describe("ambient-sensor-filter", () => {
  test("filters water heater, water purifier, AC coil diagnostic, and AC outdoor sensors", () => {
    const hass = makeHass();

    expect(
      classifyNonAmbientTempSensor("sensor.xiaomi_cn_2060084384_ymm5_temperature_p_4_4", hass),
    ).toBe("appliance");
    expect(
      classifyNonAmbientTempSensor("sensor.chunmi_cn_395394739_tsa1_temperature_p_2_5", hass),
    ).toBe("appliance");
    expect(classifyNonAmbientTempSensor("sensor.wo_shi_2_kong_diao_2_2", hass)).toBe("diagnostic");
    expect(isDiagnosticOrConfigEntity("sensor.wo_shi_2_kong_diao_2_2", hass)).toBe(true);
    expect(classifyNonAmbientTempSensor("sensor.wo_shi_2_kong_diao_2_22", hass)).toBe("outdoor");
  });

  test("preserves real room ambient thermometers and never excludes climate entities", () => {
    const hass = makeHass();

    expect(classifyNonAmbientTempSensor("sensor.wo_shi_atc_6e73_temperature", hass)).toBeNull();
    expect(classifyNonAmbientTempSensor("sensor.wo_shi_zm1_ad46_temperature", hass)).toBeNull();
    expect(classifyNonAmbientTempSensor("climate.wo_shi_ac", hass)).toBeNull();
  });
});
