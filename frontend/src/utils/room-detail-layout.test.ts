import { describe, expect, test } from "bun:test";

import { getRoomDetailLayout } from "./room-detail-layout";
import type { DeviceConfig } from "../types";

describe("getRoomDetailLayout", () => {
  test("keeps daily controls on the primary surface and moves setup-heavy sections to configuration", () => {
    const devices: DeviceConfig[] = [
      { entity_id: "climate.radiator", type: "trv", role: "primary" },
      { entity_id: "climate.ac", type: "ac", role: "secondary" },
    ];

    const layout = getRoomDetailLayout({
      isOutdoor: false,
      presenceAvailable: true,
      hasTemperatureSensor: true,
      devices,
    });

    expect(layout.primarySections).toEqual(["climateControl", "climateMode", "schedule"]);
    expect(layout.configurationSections).toEqual([
      "devices",
      "sensors",
      "comfort",
      "airflow",
      "presence",
      "covers",
      "heatSource",
      "outdoor",
    ]);
  });

  test("does not expose indoor climate controls for outdoor areas", () => {
    const layout = getRoomDetailLayout({
      isOutdoor: true,
      presenceAvailable: true,
      hasTemperatureSensor: true,
      devices: [{ entity_id: "climate.ac", type: "ac", role: "auto" }],
    });

    expect(layout.primarySections).toEqual([]);
    expect(layout.configurationSections).toEqual(["outdoor"]);
  });

  test("hides conditional configuration sections when prerequisites are missing", () => {
    const layout = getRoomDetailLayout({
      isOutdoor: false,
      presenceAvailable: false,
      hasTemperatureSensor: false,
      devices: [{ entity_id: "climate.radiator", type: "trv", role: "auto" }],
    });

    expect(layout.configurationSections).toEqual([
      "devices",
      "sensors",
      "comfort",
      "airflow",
      "covers",
      "outdoor",
    ]);
  });
});
