/**
 * Home Assistant schedule helpers through Home Assistant's own WebSocket commands.
 */
import type { HomeAssistant } from "../types";
import { parseWeek, serializeWeek, type HaWeek, type Week } from "./schedule-week";

export class CodedError extends Error {
  constructor(
    public readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "CodedError";
  }
}

export interface StorageScheduleItem extends Partial<HaWeek> {
  id: string;
  name: string;
  icon?: string;
}

export interface LoadedSchedule {
  entityId: string;
  itemId: string | null;
  name: string;
  icon?: string | undefined;
  week: Week;
  snapshot: string;
}

interface RegistryEntry {
  entity_id: string;
  unique_id: string;
  platform: string;
}

export function isEditableSchedule(hass: HomeAssistant, entityId: string): boolean {
  return hass.states[entityId]?.attributes?.editable === true;
}

export function isAdmin(hass: HomeAssistant): boolean {
  return hass.user?.is_admin === true;
}

async function scheduleEntityIds(hass: HomeAssistant): Promise<Map<string, string>> {
  const entries = await hass.callWS<RegistryEntry[]>({ type: "config/entity_registry/list" });
  const map = new Map<string, string>();
  for (const e of entries) {
    if (e.platform === "schedule") map.set(e.unique_id, e.entity_id);
  }
  return map;
}

export async function readWeek(hass: HomeAssistant, entityId: string): Promise<Week> {
  const result = await hass.callWS<{ response?: Record<string, Record<string, unknown>> }>({
    type: "call_service",
    domain: "schedule",
    service: "get_schedule",
    target: { entity_id: entityId },
    return_response: true,
  });
  return parseWeek(result.response?.[entityId] ?? {});
}

export async function loadSchedule(hass: HomeAssistant, entityId: string): Promise<LoadedSchedule> {
  const name = (hass.states[entityId]?.attributes?.friendly_name as string) || entityId;
  if (isEditableSchedule(hass, entityId)) {
    const [ids, items] = await Promise.all([
      scheduleEntityIds(hass),
      hass.callWS<StorageScheduleItem[]>({ type: "schedule/list" }),
    ]);
    for (const item of items) {
      if (ids.get(item.id) === entityId) {
        return {
          entityId,
          itemId: item.id,
          name: item.name,
          icon: item.icon,
          week: parseWeek(item as unknown as Record<string, unknown>),
          snapshot: itemSnapshot(item),
        };
      }
    }
  }
  return {
    entityId,
    itemId: null,
    name,
    week: await readWeek(hass, entityId),
    snapshot: "",
  };
}

export function itemSnapshot(item: { name: string; icon?: string } & Partial<HaWeek>): string {
  const week = serializeWeek(parseWeek(item as unknown as Record<string, unknown>));
  for (const ranges of Object.values(week)) {
    for (const r of ranges) {
      if (r.data) {
        r.data = Object.fromEntries(Object.entries(r.data).sort(([a], [b]) => (a < b ? -1 : 1)));
      }
    }
  }
  return JSON.stringify({ name: item.name, icon: item.icon ?? "", week });
}

export async function fetchScheduleItem(
  hass: HomeAssistant,
  itemId: string,
): Promise<StorageScheduleItem | null> {
  const items = await hass.callWS<StorageScheduleItem[]>({ type: "schedule/list" });
  return items.find((item) => item.id === itemId) ?? null;
}

export async function saveSchedule(
  hass: HomeAssistant,
  itemId: string,
  name: string,
  icon: string | undefined,
  week: Week,
): Promise<StorageScheduleItem> {
  return hass.callWS<StorageScheduleItem>({
    type: "schedule/update",
    schedule_id: itemId,
    name,
    ...(icon ? { icon } : {}),
    ...serializeWeek(week),
  });
}

export async function createSchedule(
  hass: HomeAssistant,
  name: string,
  week: Week,
): Promise<string> {
  const item = await hass.callWS<StorageScheduleItem>({
    type: "schedule/create",
    name,
    icon: "mdi:calendar-clock",
    ...serializeWeek(week),
  });
  for (let attempt = 0; attempt < 10; attempt++) {
    const entityId = (await scheduleEntityIds(hass)).get(item.id);
    if (entityId) return entityId;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new CodedError("schedule_no_entity");
}

export async function deleteSchedule(hass: HomeAssistant, itemId: string): Promise<void> {
  await hass.callWS({ type: "schedule/delete", schedule_id: itemId });
}
