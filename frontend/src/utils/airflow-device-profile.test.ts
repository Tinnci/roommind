import { describe, expect, test } from "bun:test";
import { airflowDeviceFromUiSchema, toAirflowDeviceUiSchema } from "./airflow-device-profile";
import type { AirflowDeviceConfig } from "../types";

describe("airflow device UI schema", () => {
  test("separates behavior preferences and modeling profile from daily controls", () => {
    const device: AirflowDeviceConfig = {
      entity_id: "fan.bedroom",
      role: "circulation",
      controllable: true,
      control_enabled: true,
      preferred_preset_mode_night: "sleep",
      preferred_oscillating: true,
      power_sensor_entity: "sensor.fan_power",
      fan_power_curve: [{ level: 1, power_w: 38 }],
    };

    const schema = toAirflowDeviceUiSchema(device);

    expect(schema).toMatchObject({
      entity_id: "fan.bedroom",
      role: "circulation",
      controllable: true,
      control_enabled: true,
      behavior_preferences: {
        preferred_preset_mode_night: "sleep",
        preferred_oscillating: true,
      },
      modeling_profile: {
        power_sensor_entity: "sensor.fan_power",
        fan_power_curve: [{ level: 1, power_w: 38 }],
      },
    });
    expect("preferred_preset_mode_night" in schema).toBe(false);
    expect("fan_power_curve" in schema).toBe(false);
  });

  test("round-trips the nested UI schema back to the flat websocket contract", () => {
    const device: AirflowDeviceConfig = {
      entity_id: "climate.bedroom",
      role: "hvac_fan",
      controllable: true,
      control_enabled: false,
      preferred_preset_mode_thermal: "comfort",
      preferred_swing_mode: "auto",
      compressor_stage_observer: "power_sensor",
      airflow_m3h: 260,
    };

    expect(airflowDeviceFromUiSchema(toAirflowDeviceUiSchema(device))).toEqual(device);
  });
});
