import "../main";
import { registerHaPreviewStubs } from "./ha-element-stubs";
import type {
  AnalyticsData,
  HassArea,
  HassDeviceRegistryEntry,
  HassEntity,
  HassEntityRegistryEntry,
  HomeAssistant,
  RoomConfig,
  RoomLiveData,
  RoomMode,
} from "../types";

registerHaPreviewStubs();

function state(entityId: string, value: string, friendlyName: string, attributes = {}): HassEntity {
  return {
    entity_id: entityId,
    state: value,
    attributes: {
      friendly_name: friendlyName,
      ...attributes,
    },
  };
}

function area(areaId: string, name: string, floorId: string | null): HassArea {
  return {
    area_id: areaId,
    name,
    picture: null,
    floor_id: floorId,
  };
}

function entity(entityId: string, areaId: string): HassEntityRegistryEntry {
  return {
    entity_id: entityId,
    area_id: areaId,
    device_id: entityId.replace(".", "_"),
    platform: "preview",
  };
}

function baseLive(overrides: Partial<RoomLiveData> = {}): RoomLiveData {
  return {
    current_temp: 21,
    current_humidity: 48,
    target_temp: 21,
    heat_target: 21,
    cool_target: 25,
    mode: "idle",
    heating_power: 0,
    device_setpoint: 21,
    override_active: false,
    override_type: null,
    override_temp: null,
    override_until: null,
    override_suppressed: false,
    active_schedule_index: 0,
    window_open: false,
    confidence: 0.82,
    mpc_active: true,
    presence_away: false,
    mold_risk_level: "ok",
    mold_surface_rh: 58,
    mold_prevention_active: false,
    mold_prevention_delta: 0,
    blind_position: null,
    cover_auto_paused: false,
    cover_forced_reason: "",
    active_cover_schedule_index: 0,
    active_heat_sources: null,
    learning_paused_reason: null,
    ...overrides,
  };
}

function room(
  areaId: string,
  displayName: string,
  mode: RoomMode,
  liveOverrides: Partial<RoomLiveData>,
): RoomConfig {
  return {
    area_id: areaId,
    display_name: displayName,
    thermostats: [],
    acs: [],
    devices: [
      {
        entity_id: `climate.${areaId}`,
        type: mode === "cooling" ? "ac" : "trv",
        role: "primary",
      },
    ],
    temperature_sensor: `sensor.${areaId}_temperature`,
    temperature_sensors: [`sensor.${areaId}_temperature`],
    humidity_sensor: `sensor.${areaId}_humidity`,
    window_sensors: [`binary_sensor.${areaId}_window`],
    window_open_delay: 30,
    window_close_delay: 90,
    climate_mode: "auto",
    schedules: [],
    schedule_selector_entity: "",
    comfort_heat: 21,
    comfort_cool: 25,
    eco_heat: 17,
    eco_cool: 28,
    climate_control_enabled: true,
    live: baseLive({
      mode,
      ...liveOverrides,
    }),
  };
}

function analyticsData(): AnalyticsData {
  const now = Date.now();
  const hour = 60 * 60 * 1000;
  const points = Array.from({ length: 24 }, (_, index) => {
    const ts = Math.round((now - (23 - index) * hour) / 1000);
    const heating = index > 4 && index < 9;
    const cooling = index > 16 && index < 20;
    return {
      ts,
      room_temp: 20.2 + Math.sin(index / 3) * 0.7 + (heating ? 0.3 : 0),
      outdoor_temp: 9 + Math.sin(index / 4) * 3,
      target_temp: 21,
      mode: heating ? "heating" : cooling ? "cooling" : "idle",
      predicted_temp: 20.1 + Math.sin(index / 3) * 0.65,
      window_open: index === 13,
      heating_power: heating ? 42 : cooling ? 30 : 0,
      solar_irradiance: Math.max(0, Math.sin((index - 6) / 8) * 420),
      blind_position: index > 11 && index < 17 ? 35 : null,
      cover_reason: index > 11 && index < 17 ? "solar" : "",
      device_setpoint: heating ? 22.5 : 21,
    };
  });
  const forecast = Array.from({ length: 6 }, (_, index) => {
    const ts = Math.round((now + (index + 1) * hour) / 1000);
    return {
      ts,
      room_temp: null,
      outdoor_temp: 11 + index * 0.4,
      target_temp: 21,
      mode: "idle",
      predicted_temp: 20.8 + index * 0.08,
      window_open: false,
      heating_power: 0,
      solar_irradiance: 0,
      blind_position: null,
      cover_reason: "",
      device_setpoint: 21,
    };
  });

  return {
    history: points.slice(0, 12),
    detail: points.slice(12),
    forecast,
    model: {
      confidence: 0.84,
      model: {
        C: 2.8,
        U: 0.11,
        Q_heat: 1.4,
        Q_cool: -1.1,
        Q_solar: 0.3,
        Q_occupancy: 0.2,
      },
      n_samples: 780,
      n_observations: 720,
      n_heating: 86,
      n_cooling: 42,
      applicable_modes: ["heating", "cooling"],
      mpc_active: true,
      sigma_e: 0.18,
      prediction_std_idle: 0.22,
      prediction_std_heating: 0.38,
      has_occupancy_sensors: true,
    },
  };
}

const areas = [
  area("living_room", "Living room", "ground"),
  area("bedroom", "Bedroom", "upper"),
  area("office", "Office", "ground"),
  area("bathroom", "Bathroom", "upper"),
  area("balcony", "Balcony", null),
  area("guest_room", "Guest room", "upper"),
];

const rooms: Record<string, RoomConfig> = {
  living_room: room("living_room", "Living room", "heating", {
    current_temp: 20.2,
    target_temp: 21,
    heat_target: 21,
    heating_power: 46,
    current_humidity: 43,
    active_heat_sources: "radiator",
  }),
  bedroom: room("bedroom", "Bedroom", "idle", {
    current_temp: 20.9,
    target_temp: 21,
    current_humidity: 50,
    override_active: true,
    override_type: "custom",
    override_temp: 21,
    override_until: Date.now() / 1000 + 3600,
  }),
  office: room("office", "Office", "cooling", {
    current_temp: 25.9,
    target_temp: 24,
    cool_target: 24,
    heating_power: 38,
    current_humidity: 56,
    mpc_active: false,
  }),
  bathroom: room("bathroom", "Bathroom", "idle", {
    current_temp: 18.7,
    target_temp: 21,
    current_humidity: 72,
    mold_risk_level: "warning",
    mold_surface_rh: 83,
    mold_prevention_active: true,
    mold_prevention_delta: 0.8,
  }),
  balcony: {
    ...room("balcony", "Balcony", "idle", {
      current_temp: 8.4,
      target_temp: null,
      heat_target: null,
      cool_target: null,
      current_humidity: 64,
    }),
    devices: [],
    is_outdoor: true,
  },
};

const entityIds = areas.flatMap((item) => [
  `climate.${item.area_id}`,
  `sensor.${item.area_id}_temperature`,
  `sensor.${item.area_id}_humidity`,
  `binary_sensor.${item.area_id}_window`,
]);

const hass: HomeAssistant = {
  language: "en",
  config: { unit_system: { temperature: "C" } },
  areas: Object.fromEntries(areas.map((item) => [item.area_id, item])),
  floors: {
    ground: { floor_id: "ground", name: "Ground floor", level: 0 },
    upper: { floor_id: "upper", name: "Upper floor", level: 1 },
  },
  devices: Object.fromEntries(
    entityIds.map((entityId) => [
      entityId.replace(".", "_"),
      { id: entityId.replace(".", "_"), area_id: entityId.split(".")[1]?.replace(/_.+$/, "") },
    ]),
  ) as Record<string, HassDeviceRegistryEntry>,
  entities: Object.fromEntries(
    entityIds.map((entityId) => {
      const areaId = entityId.split(".")[1]?.replace(/_(temperature|humidity|window)$/, "") ?? "";
      return [entityId, entity(entityId, areaId)];
    }),
  ) as Record<string, HassEntityRegistryEntry>,
  states: Object.fromEntries(
    entityIds.map((entityId) => {
      const areaId = entityId.split(".")[1]?.replace(/_(temperature|humidity|window)$/, "") ?? "";
      const config = rooms[areaId];
      const live = config?.live;
      if (entityId.startsWith("sensor.") && entityId.endsWith("_humidity")) {
        return [entityId, state(entityId, String(live?.current_humidity ?? 45), entityId)];
      }
      if (entityId.startsWith("sensor.")) {
        return [entityId, state(entityId, String(live?.current_temp ?? 20), entityId)];
      }
      if (entityId.startsWith("binary_sensor.")) {
        return [entityId, state(entityId, live?.window_open ? "on" : "off", entityId)];
      }
      return [
        entityId,
        state(
          entityId,
          live?.mode === "cooling" ? "cool" : live?.mode === "heating" ? "heat" : "off",
          entityId,
        ),
      ];
    }),
  ),
  callWS: async <T>(msg: Record<string, unknown>): Promise<T> => {
    if (msg.type === "roommind/analytics/get") {
      return analyticsData() as T;
    }
    return {
      rooms,
      vacation_active: false,
      vacation_temp: null,
      vacation_until: null,
      hidden_rooms: [],
      room_order: ["living_room", "bedroom", "office", "bathroom", "balcony", "guest_room"],
      group_by_floor: false,
      control_mode: "mpc",
      climate_control_active: true,
      presence_enabled: true,
      anyone_home: true,
      presence_persons: ["person.alex"],
      presence_away_action: "eco",
      schedule_off_action: "eco",
      valve_protection_enabled: true,
    } as T;
  },
  callService: async () => undefined,
  connection: {
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  },
};

const root = document.querySelector<HTMLDivElement>("#app");

if (!root) {
  throw new Error("Missing #app root");
}

const panel = document.createElement("roommind-panel");
panel.hass = hass;
panel.narrow = false;
panel.route = { path: "" };
panel.panel = {};

root.appendChild(panel);
