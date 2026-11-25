import type { AreaInfo } from "../types";

/**
 * Append area IDs to the hidden list without duplicates while recording newly added IDs.
 */
export function hideRoomIds(
  currentHidden: readonly string[],
  idsToHide: readonly string[],
): { nextHidden: string[]; addedIds: string[] } {
  const seen = new Set(currentHidden);
  const nextHidden = [...currentHidden];
  const addedIds: string[] = [];

  for (const id of idsToHide) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    nextHidden.push(id);
    addedIds.push(id);
  }

  return { nextHidden, addedIds };
}

/**
 * Remove one or more area IDs from the hidden list.
 */
export function unhideRoomIds(
  currentHidden: readonly string[],
  idsToUnhide: readonly string[],
): string[] {
  const toRemove = new Set(idsToUnhide);
  return currentHidden.filter((id) => !toRemove.has(id));
}

/**
 * Return visible area IDs that are both unconfigured and have zero climate or environment sensors.
 */
export function getEmptyUnconfiguredAreaIds(
  areaInfos: readonly AreaInfo[],
  hiddenIds: readonly string[],
): string[] {
  const hiddenSet = new Set(hiddenIds);
  return areaInfos
    .filter(
      (info) =>
        !hiddenSet.has(info.area.area_id) &&
        info.config === null &&
        info.climateEntityCount === 0 &&
        info.tempSensorCount === 0 &&
        (info.humiditySensorCount ?? 0) === 0,
    )
    .map((info) => info.area.area_id);
}
