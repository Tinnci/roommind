import type {
  AirflowDeviceConfig,
  AirflowRole,
  CapacityCurvePoint,
  PowerCurvePoint,
} from "../types";

export interface AirflowBehaviorPreferences {
  preferred_direction?: string;
  preferred_oscillating?: boolean | null;
  preferred_preset_mode?: string;
  preferred_preset_mode_thermal?: string;
  preferred_preset_mode_idle?: string;
  preferred_preset_mode_night?: string;
  preferred_preset_mode_away?: string;
  preferred_swing_mode?: string;
  preferred_swing_horizontal_mode?: string;
}

export interface AirflowModelingProfile {
  effect_weight?: number;
  airflow_m3h?: number | null;
  power_sensor_entity?: string;
  assumed_state_ttl_s?: number;
  compressor_stage_observer?: "auto" | "power_sensor" | "thermal_slope" | "disabled";
  fan_capacity_curve?: CapacityCurvePoint[];
  fan_power_curve?: PowerCurvePoint[];
}

export interface AirflowDeviceUiSchema {
  entity_id: string;
  role: AirflowRole;
  controllable: boolean;
  control_enabled: boolean;
  behavior_preferences: AirflowBehaviorPreferences;
  modeling_profile: AirflowModelingProfile;
}

export function toAirflowDeviceUiSchema(device: AirflowDeviceConfig): AirflowDeviceUiSchema {
  return {
    entity_id: device.entity_id,
    role: device.role,
    controllable: device.controllable,
    control_enabled: device.control_enabled,
    behavior_preferences: omitUndefined({
      preferred_direction: device.preferred_direction,
      preferred_oscillating: device.preferred_oscillating,
      preferred_preset_mode: device.preferred_preset_mode,
      preferred_preset_mode_thermal: device.preferred_preset_mode_thermal,
      preferred_preset_mode_idle: device.preferred_preset_mode_idle,
      preferred_preset_mode_night: device.preferred_preset_mode_night,
      preferred_preset_mode_away: device.preferred_preset_mode_away,
      preferred_swing_mode: device.preferred_swing_mode,
      preferred_swing_horizontal_mode: device.preferred_swing_horizontal_mode,
    }),
    modeling_profile: omitUndefined({
      effect_weight: device.effect_weight,
      airflow_m3h: device.airflow_m3h,
      power_sensor_entity: device.power_sensor_entity,
      assumed_state_ttl_s: device.assumed_state_ttl_s,
      compressor_stage_observer: device.compressor_stage_observer,
      fan_capacity_curve: device.fan_capacity_curve,
      fan_power_curve: device.fan_power_curve,
    }),
  };
}

export function airflowDeviceFromUiSchema(schema: AirflowDeviceUiSchema): AirflowDeviceConfig {
  return {
    entity_id: schema.entity_id,
    role: schema.role,
    controllable: schema.controllable,
    control_enabled: schema.control_enabled,
    ...schema.behavior_preferences,
    ...schema.modeling_profile,
  };
}

function omitUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, fieldValue]) => fieldValue !== undefined),
  ) as Partial<T>;
}
