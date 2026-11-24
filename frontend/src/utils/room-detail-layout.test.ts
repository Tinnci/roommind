import { describe, expect, test } from "bun:test";

import { getRoomDetailLayout } from "./room-detail-layout";
import type { DeviceConfig } from "../types";

describe("getRoomDetailLayout", () => {
  test("places targets and optional schedule inside configuration hub", () => {
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

    expect(layout.primarySections).toEqual([]);
    expect(layout.configurationSections).toEqual([
      "targets",
      "devices",
      "sensors",
      "comfort",
      "airflow",
      "presence",
      "schedule",
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
      "targets",
      "devices",
      "sensors",
      "comfort",
      "airflow",
      "schedule",
      "covers",
      "outdoor",
    ]);
  });
});
