import { describe, expect, test } from "bun:test";
import type { HomeAssistant } from "../types";
import { toCelsiusDelta, toDisplayDelta } from "./temperature";

describe("setback temperature differences", () => {
  test.each([
    ["°C", 3.5, 3.5],
    ["°F", 1, 1.8],
    ["°F", 2, 3.6],
    ["°F", 3.5, 6.3],
    ["°F", 5, 9],
  ] as const)("preserves a %s delta through display and save", (unit, celsius, displayed) => {
    const hass = { config: { unit_system: { temperature: unit } } } as HomeAssistant;

    expect(toDisplayDelta(celsius, hass)).toBeCloseTo(displayed);
    expect(toCelsiusDelta(displayed, hass)).toBeCloseTo(celsius);
  });
});
