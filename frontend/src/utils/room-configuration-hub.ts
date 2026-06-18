import type { TranslationKey } from "./localize";
import type { ConfigurationRoomSection } from "./room-detail-layout";

export type ConfigurationEditSection = Exclude<ConfigurationRoomSection, "outdoor">;

export interface ConfigurationHubMetrics {
  deviceCount?: number;
  temperatureSensorCount?: number;
  primaryTemperatureSensorName?: string;
  humiditySensorConfigured?: boolean;
  occupancySensorCount?: number;
  windowSensorCount?: number;
  quietHours?: { start: string; end: string } | null;
  nightModeEnabled?: boolean;
  airflowDeviceCount?: number;
  presencePersonCount?: number;
  coverCount?: number;
  heatSourceOrchestration?: boolean;
}

export type ConfigurationHubTone = "complete" | "partial" | "missing" | "inactive";

export interface ConfigurationHubItem {
  section: ConfigurationRoomSection;
  icon: string;
  titleKey: TranslationKey;
  metaKey: TranslationKey;
  metaParams?: Record<string, string>;
  actionKey: TranslationKey;
  actionParams?: Record<string, string>;
  tone: ConfigurationHubTone;
  editable: boolean;
  editSection?: ConfigurationEditSection;
}

export function buildConfigurationHubItems(
  sections: ConfigurationRoomSection[],
  metrics: ConfigurationHubMetrics,
): ConfigurationHubItem[] {
  return sections.map((section) => {
    const item = {
      section,
      icon: configurationIcon(section),
      titleKey: configurationTitleKey(section),
      ...configurationStatus(section, metrics),
      editable: section !== "outdoor",
    };
    return section === "outdoor" ? item : { ...item, editSection: section };
  });
}

function configurationIcon(section: ConfigurationRoomSection) {
  const icons: Record<ConfigurationRoomSection, string> = {
    devices: "mdi:power-plug",
    sensors: "mdi:thermometer",
    comfort: "mdi:weather-night",
    airflow: "mdi:fan",
    presence: "mdi:home-account",
    covers: "mdi:blinds-horizontal",
    heatSource: "mdi:swap-horizontal",
    outdoor: "mdi:tree",
  };
  return icons[section];
}

function configurationTitleKey(section: ConfigurationRoomSection): TranslationKey {
  const keys: Record<ConfigurationRoomSection, TranslationKey> = {
    devices: "room.section.devices",
    sensors: "room.section.sensors",
    comfort: "room.section.comfort",
    airflow: "room.section.airflow",
    presence: "room.section.presence",
    covers: "room.section.covers",
    heatSource: "room.section.heat_source",
    outdoor: "room.outdoor_toggle",
  };
  return keys[section];
}

function configurationStatus(
  section: ConfigurationRoomSection,
  metrics: ConfigurationHubMetrics,
): Pick<ConfigurationHubItem, "metaKey" | "metaParams" | "actionKey" | "actionParams" | "tone"> {
  switch (section) {
    case "devices": {
      const count = metrics.deviceCount ?? 0;
      return {
        metaKey: "room.config.devices_summary",
        metaParams: { count: String(count) },
        actionKey:
          count > 0 ? "room.config.action_review_devices" : "room.config.action_add_device",
        tone: count > 0 ? "complete" : "missing",
      };
    }
    case "sensors": {
      const temp = metrics.temperatureSensorCount ?? 0;
      const humidity = metrics.humiditySensorConfigured ? 1 : 0;
      const windows = metrics.windowSensorCount ?? 0;
      const occupancy = metrics.occupancySensorCount ?? 0;
      const complete = temp > 0 && humidity > 0;
      const partial = temp > 0 || humidity > 0 || windows > 0 || occupancy > 0;
      return {
        metaKey: metrics.primaryTemperatureSensorName
          ? "room.config.sensors_summary_primary"
          : "room.config.sensors_summary",
        metaParams: {
          temp: String(temp),
          humidity: String(humidity),
          occupancy: String(occupancy),
          windows: String(windows),
          primary: metrics.primaryTemperatureSensorName ?? "",
        },
        actionKey:
          temp === 0
            ? "room.config.action_add_primary_sensor"
            : humidity === 0
              ? "room.config.action_add_humidity_sensor"
              : "room.config.action_review_sensor_fusion",
        tone: complete ? "complete" : partial ? "partial" : "missing",
      };
    }
    case "comfort":
      return metrics.quietHours || metrics.nightModeEnabled
        ? {
            metaKey: "room.config.comfort_summary",
            metaParams: {
              hours: metrics.quietHours
                ? `${metrics.quietHours.start}-${metrics.quietHours.end}`
                : "--",
            },
            actionKey: "room.config.action_review_night",
            tone: metrics.quietHours ? "complete" : "partial",
          }
        : {
            metaKey: "room.config.not_configured",
            actionKey: "room.config.action_configure_night",
            tone: "missing",
          };
    case "airflow": {
      const count = metrics.airflowDeviceCount ?? 0;
      return {
        metaKey: "room.config.airflow_summary",
        metaParams: { count: String(count) },
        actionKey: count > 0 ? "room.config.action_review_airflow" : "room.config.action_optional",
        tone: count > 0 ? "complete" : "inactive",
      };
    }
    case "presence":
      return {
        metaKey: "room.config.presence_summary",
        metaParams: { count: String(metrics.presencePersonCount ?? 0) },
        actionKey:
          (metrics.presencePersonCount ?? 0) > 0
            ? "room.config.action_review_presence"
            : "room.config.action_optional",
        tone: (metrics.presencePersonCount ?? 0) > 0 ? "complete" : "inactive",
      };
    case "covers": {
      const count = metrics.coverCount ?? 0;
      return {
        metaKey: "room.config.covers_summary",
        metaParams: { count: String(count) },
        actionKey: count > 0 ? "room.config.action_review_covers" : "room.config.action_optional",
        tone: count > 0 ? "complete" : "inactive",
      };
    }
    case "heatSource":
      return {
        metaKey: metrics.heatSourceOrchestration ? "comfort.active" : "comfort.inactive",
        actionKey: metrics.heatSourceOrchestration
          ? "room.config.action_review_heat_source"
          : "room.config.action_optional",
        tone: metrics.heatSourceOrchestration ? "complete" : "inactive",
      };
    case "outdoor":
      return {
        metaKey: "room.outdoor_hint",
        actionKey: "room.config.action_toggle_outdoor",
        tone: "inactive",
      };
  }
}
