import type { TranslationKey } from "./localize";
import type { ConfigurationRoomSection } from "./room-detail-layout";

export type ConfigurationEditSection = Exclude<ConfigurationRoomSection, "outdoor">;

export interface ConfigurationHubMetrics {
  deviceCount?: number;
  temperatureSensorCount?: number;
  humiditySensorConfigured?: boolean;
  windowSensorCount?: number;
  quietHours?: { start: string; end: string } | null;
  airflowDeviceCount?: number;
  presencePersonCount?: number;
  coverCount?: number;
  heatSourceOrchestration?: boolean;
}

export interface ConfigurationHubItem {
  section: ConfigurationRoomSection;
  icon: string;
  titleKey: TranslationKey;
  metaKey: TranslationKey;
  metaParams?: Record<string, string>;
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
      ...configurationMeta(section, metrics),
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

function configurationMeta(
  section: ConfigurationRoomSection,
  metrics: ConfigurationHubMetrics,
): Pick<ConfigurationHubItem, "metaKey" | "metaParams"> {
  switch (section) {
    case "devices":
      return {
        metaKey: "room.config.devices_summary",
        metaParams: { count: String(metrics.deviceCount ?? 0) },
      };
    case "sensors":
      return {
        metaKey: "room.config.sensors_summary",
        metaParams: {
          temp: String(metrics.temperatureSensorCount ?? 0),
          humidity: metrics.humiditySensorConfigured ? "1" : "0",
          windows: String(metrics.windowSensorCount ?? 0),
        },
      };
    case "comfort":
      return metrics.quietHours
        ? {
            metaKey: "room.config.comfort_summary",
            metaParams: { hours: `${metrics.quietHours.start}-${metrics.quietHours.end}` },
          }
        : { metaKey: "room.config.not_configured" };
    case "airflow":
      return {
        metaKey: "room.config.airflow_summary",
        metaParams: { count: String(metrics.airflowDeviceCount ?? 0) },
      };
    case "presence":
      return {
        metaKey: "room.config.presence_summary",
        metaParams: { count: String(metrics.presencePersonCount ?? 0) },
      };
    case "covers":
      return {
        metaKey: "room.config.covers_summary",
        metaParams: { count: String(metrics.coverCount ?? 0) },
      };
    case "heatSource":
      return { metaKey: metrics.heatSourceOrchestration ? "comfort.active" : "comfort.inactive" };
    case "outdoor":
      return { metaKey: "room.outdoor_hint" };
  }
}
