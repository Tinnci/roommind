import type { GlobalSettings, HomeAssistant, RoomConfig } from "../types";
import { createRoomDetailPreviewModel } from "./room-detail-preview-data";

export interface SettingsPreviewModel {
  hass: HomeAssistant;
  rooms: Record<string, RoomConfig>;
  savedSettings: Partial<GlobalSettings>[];
}

export function createSettingsPreviewModel(): SettingsPreviewModel {
  const roomModel = createRoomDetailPreviewModel();
  const savedSettings: Partial<GlobalSettings>[] = [];
  const settings: GlobalSettings = {
    outdoor_temp_sensor: "sensor.outdoor_temperature",
    outdoor_humidity_sensor: "sensor.outdoor_humidity",
    outdoor_cooling_min: 16,
    outdoor_heating_max: 22,
    control_mode: "mpc",
    optimizer_strategy: "horizon_search",
    comfort_weight: 70,
    weather_entity: "weather.home",
    outdoor_unavailable_notify: true,
    climate_control_active: true,
    learning_disabled_rooms: [],
    hidden_rooms: [],
    prediction_enabled: true,
    vacation_temp: 15,
    vacation_until: null,
    presence_enabled: true,
    presence_persons: ["person.alex", "person.sam"],
    presence_away_action: "eco",
    presence_clears_override: false,
    schedule_off_action: "eco",
    valve_protection_enabled: true,
    valve_protection_interval_days: 7,
    mold_detection_enabled: true,
    mold_humidity_threshold: 70,
    mold_sustained_minutes: 30,
    mold_notification_cooldown: 60,
    mold_notifications_enabled: true,
    mold_notification_targets: [],
    mold_prevention_enabled: true,
    mold_prevention_intensity: "medium",
    mold_prevention_notify_enabled: false,
    compressor_groups: [
      {
        id: "bedroom-heat-pump",
        name: "Bedroom heat pump",
        members: ["climate.bedroom_ac"],
        min_run_minutes: 10,
        min_off_minutes: 10,
        master_entity: "climate.bedroom_ac",
        conflict_resolution: "heating_priority",
        action_script: "",
        enforce_uniform_mode: true,
      },
    ],
    room_order: ["bedroom"],
    group_by_floor: false,
    boost_applied_at: {},
  };

  const hass: HomeAssistant = {
    ...roomModel.hass,
    states: {
      ...roomModel.hass.states,
      "sensor.outdoor_temperature": {
        entity_id: "sensor.outdoor_temperature",
        state: "12.4",
        attributes: { friendly_name: "Outdoor temperature", unit_of_measurement: "C" },
      },
      "sensor.outdoor_humidity": {
        entity_id: "sensor.outdoor_humidity",
        state: "68",
        attributes: { friendly_name: "Outdoor humidity", unit_of_measurement: "%" },
      },
      "weather.home": {
        entity_id: "weather.home",
        state: "cloudy",
        attributes: { friendly_name: "Home weather", temperature: 13.1 },
      },
      "person.alex": {
        entity_id: "person.alex",
        state: "home",
        attributes: { friendly_name: "Alex" },
      },
      "person.sam": {
        entity_id: "person.sam",
        state: "not_home",
        attributes: { friendly_name: "Sam" },
      },
    },
    callWS: async <T>(msg: Record<string, unknown>): Promise<T> => {
      if (msg.type === "roommind/settings/get") {
        return { settings } as T;
      }
      if (msg.type === "roommind/settings/save") {
        savedSettings.push(msg as Partial<GlobalSettings>);
        Object.assign(settings, msg);
        return { settings } as T;
      }
      return { ok: true } as T;
    },
  };

  return {
    hass,
    rooms: { bedroom: roomModel.config },
    savedSettings,
  };
}
