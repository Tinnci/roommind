import { describe, expect, it } from "bun:test";
import type { AreaInfo, RoomConfig } from "../types";
import { getEmptyUnconfiguredAreaIds, hideRoomIds, unhideRoomIds } from "./hidden-rooms";

function makeAreaInfo(
  areaId: string,
  opts: { config?: RoomConfig | null; climateEntityCount?: number } = {},
): AreaInfo {
  return {
    area: { area_id: areaId, name: areaId, picture: null, floor_id: null },
    config: opts.config ?? null,
    climateEntityCount: opts.climateEntityCount ?? 0,
    tempSensorCount: 0,
  };
}

describe("hidden-rooms", () => {
  it("hides single and multiple rooms without duplicates and tracks added IDs", () => {
    expect(hideRoomIds(["hallway"], ["garage"])).toEqual({
      nextHidden: ["hallway", "garage"],
      addedIds: ["garage"],
    });

    expect(hideRoomIds(["hallway", "garage"], ["garage", "attic", "hallway"])).toEqual({
      nextHidden: ["hallway", "garage", "attic"],
      addedIds: ["attic"],
    });
  });

  it("unhides one or several rooms cleanly", () => {
    expect(unhideRoomIds(["hallway", "garage", "attic"], ["garage"])).toEqual(["hallway", "attic"]);
    expect(unhideRoomIds(["hallway", "garage", "attic"], ["hallway", "attic"])).toEqual(["garage"]);
  });

  it("selects only visible unconfigured areas with zero climate devices", () => {
    const items = [
      makeAreaInfo("hallway"),
      makeAreaInfo("kitchen", { climateEntityCount: 1 }),
      makeAreaInfo("bedroom", { config: { area_id: "bedroom" } as RoomConfig }),
      makeAreaInfo("closet"),
    ];

    expect(getEmptyUnconfiguredAreaIds(items, ["closet"])).toEqual(["hallway"]);
    expect(getEmptyUnconfiguredAreaIds(items, [])).toEqual(["hallway", "closet"]);
  });
});
