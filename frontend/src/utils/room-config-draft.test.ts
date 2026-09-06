import { describe, expect, test } from "bun:test";

import {
  applyCoverSelectionChange,
  applyDeviceConfigChange,
  applySensorConfigChange,
  buildRoomSavePayload,
  createRoomConfigDraft,
  createEmptyRoomConfigDraft,
  patchRoomConfigDraft,
} from "./room-config-draft";
import type { RoomConfig } from "../types";

const baseConfig: RoomConfig = {
  area_id: "living_room",
  thermostats: ["climate.radiator"],
  acs: ["climate.ac"],
  temperature_sensor: "sensor.main_temp",
  temperature_sensors: ["sensor.secondary_temp", "sensor.main_temp"],
  humidity_sensor: "",
  humidity_sensors: [],
  window_sensors: [],
  window_open_delay: 0,
  window_close_delay: 0,
  climate_mode: "auto",
  schedules: [],
  schedule_selector_entity: "",
  comfort_heat: 21,
  comfort_cool: 24,
  eco_heat: 17,
  eco_cool: 27,
  heating_system_type: "radiator",
};

describe("room config draft", () => {
  test("preserves disabled recovery and a zero Overdrive limit when saving", () => {
    const draft = createRoomConfigDraft({
      ...baseConfig,
      rapid_recovery_enabled: false,
      devices: [{ entity_id: "climate.radiator", type: "trv", role: "auto", max_setpoint_offset_c: 0 }],
    });
    const payload = buildRoomSavePayload("living_room", draft);
    expect(payload.rapid_recovery_enabled).toBe(false);
    expect(payload.devices).toEqual(draft.devices);
    expect(draft.devices[0]?.max_setpoint_offset_c).toBe(0);
  });
  test("creates a draft from legacy thermostat and AC lists when devices are absent", () => {
    const draft = createRoomConfigDraft(baseConfig);

    expect(draft.devices).toEqual([
      {
        entity_id: "climate.radiator",
        type: "trv",
        role: "auto",
        heating_system_type: "radiator",
      },
      { entity_id: "climate.ac", type: "ac", role: "auto" },
    ]);
    expect([...draft.selectedTempSensors]).toEqual(["sensor.main_temp", "sensor.secondary_temp"]);
  });

  test("uses stable defaults for an unconfigured room", () => {
    const draft = createEmptyRoomConfigDraft();

    expect(draft.climateMode).toBe("auto");
    expect(draft.nightModeEnabled).toBe(true);
    expect(draft.comfortHeat).toBe(21);
    expect(draft.coversOutdoorMinTemp).toBe(10);
  });

  test("preserves a disabled outdoor cover gate across a save round-trip", () => {
    const draft = createRoomConfigDraft({
      ...baseConfig,
      covers_outdoor_min_temp: null,
    });

    const payload = buildRoomSavePayload("living_room", draft);

    expect(payload.covers_outdoor_min_temp).toBeNull();
  });

  test("builds the websocket save payload with primary temperature sensor first and no duplicates", () => {
    const draft = createRoomConfigDraft(baseConfig);
    draft.selectedTempSensor = "sensor.secondary_temp";

    const payload = buildRoomSavePayload("living_room", draft);

    expect(payload).toMatchObject({
      type: "roommind/rooms/save",
      area_id: "living_room",
      devices: draft.devices,
      temperature_sensor: "sensor.secondary_temp",
      temperature_sensors: ["sensor.secondary_temp", "sensor.main_temp"],
      humidity_sensors: [],
      climate_mode: "auto",
      climate_control_enabled: true,
    });
  });

  test("builds humidity source priority with primary first and no duplicates", () => {
    const draft = createRoomConfigDraft({
      ...baseConfig,
      humidity_sensor: "sensor.main_humidity",
      humidity_sensors: ["sensor.backup_humidity", "sensor.main_humidity"],
    });
    draft.selectedHumiditySensor = "sensor.backup_humidity";

    const payload = buildRoomSavePayload("living_room", draft);

    expect(payload).toMatchObject({
      humidity_sensor: "sensor.backup_humidity",
      humidity_sensors: ["sensor.backup_humidity", "sensor.main_humidity"],
    });
  });

  test("cleans valve protection exclusions when devices are removed or stop being TRVs", () => {
    const result = applyDeviceConfigChange(
      {
        devices: [
          { entity_id: "climate.old_trv", type: "trv", role: "auto" },
          { entity_id: "climate.changed", type: "trv", role: "auto" },
        ],
        valveProtectionExclude: new Set(["climate.old_trv", "climate.changed"]),
      },
      [
        { entity_id: "climate.changed", type: "ac", role: "auto" },
        { entity_id: "climate.new_trv", type: "trv", role: "auto" },
      ],
    );

    expect(result.devices.map((device) => device.entity_id)).toEqual([
      "climate.changed",
      "climate.new_trv",
    ]);
    expect([...result.valveProtectionExclude]).toEqual([]);
  });

  test("keeps temperature sensor selection internally consistent", () => {
    const byPrimary = applySensorConfigChange(
      {
        selectedTempSensor: "",
        selectedTempSensors: new Set(["sensor.secondary"]),
        selectedHumiditySensor: "",
        selectedHumiditySensors: new Set(),
        selectedOccupancySensors: new Set(),
        selectedWindowSensors: new Set(),
        windowOpenDelay: 0,
        windowCloseDelay: 0,
      },
      "temperature_sensor",
      "sensor.main",
    );

    expect(byPrimary.selectedTempSensor).toBe("sensor.main");
    expect([...byPrimary.selectedTempSensors]).toEqual(["sensor.main", "sensor.secondary"]);

    const byList = applySensorConfigChange(byPrimary, "temperature_sensors", ["sensor.secondary"]);

    expect(byList.selectedTempSensor).toBe("sensor.secondary");
    expect([...byList.selectedTempSensors]).toEqual(["sensor.secondary"]);
  });

  test("keeps primary temperature source when auxiliary fusion sensors change", () => {
    const result = applySensorConfigChange(
      {
        selectedTempSensor: "sensor.main",
        selectedTempSensors: new Set(["sensor.main", "sensor.bedside"]),
        selectedHumiditySensor: "",
        selectedHumiditySensors: new Set(),
        selectedOccupancySensors: new Set(),
        selectedWindowSensors: new Set(),
        windowOpenDelay: 0,
        windowCloseDelay: 0,
      },
      "temperature_sensors",
      ["sensor.main", "sensor.bedside", "sensor.radiator"],
    );

    expect(result.selectedTempSensor).toBe("sensor.main");
    expect([...result.selectedTempSensors]).toEqual([
      "sensor.main",
      "sensor.bedside",
      "sensor.radiator",
    ]);
  });

  test("keeps humidity source priority internally consistent", () => {
    const byPrimary = applySensorConfigChange(
      {
        selectedTempSensor: "",
        selectedTempSensors: new Set(),
        selectedHumiditySensor: "",
        selectedHumiditySensors: new Set(["sensor.backup_humidity"]),
        selectedOccupancySensors: new Set(),
        selectedWindowSensors: new Set(),
        windowOpenDelay: 0,
        windowCloseDelay: 0,
      },
      "humidity_sensor",
      "sensor.main_humidity",
    );

    expect(byPrimary.selectedHumiditySensor).toBe("sensor.main_humidity");
    expect([...byPrimary.selectedHumiditySensors]).toEqual([
      "sensor.main_humidity",
      "sensor.backup_humidity",
    ]);

    const byList = applySensorConfigChange(byPrimary, "humidity_sensors", [
      "sensor.backup_humidity",
    ]);

    expect(byList.selectedHumiditySensor).toBe("sensor.backup_humidity");
    expect([...byList.selectedHumiditySensors]).toEqual(["sensor.backup_humidity"]);
  });

  test("removes per-cover settings when a cover is deselected", () => {
    const result = applyCoverSelectionChange(
      {
        selectedCovers: new Set(["cover.left", "cover.right"]),
        coverOrientations: { "cover.left": 180, "cover.right": 90 },
        coverMinPositions: { "cover.left": 25, "cover.right": 40 },
      },
      "cover.left",
      false,
    );

    expect([...result.selectedCovers]).toEqual(["cover.right"]);
    expect(result.coverOrientations).toEqual({ "cover.right": 90 });
    expect(result.coverMinPositions).toEqual({ "cover.right": 40 });
  });

  test("patches a draft immutably while preserving untouched fields", () => {
    const draft = createEmptyRoomConfigDraft();
    const next = patchRoomConfigDraft(draft, {
      displayName: "Living room",
      comfortHeat: 20.5,
    });

    expect(next).not.toBe(draft);
    expect(next.displayName).toBe("Living room");
    expect(next.comfortHeat).toBe(20.5);
    expect(next.ecoCool).toBe(draft.ecoCool);
    expect(next.selectedTempSensors).toBe(draft.selectedTempSensors);
  });
});
