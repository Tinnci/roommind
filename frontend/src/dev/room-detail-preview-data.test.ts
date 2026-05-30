import { describe, expect, test } from "bun:test";
import { createRoomDetailPreviewModel } from "./room-detail-preview-data";

describe("room detail preview model", () => {
  test("provides a configured indoor room with night-mode and airflow data", () => {
    const model = createRoomDetailPreviewModel();

    expect(model.area.area_id).toBe(model.config.area_id);
    expect(model.config.devices?.map((device) => device.entity_id)).toContain(
      "climate.bedroom_radiator",
    );
    expect(model.config.airflow_devices?.map((device) => device.entity_id)).toContain(
      "fan.bedroom_ceiling_fan",
    );
    expect(model.config.quiet_hours).toEqual({ start: "22:30", end: "06:30" });
    expect(model.config.live?.night_mode?.active).toBe(true);
    expect(model.hass.states[model.config.temperature_sensor]?.state).toBe("20.8");
  });
});
