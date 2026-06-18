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
        actionKey: "room.config.action_review_devices",
        tone: "complete",
        editable: true,
        editSection: "devices",
      },
      {
        section: "sensors",
        icon: "mdi:thermometer",
        titleKey: "room.section.sensors",
        metaKey: "room.config.sensors_summary",
        metaParams: { temp: "1", humidity: "1", occupancy: "0", windows: "3", primary: "" },
        actionKey: "room.config.action_review_sensor_fusion",
        tone: "complete",
        editable: true,
        editSection: "sensors",
      },
      {
        section: "heatSource",
        icon: "mdi:swap-horizontal",
        titleKey: "room.section.heat_source",
        metaKey: "comfort.inactive",
        actionKey: "room.config.action_optional",
        tone: "inactive",
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
      actionKey: "room.config.action_toggle_outdoor",
      tone: "inactive",
      editable: false,
    });
  });

  test("marks missing core sensor setup as actionable", () => {
    const [sensors] = buildConfigurationHubItems(["sensors"], {
      temperatureSensorCount: 0,
      humiditySensorConfigured: false,
    });

    expect(sensors).toMatchObject({
      tone: "missing",
      actionKey: "room.config.action_add_primary_sensor",
    });
  });
});
