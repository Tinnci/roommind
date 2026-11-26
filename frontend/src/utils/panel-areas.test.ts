import { describe, expect, it } from "bun:test";
import type { AreaInfo, HassArea, HomeAssistant, RoomConfig, RoomLiveData } from "../types";
import {
  buildFloorGroups,
  buildPriorityGroups,
  computeAreaInfos,
  formatHiddenRoomMeta,
  resolveAreaPriorityGroup,
} from "./panel-areas";

function makeHass(overrides: Record<string, unknown> = {}): HomeAssistant {
  return {
    language: "en",
    config: { unit_system: { temperature: "°C" } },
    areas: {},
    devices: {},
    entities: {},
    states: {},
    floors: {},
    ...overrides,
  } as unknown as HomeAssistant;
}

function makeArea(area_id: string, name: string, floor_id: string | null = null): HassArea {
  return { area_id, name, floor_id, picture: null };
}

function makeRoom(areaId: string, overrides: Record<string, unknown> = {}): RoomConfig {
  return {
    area_id: areaId,
    thermostats: [],
    acs: [],
    devices: [],
    temperature_sensor: "sensor.temp",
    humidity_sensor: "",
    climate_mode: "auto",
    climate_control_enabled: true,
    ...overrides,
  } as unknown as RoomConfig;
}

describe("panel-areas helpers", () => {
  it("sorts configured areas by custom roomOrder first and orders remaining areas consistently", () => {
    const hass = makeHass({
      areas: {
        living: makeArea("living", "Living Room", "f1"),
        study: makeArea("study", "Study", "f1"),
        attic: makeArea("attic", "Attic", null),
      },
      entities: {
        "climate.study_ac": { entity_id: "climate.study_ac", area_id: "study", platform: "tcl" },
      },
      states: {},
    });

    const infos = computeAreaInfos(hass, { living: makeRoom("living") }, ["study"]);
    expect(infos.map((i) => i.area.area_id)).toEqual(["study", "living", "attic"]);
  });

  it("assigns priority groups for setup, attention, active, and monitoring rooms", () => {
    const hass = makeHass({
      states: {
        "climate.ac": { state: "cool", attributes: { hvac_modes: ["off", "cool", "heat"] } },
      },
    });
    const unconfigured: AreaInfo = {
      area: makeArea("a", "A"),
      config: null,
      climateEntityCount: 0,
      tempSensorCount: 0,
    };
    const windowOpen: AreaInfo = {
      area: makeArea("b", "B"),
      config: makeRoom("b", {
        live: { window_open: true, mode: "idle" } as unknown as RoomLiveData,
      }),
      climateEntityCount: 0,
      tempSensorCount: 1,
    };
    const active: AreaInfo = {
      area: makeArea("c", "C"),
      config: makeRoom("c", {
        devices: [{ entity_id: "climate.ac", type: "ac", role: "primary" }],
        live: { mode: "cooling", commanded_mode: "cooling" } as unknown as RoomLiveData,
      }),
      climateEntityCount: 1,
      tempSensorCount: 1,
    };
    const monitoring: AreaInfo = {
      area: makeArea("d", "D"),
      config: makeRoom("d", {
        live: { mode: "idle", current_temp: 22.4 } as unknown as RoomLiveData,
      }),
      climateEntityCount: 0,
      tempSensorCount: 1,
    };

    expect(resolveAreaPriorityGroup(unconfigured, hass, [], true)).toBe("setup");
    expect(resolveAreaPriorityGroup(windowOpen, hass, [], true)).toBe("attention");
    expect(resolveAreaPriorityGroup(active, hass, [], true)).toBe("active");
    expect(resolveAreaPriorityGroup(monitoring, hass, [], true)).toBe("monitoring");

    const groups = buildPriorityGroups(
      [monitoring, active, windowOpen, unconfigured],
      hass,
      [],
      true,
    );
    expect(groups.map((g) => g.id)).toEqual(["attention", "active", "monitoring", "setup"]);
  });

  it("groups areas by floor level descending with unassigned last", () => {
    const hass = makeHass({
      floors: {
        ground: { floor_id: "ground", name: "Ground", level: 0 },
        upper: { floor_id: "upper", name: "Upper", level: 1 },
      },
    });
    const items: AreaInfo[] = [
      { area: makeArea("a", "A", null), config: null, climateEntityCount: 0, tempSensorCount: 0 },
      {
        area: makeArea("b", "B", "ground"),
        config: null,
        climateEntityCount: 0,
        tempSensorCount: 0,
      },
      {
        area: makeArea("c", "C", "upper"),
        config: null,
        climateEntityCount: 0,
        tempSensorCount: 0,
      },
    ];
    const floorGroups = buildFloorGroups(items, hass, true);
    expect(floorGroups.map((g) => g.name)).toEqual(["Upper", "Ground", "Other"]);
  });

  it("formats monitor-only hidden room metadata using temp and humidity", () => {
    const hass = makeHass();
    const info: AreaInfo = {
      area: makeArea("living", "Living"),
      config: makeRoom("living", {
        live: { current_temp: 23.4, current_humidity: 54.2 } as unknown as RoomLiveData,
      }),
      climateEntityCount: 0,
      tempSensorCount: 1,
    };
    expect(formatHiddenRoomMeta(info, hass, "en")).toBe("23.4°C · 54%");
  });

  it("excludes diagnostic, appliance, and outdoor sensors from unconfigured area counts", () => {
    const hass = makeHass({
      areas: {
        can_ting: makeArea("can_ting", "Dining"),
        ke_ting: makeArea("ke_ting", "Living"),
      },
      devices: {
        dev_wh: { id: "dev_wh", area_id: "can_ting", model: "xiaomi.waterheater.ymm5" },
        dev_purifier: {
          id: "dev_purifier",
          area_id: "can_ting",
          name: "小米台式净饮机",
          model: "chunmi.ysj.tsa1",
        },
      },
      entities: {
        "water_heater.wh": {
          entity_id: "water_heater.wh",
          area_id: null,
          device_id: "dev_wh",
          platform: "xiaomi_home",
        },
        "sensor.wh_temp": {
          entity_id: "sensor.wh_temp",
          area_id: null,
          device_id: "dev_wh",
          platform: "xiaomi_home",
        },
        "sensor.purifier_temp": {
          entity_id: "sensor.purifier_temp",
          area_id: null,
          device_id: "dev_purifier",
          platform: "xiaomi_home",
        },
        "sensor.coil_diag": {
          entity_id: "sensor.coil_diag",
          area_id: "ke_ting",
          device_id: null,
          platform: "tcl_udp_ac",
          entity_category: "diagnostic",
        },
        "sensor.room_temp": {
          entity_id: "sensor.room_temp",
          area_id: "ke_ting",
          device_id: null,
          platform: "bthome",
        },
      },
      states: {
        "sensor.wh_temp": {
          state: "45",
          attributes: { device_class: "temperature", friendly_name: "使用记录 温度" },
        },
        "sensor.purifier_temp": {
          state: "27",
          attributes: { device_class: "temperature", friendly_name: "出水温度" },
        },
        "sensor.coil_diag": {
          state: "21",
          attributes: { device_class: "temperature", friendly_name: "室内机盘管温度" },
        },
        "sensor.room_temp": {
          state: "22",
          attributes: { device_class: "temperature", friendly_name: "客厅 温度" },
        },
      },
    });

    const infos = computeAreaInfos(hass, {}, []);
    const byId = Object.fromEntries(infos.map((i) => [i.area.area_id, i]));
    expect(byId.can_ting?.tempSensorCount).toBe(0);
    expect(byId.ke_ting?.tempSensorCount).toBe(1);
  });
});
