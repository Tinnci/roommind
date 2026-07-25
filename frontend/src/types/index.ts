/**
 * Core type definitions for RoomMind frontend.
 */

export type ClimateMode = "auto" | "heat_only" | "cool_only";

export type RoomMode = "idle" | "heating" | "cooling" | "fan_only";

export type OverrideType = "boost" | "eco" | "custom";

export interface NotificationTarget {
  entity_id: string;
  person_entity: string;
  notify_when: "always" | "home_only";
}

export interface ScheduleEntry {
  entity_id: string;
}

export interface CoverScheduleEntry {
  entity_id: string;
  mode?: "force" | "gate";
}

export interface SensorFusionStatus {
  entity_id: string;
  is_primary: boolean;
  value: number;
  corrected_value: number;
  static_bias: number;
  active_bias: number;
  k_mix: number;
  age_s: number;
  variance: number;
  freshness_source: "last_reported" | "last_updated" | "last_changed" | "none" | string;
  freshness_status: "fresh" | "aging" | "stale" | string;
  last_reported?: string | null;
  last_updated?: string | null;
  last_changed?: string | null;
}

export interface RoomLiveData {
  current_temp: number | null;
  current_humidity: number | null;
  target_temp: number | null;
  heat_target: number | null;
  cool_target: number | null;
  mode: RoomMode;
  heating_power: number; // 0-100
  device_setpoint: number | null; // Device target temp in Full Control mode
  override_active: boolean;
  override_type: OverrideType | null;
  override_temp: number | null;
  override_until: number | null;
  override_suppressed: boolean;
  active_schedule_index: number;
  window_open: boolean;
  confidence: number | null;
  mpc_active: boolean;
  presence_away: boolean;
  mold_risk_level: "ok" | "warning" | "critical";
  mold_surface_rh: number | null;
  mold_prevention_active: boolean;
  mold_prevention_delta: number;
  blind_position: number | null;
  cover_auto_paused: boolean;
  cover_forced_reason: string;
  active_cover_schedule_index: number;
  active_heat_sources: string | null;
  learning_paused_reason: "outdoor_unavailable" | null;
  q_fan_mix?: number;
  q_vent?: number;
  airflow_ach?: number;
  perceived_temp?: number | null;
  airflow_active?: boolean;
  airflow_plan_level?: number;
  airflow_mix_plan_level?: number;
  airflow_vent_plan_level?: number;
  airflow_devices_status?: AirflowDeviceStatus[];
  airflow_command_status?: AirflowCommandStatus[];
  sensor_conflict?: number;
  sensor_fusion_status?: SensorFusionStatus[];
  hvac_output_status?: HVACOutputStatus | null;
  night_mode?: NightModeLiveStatus;
  night_control_status?: NightControlStatus[];
  rapid_recovery_active?: boolean;
  effective_control_target?: "air_temperature" | "perceived_temperature" | string;
  coupling_status?: CouplingStatus[];
}

export type DeviceType = "trv" | "ac";
export type DeviceRole = "primary" | "secondary" | "auto";

export interface DeviceConfig {
  entity_id: string;
  type: DeviceType;
  role: DeviceRole;
  heating_system_type?: string;
  idle_action?: "off" | "fan_only" | "setback" | "low"; // default "off"
  idle_fan_mode?: string; // default "low"
  setpoint_mode?: "proportional" | "direct"; // default "proportional"
}

export type AirflowRole = "circulation" | "ventilation" | "hvac_fan";

export interface CapacityCurvePoint {
  level: number;
  capacity_factor: number;
  power_w?: never;
}

export interface PowerCurvePoint {
  level: number;
  power_w: number;
  capacity_factor?: never;
}

export type CurvePoint = CapacityCurvePoint | PowerCurvePoint;

export interface AirflowDeviceConfig {
  entity_id: string;
  role: AirflowRole;
  controllable: boolean;
  control_enabled: boolean;
  preferred_direction?: string;
  preferred_oscillating?: boolean | null;
  preferred_preset_mode?: string;
  preferred_preset_mode_thermal?: string;
  preferred_preset_mode_idle?: string;
  preferred_preset_mode_night?: string;
  preferred_preset_mode_away?: string;
  preferred_swing_mode?: string;
  preferred_swing_horizontal_mode?: string;
  effect_weight?: number;
  airflow_m3h?: number | null;
  power_sensor_entity?: string;
  assumed_state_ttl?: number | null;
  assumed_state_ttl_s?: number;
  compressor_stage_observer?: "auto" | "power_sensor" | "thermal_slope" | "disabled";
  fan_capacity_curve?: CapacityCurvePoint[];
  fan_power_curve?: PowerCurvePoint[];
}

export interface AirflowDeviceStatus {
  entity_id: string;
  role: AirflowRole;
  available: boolean;
  q: number;
  controllable: boolean;
  control_enabled: boolean;
  domain: string;
  percentage?: number | null;
  preset_mode?: string | null;
  preset_modes?: string[];
  direction?: string | null;
  oscillating?: boolean | null;
  fan_mode?: string | null;
  fan_modes?: string[];
  swing_mode?: string | null;
  swing_modes?: string[];
  swing_horizontal_mode?: string | null;
  swing_horizontal_modes?: string[];
  levels?: number[];
  effect_weight?: number;
  airflow_m3h?: number | null;
  age_s?: number | null;
  freshness_source?: "last_reported" | "last_updated" | "last_changed" | "none" | string;
  last_reported?: string | null;
  last_updated?: string | null;
  last_changed?: string | null;
}

export interface SkippedService {
  service: string;
  reason: string;
}

export interface AirflowCommandStatus {
  entity_id: string;
  domain: string;
  role: AirflowRole;
  planned_level: number;
  observed_q?: number | null;
  outcome:
    | "applied"
    | "skipped_off_climate"
    | "unsupported_fan_only"
    | "blocked_by_mode"
    | "failed"
    | string;
  skip_reason?: string;
  skipped_services?: SkippedService[];
  last_service?: string | null;
  roommind_fan_only?: boolean;
  assumed_state_confidence?: "observed" | "assumed" | "stale" | "conflicting" | string;
  commanded_level?: number | null;
  commanded_at?: number | null;
  night_mode_active?: boolean;
  night_capped?: boolean;
}

export interface HVACOutputStatus {
  entity_id: string;
  stage: string;
  delivered_capacity_factor: number;
  electric_power_w?: number | null;
  confidence: string;
}

export interface NightModeLiveStatus {
  active: boolean;
  quiet_hours?: { start: string; end: string } | null;
  sleep_temp_ramp_c?: number;
  max_fan_level?: number | null;
}

export interface NightControlStatus {
  entity_id: string;
  role: "indicator_light" | "display" | "beeper" | "sound" | "other" | string;
  active: boolean;
  outcome: string;
  skip_reason?: string;
  target_value?: string | number | boolean | null;
  previous_value?: string | number | boolean | null;
  restore_after_night?: boolean;
  last_service?: string | null;
}

export interface CouplingStatus {
  area_id: string;
  temperature: number;
  k: number;
  gate: number;
}

export type ConflictResolution =
  | "heating_priority"
  | "cooling_priority"
  | "majority"
  | "outdoor_temp";

export interface CompressorGroup {
  id: string;
  name: string;
  members: string[];
  min_run_minutes: number;
  min_off_minutes: number;
  master_entity: string;
  conflict_resolution: ConflictResolution;
  action_script: string;
  enforce_uniform_mode: boolean;
}

export interface RoomConfig {
  area_id: string;
  thermostats: string[];
  acs: string[];
  devices?: DeviceConfig[];
  airflow_devices?: AirflowDeviceConfig[];
  room_volume_m3?: number | null;
  control_target?: "air_temperature" | "perceived_temperature";
  quiet_hours?: { start: string; end: string } | null;
  night_mode_enabled?: boolean;
  night_controls?: NightControlConfig[];
  night_allow_rapid_recovery?: boolean;
  rapid_recovery_delta_c?: number;
  max_fan_level_night?: number;
  sleep_temp_ramp_c?: number;
  adjacent_rooms?: AdjacentRoomConfig[];
  temperature_sensor: string;
  temperature_sensors?: string[];
  humidity_sensor: string;
  humidity_sensors?: string[];
  occupancy_sensors?: string[];
  window_sensors: string[];
  window_open_delay: number;
  window_close_delay: number;
  climate_mode: ClimateMode;
  schedules: ScheduleEntry[];
  schedule_selector_entity: string;
  comfort_temp?: number;
  eco_temp?: number;
  comfort_heat: number;
  comfort_cool: number;
  eco_heat: number;
  eco_cool: number;
  override_temp?: number | null;
  override_until?: number | null;
  override_type?: OverrideType | null;
  presence_persons?: string[];
  display_name?: string;
  heating_system_type?: string;
  covers?: string[];
  covers_auto_enabled?: boolean;
  covers_deploy_threshold?: number;
  covers_min_position?: number;
  covers_override_minutes?: number;
  cover_schedules?: CoverScheduleEntry[];
  cover_schedule_selector_entity?: string;
  cover_orientations?: Record<string, number>;
  covers_outdoor_min_temp?: number | null;
  covers_night_close?: boolean;
  covers_night_position?: number;
  covers_night_close_elevation?: number;
  covers_night_close_offset_minutes?: number;
  covers_snap_deploy?: boolean;
  cover_min_positions?: Record<string, number>;
  ignore_presence?: boolean;
  is_outdoor?: boolean;
  valve_protection_exclude?: string[];
  heat_source_orchestration?: boolean;
  heat_source_primary_delta?: number;
  heat_source_outdoor_threshold?: number;
  heat_source_ac_min_outdoor?: number;
  climate_control_enabled?: boolean;
  live?: RoomLiveData;
}

export interface AdjacentRoomConfig {
  area_id: string;
  link_sensor_entity?: string;
  door_sensor_entity?: string;
  coupling_weight?: number;
  allow_borrowed_conditioning?: boolean;
  enabled?: boolean;
}

export interface NightControlConfig {
  entity_id: string;
  role?: "indicator_light" | "display" | "beeper" | "sound" | "other";
  enabled?: boolean;
  night_value?: string | number | boolean | null;
  day_value?: string | number | boolean | null;
  restore_after_night?: boolean;
}

export interface GlobalSettings {
  outdoor_temp_sensor: string;
  outdoor_humidity_sensor: string;
  outdoor_cooling_min?: number;
  outdoor_heating_max?: number;
  control_mode?: "mpc" | "bangbang";
  optimizer_strategy?: "greedy" | "horizon_search";
  comfort_weight?: number;
  weather_entity?: string;
  outdoor_unavailable_notify?: boolean;
  climate_control_active?: boolean;
  learning_disabled_rooms?: string[];
  hidden_rooms?: string[];
  prediction_enabled?: boolean;
  vacation_temp?: number;
  vacation_until?: number | null;
  presence_enabled?: boolean;
  presence_persons?: string[];
  presence_away_action?: "eco" | "off";
  presence_clears_override?: boolean;
  schedule_off_action?: "eco" | "off";
  valve_protection_enabled?: boolean;
  valve_protection_interval_days?: number;
  mold_detection_enabled?: boolean;
  mold_humidity_threshold?: number;
  mold_sustained_minutes?: number;
  mold_notification_cooldown?: number;
  mold_notifications_enabled?: boolean;
  mold_notification_targets?: NotificationTarget[];
  mold_prevention_enabled?: boolean;
  mold_prevention_intensity?: "light" | "medium" | "strong";
  mold_prevention_notify_enabled?: boolean;
  mold_prevention_notify_targets?: NotificationTarget[];
  compressor_groups?: CompressorGroup[];
  room_order?: string[];
  group_by_floor?: boolean;
  boost_applied_at?: Record<string, number>;
}

// HA types for panel integration
export interface HassConnection {
  addEventListener(event: string, callback: () => void): void;
  removeEventListener(event: string, callback: () => void): void;
}

export interface HomeAssistant {
  callWS: <T>(msg: Record<string, unknown>) => Promise<T>;
  callService: (domain: string, service: string, data?: Record<string, unknown>) => Promise<void>;
  states: Record<string, HassEntity>;
  areas: Record<string, HassArea>;
  floors?: Record<string, HassFloor>;
  entities: Record<string, HassEntityRegistryEntry>;
  devices: Record<string, HassDeviceRegistryEntry>;
  language: string;
  config: { unit_system: { temperature: string } };
  connection?: HassConnection;
}

export interface HassArea {
  area_id: string;
  name: string;
  picture: string | null;
  floor_id: string | null;
}

export interface HassFloor {
  floor_id: string;
  name: string;
  level: number | null;
}

export interface HassEntityRegistryEntry {
  entity_id: string;
  area_id: string | null;
  device_id: string | null;
  platform: string;
}

export interface HassDeviceRegistryEntry {
  id: string;
  area_id: string | null;
}

export interface HassEntity {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
}

export interface AnalyticsDataPoint {
  ts: number;
  room_temp: number | null;
  outdoor_temp: number | null;
  target_temp: number | null;
  mode: string;
  predicted_temp: number | null;
  window_open: boolean;
  heating_power: number | null;
  solar_irradiance: number | null;
  blind_position?: number | null;
  cover_reason?: string;
  device_setpoint?: number | null;
  occupancy?: boolean;
  room_humidity?: number | null;
  outdoor_humidity?: number | null;
  perceived_temp?: number | null;
  q_fan_mix?: number | null;
  q_vent?: number | null;
  airflow_ach?: number | null;
  airflow_plan_level?: number | null;
  airflow_mix_plan_level?: number | null;
  airflow_vent_plan_level?: number | null;
  night_mode_active?: boolean;
  rapid_recovery_active?: boolean;
  hvac_stage?: string;
  sensor_conflict?: number | null;
  mold_surface_rh?: number | null;
  mold_risk_level?: string;
  effective_control_target?: "air_temperature" | "perceived_temperature" | string;
  heat_target?: number | null;
  cool_target?: number | null;
  override_active?: boolean;
  override_type?: OverrideType | "";
  active_heat_sources?: string;
  temperature_source?: string;
  temperature_source_count?: number | null;
  temperature_primary_available?: boolean;
  humidity_sources?: string;
  humidity_source_count?: number | null;
  humidity_primary_available?: boolean;
}

export interface AnalyticsData {
  detail: AnalyticsDataPoint[];
  history: AnalyticsDataPoint[];
  forecast?: AnalyticsDataPoint[];
  model: {
    confidence: number;
    model: {
      C: number;
      U: number;
      Q_heat: number;
      Q_cool: number;
      Q_solar: number;
      Q_occupancy: number;
    };
    n_samples: number;
    n_observations: number;
    n_heating: number;
    n_cooling: number;
    applicable_modes: string[];
    mpc_active: boolean;
    sigma_e: number;
    prediction_std_idle: number;
    prediction_std_heating: number;
    has_occupancy_sensors: boolean;
  };
}

export type TimeRange = "12h" | "24h" | "2d" | "7d" | "14d" | "30d" | "90d";
