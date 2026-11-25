/**
 * Frontend discovery and formatting helpers for bed microclimate / heated blanket devices.
 */
import type {
  HomeAssistant,
  SleepCurveStatus,
  SleepDeviceConfig,
  SleepDeviceLiveStatus,
} from "../types";
import type { TranslationKey } from "./localize";
import { getEntitiesForArea } from "./room-state";

export interface SleepSafetyBadge {
  key: TranslationKey;
  tone: "warning" | "error" | "ok" | "info";
  icon: string;
}

/**
 * Parse a qushui MIoT sleep curve string (`0-1-23000700-...`) into UI fields.
 */
export function parseQushuiCurveWindow(raw: string | null | undefined): SleepCurveStatus | null {
  if (!raw || typeof raw !== "string") return null;
  const parts = raw.trim().split("-");
  if (parts.length < 3 || !/^\d{8}$/.test(parts[2] ?? "")) return null;
  const win = parts[2]!;
  return {
    enabled: parts[1] === "1",
    start: `${win.slice(0, 2)}:${win.slice(2, 4)}`,
    end: `${win.slice(4, 6)}:${win.slice(6, 8)}`,
  };
}

function scoreBlanketEntity(entityId: string): boolean {
  const lower = entityId.toLowerCase();
  return (
    lower.includes("qushui") ||
    lower.includes("8hz1") ||
    lower.includes("blanket") ||
    lower.includes("a_b_gears") ||
    lower.includes("ab_sleep")
  );
}

/**
 * Discover a heated blanket (such as qushui.blanket.8hz1) belonging to the given area.
 */
export function discoverSleepDeviceInArea(
  areaId: string,
  hass: HomeAssistant,
): SleepDeviceConfig | null {
  const areaEntities = getEntitiesForArea(areaId, hass.entities, hass.devices);
  const candidates = areaEntities.filter((e) => scoreBlanketEntity(e.entity_id));
  if (candidates.length === 0) return null;

  // Group by device_id so all sub-entities of the blanket bundle cleanly together
  const byDevice = new Map<string, typeof candidates>();
  for (const entry of candidates) {
    const key = entry.device_id || "ungrouped";
    const list = byDevice.get(key) ?? [];
    list.push(entry);
    byDevice.set(key, list);
  }

  let bestGroup = candidates;
  for (const group of byDevice.values()) {
    if (group.length > bestGroup.length) bestGroup = group;
  }

  const findBy = (domain: string, matcher: (id: string) => boolean): string =>
    bestGroup.find(
      (e) => e.entity_id.startsWith(`${domain}.`) && matcher(e.entity_id.toLowerCase()),
    )?.entity_id ?? "";

  const power = findBy(
    "switch",
    (id) =>
      (id.includes("_on_") || id.endsWith("_on") || id.endsWith("_power")) &&
      !id.includes("sleep") &&
      !id.includes("scald") &&
      !id.includes("screen") &&
      !id.includes("lock"),
  );
  const heatLevel = findBy("select", (id) => id.includes("heat_level") || id.includes("gear"));
  const gears = findBy("text", (id) => id.includes("gears"));
  const sleepSwitch = findBy(
    "switch",
    (id) => id.includes("sleep_switch") || id.includes("ab_sleep"),
  );
  const zoneASleep = findBy("text", (id) => id.includes("a_sleep"));
  const zoneBSleep = findBy("text", (id) => id.includes("b_sleep"));
  const zoneACountdown = findBy("number", (id) => id.includes("a_countdown"));
  const zoneBCountdown = findBy("number", (id) => id.includes("b_countdown"));
  const remoteSwitch = findBy("binary_sensor", (id) => id.includes("remote"));
  const miteRemoval = findBy("binary_sensor", (id) => id.includes("mite"));
  const antiScald = findBy("switch", (id) => id.includes("anti_scald"));
  const fault = findBy("sensor", (id) => id.includes("fault"));

  if (!power && !heatLevel && !gears && !sleepSwitch) {
    return null;
  }

  const deviceId = bestGroup[0]?.device_id;
  const devEntry = deviceId ? hass.devices?.[deviceId] : undefined;
  const friendlyName =
    devEntry?.name_by_user ||
    devEntry?.name ||
    String(hass.states?.[power || sleepSwitch || heatLevel]?.attributes?.friendly_name || "") ||
    "Sleep Blanket";

  return {
    name: friendlyName,
    power_entity: power,
    heat_level_entity: heatLevel,
    gears_entity: gears,
    sleep_switch_entity: sleepSwitch,
    zone_a_sleep_entity: zoneASleep,
    zone_b_sleep_entity: zoneBSleep,
    zone_a_countdown_entity: zoneACountdown,
    zone_b_countdown_entity: zoneBCountdown,
    remote_switch_entity: remoteSwitch,
    mite_removal_entity: miteRemoval,
    anti_scald_entity: antiScald,
    fault_entity: fault,
    prewarm_gear_a: 4,
    prewarm_gear_b: 4,
    sleep_gear_a: 2,
    sleep_gear_b: 2,
    sync_native_curve: true,
  };
}

/**
 * Derive user-facing safety/status pills for a linked sleep blanket.
 */
export function buildSleepSafetyBadges(
  status: SleepDeviceLiveStatus | null | undefined,
): SleepSafetyBadge[] {
  if (!status || !status.configured) return [];
  const badges: SleepSafetyBadge[] = [];
  if (!status.fault_ok) {
    badges.push({
      key: "sleep.safety.fault",
      tone: "error",
      icon: "mdi:alert-octagon-outline",
    });
  }
  if (!status.remote_enabled) {
    badges.push({
      key: "sleep.safety.remote_disabled",
      tone: "warning",
      icon: "mdi:remote-off",
    });
  }
  if (status.mite_removal_active) {
    badges.push({
      key: "sleep.safety.mite_removal",
      tone: "info",
      icon: "mdi:bug-outline",
    });
  }
  if (status.anti_scald_on === true) {
    badges.push({
      key: "sleep.safety.anti_scald",
      tone: "ok",
      icon: "mdi:shield-check-outline",
    });
  }
  return badges;
}
