import type { GlobalSettings, RoomConfig } from "../types";

export type ComfortSettingTier = "daily" | "advanced";

const DAILY_COMFORT_FIELDS = new Set<keyof RoomConfig>([
  "control_target",
  "night_mode_enabled",
  "quiet_hours",
]);

export function comfortSettingTier(field: keyof RoomConfig | string): ComfortSettingTier {
  return DAILY_COMFORT_FIELDS.has(field as keyof RoomConfig) ? "daily" : "advanced";
}

const DAILY_GLOBAL_CONTROL_FIELDS = new Set<keyof GlobalSettings>([
  "control_mode",
  "comfort_weight",
  "outdoor_cooling_min",
  "outdoor_heating_max",
  "prediction_enabled",
  "schedule_off_action",
]);

export function globalControlSettingTier(field: keyof GlobalSettings | string): ComfortSettingTier {
  return DAILY_GLOBAL_CONTROL_FIELDS.has(field as keyof GlobalSettings) ? "daily" : "advanced";
}
