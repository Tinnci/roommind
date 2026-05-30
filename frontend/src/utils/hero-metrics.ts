import type { RoomLiveData } from "../types";

export type HeroMetricId =
  | "moldRisk"
  | "learningPaused"
  | "notControlled"
  | "rapidRecovery"
  | "nightMode"
  | "moldPrevention"
  | "deviceSetpoint"
  | "activeHeatSources"
  | "perceivedTemp"
  | "humidity";

export interface HeroMetricSelectionInput {
  live: RoomLiveData;
  isOutdoor: boolean;
  climateControlActive: boolean;
}

export function selectHeroMetricIds(input: HeroMetricSelectionInput): HeroMetricId[] {
  const { live, isOutdoor, climateControlActive } = input;

  if (isOutdoor) {
    return live.current_humidity !== null ? ["humidity"] : [];
  }

  const candidates: HeroMetricId[] = [];
  if (live.mold_surface_rh != null && live.mold_risk_level !== "ok") {
    candidates.push("moldRisk");
  }
  if (live.learning_paused_reason === "outdoor_unavailable") {
    candidates.push("learningPaused");
  }
  if (!climateControlActive) {
    candidates.push("notControlled");
  }
  if (live.rapid_recovery_active) {
    candidates.push("rapidRecovery");
  }
  if (live.night_mode?.active) {
    candidates.push("nightMode");
  }
  if (live.mold_prevention_active) {
    candidates.push("moldPrevention");
  }
  if (live.device_setpoint != null) {
    candidates.push("deviceSetpoint");
  }
  if (live.active_heat_sources && live.active_heat_sources !== "none") {
    candidates.push("activeHeatSources");
  }
  if (live.perceived_temp != null) {
    candidates.push("perceivedTemp");
  }
  if (live.current_humidity !== null) {
    candidates.push("humidity");
  }

  return candidates.slice(0, 3);
}
