import type { RoomConfig } from "../types";

export interface RoomOverviewStatus {
  activeCount: number;
  heatingCount: number;
  coolingCount: number;
  externalActiveCount: number;
  effectiveOverrideCount: number;
  pausedOverrideCount: number;
}

export function hasClimateDevice(config: RoomConfig): boolean {
  return (
    (config.devices?.length ?? 0) > 0 ||
    (config.thermostats?.length ?? 0) > 0 ||
    (config.acs?.length ?? 0) > 0
  );
}

export function isRoomControlEffective(config: RoomConfig, climateControlActive: boolean): boolean {
  return (
    climateControlActive &&
    config.climate_control_enabled !== false &&
    !config.is_outdoor &&
    hasClimateDevice(config)
  );
}

export function isOverrideEffective(config: RoomConfig, climateControlActive: boolean): boolean {
  return Boolean(
    config.live?.override_active &&
    !config.live.override_suppressed &&
    isRoomControlEffective(config, climateControlActive),
  );
}

export function summarizeRoomOverview(
  configs: RoomConfig[],
  climateControlActive: boolean,
): RoomOverviewStatus {
  let heatingCount = 0;
  let coolingCount = 0;
  let externalActiveCount = 0;
  let effectiveOverrideCount = 0;
  let pausedOverrideCount = 0;

  for (const config of configs) {
    const live = config.live;
    if (!live) continue;

    const controlEffective = isRoomControlEffective(config, climateControlActive);
    if (controlEffective && live.mode === "heating") heatingCount += 1;
    if (controlEffective && live.mode === "cooling") coolingCount += 1;
    if (
      !controlEffective &&
      hasClimateDevice(config) &&
      (live.mode === "heating" || live.mode === "cooling")
    ) {
      externalActiveCount += 1;
    }

    if (live.override_active) {
      if (isOverrideEffective(config, climateControlActive)) effectiveOverrideCount += 1;
      else pausedOverrideCount += 1;
    }
  }

  return {
    activeCount: heatingCount + coolingCount,
    heatingCount,
    coolingCount,
    externalActiveCount,
    effectiveOverrideCount,
    pausedOverrideCount,
  };
}
