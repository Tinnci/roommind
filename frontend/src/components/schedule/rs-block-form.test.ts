import { describe, expect, test } from "bun:test";
import { blockTempText, buildUpdatedBlockData } from "./rs-block-form";

describe("rs-block-form helpers", () => {
  test("formats block temperature labels cleanly", () => {
    expect(blockTempText(undefined, "°C")).toBe("");
    expect(blockTempText({ temperature: 21.5 }, "°C")).toBe("21.5°C");
    expect(blockTempText({ heat_temperature: 20, cool_temperature: 25 }, "°C")).toBe(
      "20°C / 25°C",
    );
  });

  test("preserves unknown block data while updating temperature", () => {
    const updated = buildUpdatedBlockData({ custom: "keep" }, "22.5");
    expect(updated).toEqual({ custom: "keep", temperature: 22.5 });
    expect(buildUpdatedBlockData(updated, "")).toEqual({ custom: "keep" });
  });
});
