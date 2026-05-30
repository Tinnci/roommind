import { describe, expect, test } from "bun:test";

import { buildConfigurationHubItems } from "./room-configuration-hub";

describe("buildConfigurationHubItems", () => {
  test("builds editable configuration rows with compact summaries", () => {
    const items = buildConfigurationHubItems(["devices", "sensors", "heatSource"], {
      deviceCount: 2,
      temperatureSensorCount: 1,
      humiditySensorConfigured: true,
      windowSensorCount: 3,
      heatSourceOrchestration: false,
    });

    expect(items).toEqual([
      {
        section: "devices",
        icon: "mdi:power-plug",
        titleKey: "room.section.devices",
        metaKey: "room.config.devices_summary",
        metaParams: { count: "2" },
        editable: true,
        editSection: "devices",
      },
      {
        section: "sensors",
        icon: "mdi:thermometer",
        titleKey: "room.section.sensors",
        metaKey: "room.config.sensors_summary",
        metaParams: { temp: "1", humidity: "1", windows: "3" },
        editable: true,
        editSection: "sensors",
      },
      {
        section: "heatSource",
        icon: "mdi:swap-horizontal",
        titleKey: "room.section.heat_source",
        metaKey: "comfort.inactive",
        editable: true,
        editSection: "heatSource",
      },
    ]);
  });

  test("marks outdoor row as static and uses outdoor hint", () => {
    const items = buildConfigurationHubItems(["outdoor"], {});

    expect(items[0]).toMatchObject({
      section: "outdoor",
      icon: "mdi:tree",
      titleKey: "room.outdoor_toggle",
      metaKey: "room.outdoor_hint",
      editable: false,
    });
  });
});
