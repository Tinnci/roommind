/**
 * Pure helper resolving plain-language control reason badges for rooms.
 */
import type { RoomConfig } from "../types";
import type { TranslationKey } from "./localize";
import { hasClimateDevice } from "./room-overview-status";
import { resolveRoomModePresentation } from "./room-state";

export type RoomReasonTone = "warning" | "accent" | "info" | "neutral";

export interface RoomReasonBadge {
  key: TranslationKey;
  tone: RoomReasonTone;
}

/**
 * Determine the highest-priority plain-language reason explaining a room's current state.
 */
export function resolveRoomReason(
  config: RoomConfig | null | undefined,
  climateControlActive = true,
): RoomReasonBadge | null {
  if (!config || config.is_outdoor) return null;
  const live = config.live;

  if (!climateControlActive) {
    return { key: "reason.global_paused", tone: "warning" };
  }
  if (config.climate_control_enabled === false) {
    return { key: "reason.room_paused", tone: "warning" };
  }
  if (live?.window_open) {
    return { key: "reason.window_open", tone: "warning" };
  }
  if (live?.mold_prevention_active) {
    return { key: "reason.mold_prevention", tone: "warning" };
  }
  if (live?.mold_risk_level === "critical" || live?.mold_risk_level === "warning") {
    return { key: "reason.mold_risk", tone: "warning" };
  }
  if (live?.presence_away) {
    return { key: "reason.presence_away", tone: "neutral" };
  }
  if (live?.override_active && !live.override_suppressed) {
    if (live.override_type === "boost") {
      return { key: "reason.override_boost", tone: "accent" };
    }
    if (live.override_type === "eco") {
      return { key: "reason.override_eco", tone: "accent" };
    }
    return { key: "reason.override_custom", tone: "accent" };
  }
  if (live?.night_mode?.active) {
    return { key: "reason.night_mode", tone: "info" };
  }
  if (live?.rapid_recovery_active) {
    return { key: "reason.rapid_recovery", tone: "accent" };
  }
  if (live?.active_heat_sources) {
    return { key: "reason.heat_source", tone: "info" };
  }
  if (live?.cover_auto_paused) {
    return { key: "reason.cover_paused", tone: "neutral" };
  }
  if (config.climate_mode === "off") {
    return { key: "reason.mode_off", tone: "neutral" };
  }
  if (live?.observation_status === "unknown" && hasClimateDevice(config)) {
    const modeInfo = resolveRoomModePresentation(live, config);
    if (modeInfo.source === "offline") {
      return { key: "reason.device_offline", tone: "warning" };
    }
    if (modeInfo.source === "conflict") {
      return { key: "reason.mode_conflict", tone: "warning" };
    }
    if (modeInfo.source !== "mode_only") {
      return { key: "reason.device_unverified", tone: "warning" };
    }
  }
  if (!hasClimateDevice(config)) {
    return null;
  }
  if ((config.schedules?.length ?? 0) > 0) {
    return { key: "reason.following_schedule", tone: "info" };
  }
  return { key: "reason.holding_target", tone: "neutral" };
}
