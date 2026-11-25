/**
 * Whole-home HVAC fleet summary and interactive overview filtering helpers.
 */
import type { AreaInfo, CompressorGroup, HomeAssistant } from "../types";
import { hasClimateDevice, isMonitorOnlyRoom, isRoomControlEffective } from "./room-overview-status";
import { getDisplayMode } from "./room-state";
import { buildThermostatFleet } from "./thermostat-fleet";

export type FleetFilter =
  "all" | "active" | "multi_unit" | "cooling" | "heating" | "off" | "monitored" | "attention";

export interface FleetOverviewStats {
  configuredRooms: number;
  monitoredRooms: number;
  totalUnits: number;
  activeUnits: number;
  activeRooms: number;
  coolingDryingRooms: number;
  heatingRooms: number;
  offIdleRooms: number;
  attentionRooms: number;
  multiUnitRooms: number;
}

function isRoomAttention(
  info: AreaInfo,
  hass: HomeAssistant,
  compressorGroups: CompressorGroup[],
): boolean {
  const config = info.config;
  const live = config?.live;
  if (!config || !live) return false;
  if (
    live.window_open ||
    live.mold_risk_level === "warning" ||
    live.mold_risk_level === "critical" ||
    Boolean(live.learning_paused_reason)
  ) {
    return true;
  }
  return buildThermostatFleet(config, hass, compressorGroups).hasConflict;
}

export function matchesFleetFilter(
  info: AreaInfo,
  filter: FleetFilter,
  hass: HomeAssistant,
  climateControlActive: boolean,
  compressorGroups: CompressorGroup[] = [],
): boolean {
  if (filter === "all") return true;
  const config = info.config;
  if (!config || config.is_outdoor) return false;

  if (filter === "monitored") {
    return isMonitorOnlyRoom(config);
  }
  if (filter === "attention") {
    return isRoomAttention(info, hass, compressorGroups);
  }
  if (!hasClimateDevice(config)) return false;

  const displayMode = getDisplayMode(config.live, config);
  const controlEffective = isRoomControlEffective(config, climateControlActive);
  const fleet = buildThermostatFleet(config, hass, compressorGroups);

  switch (filter) {
    case "active":
      return (
        fleet.active > 0 ||
        (controlEffective &&
          (displayMode === "cooling" ||
            displayMode === "heating" ||
            displayMode === "dry" ||
            displayMode === "fan_only"))
      );
    case "multi_unit":
      return fleet.total >= 2;
    case "cooling":
      return displayMode === "cooling" || displayMode === "dry";
    case "heating":
      return displayMode === "heating";
    case "off":
      return displayMode === "off" || displayMode === "idle" || !controlEffective;
  }
}

export function summarizeFleetOverview(
  infos: AreaInfo[],
  hass: HomeAssistant,
  climateControlActive: boolean,
  compressorGroups: CompressorGroup[] = [],
): FleetOverviewStats {
  const seenUnits = new Set<string>();
  const seenActiveUnits = new Set<string>();
  let configuredRooms = 0;
  let monitoredRooms = 0;
  let activeRooms = 0;
  let coolingDryingRooms = 0;
  let heatingRooms = 0;
  let offIdleRooms = 0;
  let attentionRooms = 0;
  let multiUnitRooms = 0;

  for (const info of infos) {
    const config = info.config;
    if (!config || config.is_outdoor) continue;

    if (isMonitorOnlyRoom(config)) {
      monitoredRooms += 1;
      if (isRoomAttention(info, hass, compressorGroups)) attentionRooms += 1;
      continue;
    }
    if (!hasClimateDevice(config)) continue;

    configuredRooms += 1;
    const fleet = buildThermostatFleet(config, hass, compressorGroups);
    for (const unit of fleet.units) {
      seenUnits.add(unit.entityId);
      if (unit.isActive) seenActiveUnits.add(unit.entityId);
    }

    if (fleet.total >= 2) multiUnitRooms += 1;

    const displayMode = getDisplayMode(config.live, config);
    const controlEffective = isRoomControlEffective(config, climateControlActive);

    if (displayMode === "cooling" || displayMode === "dry") coolingDryingRooms += 1;
    if (displayMode === "heating") heatingRooms += 1;
    if (displayMode === "off" || displayMode === "idle" || !controlEffective) offIdleRooms += 1;
    if (
      fleet.active > 0 ||
      (controlEffective &&
        (displayMode === "cooling" ||
          displayMode === "heating" ||
          displayMode === "dry" ||
          displayMode === "fan_only"))
    ) {
      activeRooms += 1;
    }
    if (isRoomAttention(info, hass, compressorGroups)) attentionRooms += 1;
  }

  return {
    configuredRooms,
    monitoredRooms,
    totalUnits: seenUnits.size,
    activeUnits: seenActiveUnits.size,
    activeRooms,
    coolingDryingRooms,
    heatingRooms,
    offIdleRooms,
    attentionRooms,
    multiUnitRooms,
  };
}
