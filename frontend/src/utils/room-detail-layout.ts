import type { DeviceConfig } from "../types";

export type PrimaryRoomSection = "climateControl" | "climateMode" | "schedule";

export type ConfigurationRoomSection =
  | "devices"
  | "sensors"
  | "comfort"
  | "airflow"
  | "presence"
  | "covers"
  | "heatSource"
  | "outdoor";

export interface RoomDetailLayoutInput {
  isOutdoor: boolean;
  presenceAvailable: boolean;
  hasTemperatureSensor: boolean;
  devices: DeviceConfig[];
}

export interface RoomDetailLayout {
  primarySections: PrimaryRoomSection[];
  configurationSections: ConfigurationRoomSection[];
}

export function getRoomDetailLayout(input: RoomDetailLayoutInput): RoomDetailLayout {
  if (input.isOutdoor) {
    return {
      primarySections: [],
      configurationSections: ["outdoor"],
    };
  }

  const configurationSections: ConfigurationRoomSection[] = [
    "devices",
    "sensors",
    "comfort",
    "airflow",
  ];

  if (input.presenceAvailable) {
    configurationSections.push("presence");
  }

  configurationSections.push("covers");

  const hasTrv = input.devices.some((device) => device.type === "trv");
  const hasAc = input.devices.some((device) => device.type === "ac");
  if (input.hasTemperatureSensor && hasTrv && hasAc) {
    configurationSections.push("heatSource");
  }

  configurationSections.push("outdoor");

  return {
    primarySections: ["climateControl", "climateMode", "schedule"],
    configurationSections,
  };
}
