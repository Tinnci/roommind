import { describe, expect, test } from "bun:test";

import type { HVACOutputStatus } from "../types";
import { describeHvacOutput } from "./hvac-output";

const output: HVACOutputStatus = {
  entity_id: "climate.ac",
  stage: "unknown",
  delivered_capacity_factor: 0,
  confidence: "unknown",
};

describe("HVAC output evidence", () => {
  test("unknown output is never displayed as zero capacity or zero watts", () => {
    const text = describeHvacOutput(output, "en");

    expect(text).toContain("Unknown");
    expect(text).not.toContain("0.00");
    expect(text).not.toContain("0 W");
  });

  test("measured electrical power is separate from the estimated compressor load", () => {
    const text = describeHvacOutput(
      {
        ...output,
        stage: "compressor_mid",
        delivered_capacity_factor: 1.2,
        electric_power_w: 800,
        electric_power_source: "sensor",
        confidence: "estimated",
      },
      "en",
    );

    expect(text).toContain("estimated");
    expect(text).toContain("Measured: 800 W");
  });

  test("a fan curve is never labeled as measured AC power", () => {
    const text = describeHvacOutput(
      {
        ...output,
        stage: "compressor_active",
        electric_power_w: 20,
        electric_power_source: "fan_curve",
        confidence: "estimated",
      },
      "en",
    );

    expect(text).toContain("load unknown");
    expect(text).toContain("Estimated fan: 20 W");
    expect(text).not.toContain("Measured");
  });

  test("older payloads keep unqualified electrical power unqualified", () => {
    const text = describeHvacOutput({ ...output, electric_power_w: 20 }, "en");

    expect(text).toContain("20 W");
    expect(text).not.toContain("Measured");
  });

  test("zero measured power is retained and invalid values are omitted", () => {
    expect(
      describeHvacOutput({ ...output, electric_power_w: 0, electric_power_source: "sensor" }, "en"),
    ).toContain("Measured: 0 W");
    for (const value of [NaN, Infinity, -1]) {
      expect(describeHvacOutput({ ...output, electric_power_w: value }, "en")).not.toContain(" W");
    }
  });

  test("output descriptions are localized for Chinese and German", () => {
    const status = {
      ...output,
      stage: "compressor_active",
      electric_power_w: 800,
      electric_power_source: "sensor" as const,
    };

    expect(describeHvacOutput(status, "zh-Hans")).toContain("实测：800 W");
    expect(describeHvacOutput(status, "de")).toContain("Gemessen: 800 W");
  });
});
