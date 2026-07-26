import type { AirflowDeviceConfig } from "../types";
import type { AirflowBehaviorPreferences, AirflowModelingProfile } from "./airflow-device-profile";

export type AirflowSettingTier = "daily" | "behavior" | "modeling";

const DAILY_FIELDS = new Set(["role", "controllable", "control_enabled"]);
const BEHAVIOR_FIELDS = new Set([
  "preferred_direction",
  "preferred_oscillating",
  "preferred_preset_mode",
  "preferred_preset_mode_thermal",
  "preferred_preset_mode_idle",
  "preferred_preset_mode_night",
  "preferred_preset_mode_away",
  "preferred_swing_mode",
  "preferred_swing_horizontal_mode",
]);
const MODELING_FIELDS = new Set([
  "effect_weight",
  "airflow_m3h",
  "power_sensor_entity",
  "assumed_state_ttl_s",
  "compressor_stage_observer",
  "fan_capacity_curve",
  "fan_power_curve",
]);

export function airflowSettingTier(field: keyof AirflowDeviceConfig | string): AirflowSettingTier {
  if (DAILY_FIELDS.has(field)) return "daily";
  if (BEHAVIOR_FIELDS.has(field)) return "behavior";
  if (MODELING_FIELDS.has(field)) return "modeling";
  return "modeling";
}

export function airflowBehaviorPreferenceCount(
  device: AirflowDeviceConfig | AirflowBehaviorPreferences,
): number {
  return [
    device.preferred_direction,
    device.preferred_oscillating,
    device.preferred_preset_mode,
    device.preferred_preset_mode_thermal,
    device.preferred_preset_mode_idle,
    device.preferred_preset_mode_night,
    device.preferred_preset_mode_away,
    device.preferred_swing_mode,
    device.preferred_swing_horizontal_mode,
  ].filter((value) => value !== undefined && value !== null && value !== "").length;
}

export function airflowModelingPreferenceCount(
  device: AirflowDeviceConfig | AirflowModelingProfile,
): number {
  return [
    device.effect_weight !== undefined && device.effect_weight !== 1,
    device.airflow_m3h !== undefined && device.airflow_m3h !== null,
    !!device.power_sensor_entity,
    device.assumed_state_ttl_s !== undefined && device.assumed_state_ttl_s !== 120,
    !!device.compressor_stage_observer && device.compressor_stage_observer !== "auto",
    !!device.fan_capacity_curve?.length,
    !!device.fan_power_curve?.length,
  ].filter(Boolean).length;
}
