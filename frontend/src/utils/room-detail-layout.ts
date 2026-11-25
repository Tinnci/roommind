import type { DeviceConfig } from "../types";

export type PrimaryRoomSection = never;

export type ConfigurationRoomSection =
  | "targets"
  | "devices"
  | "sensors"
  | "comfort"
  | "airflow"
  | "presence"
  | "schedule"
  | "covers"
  | "heatSource"
  | "outdoor";

export interface RoomDetailLayoutInput {
  isOutdoor: boolean;
  presenceAvailable: boolean;
  hasTemperatureSensor: boolean;
  devices: DeviceConfig[];
  hasAirflowDevices?: boolean;
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

  if (input.devices.length === 0) {
    const configurationSections: ConfigurationRoomSection[] = ["sensors"];
    if (input.hasAirflowDevices) {
      configurationSections.push("airflow");
    }
    configurationSections.push("covers", "devices", "outdoor");
    return {
      primarySections: [],
      configurationSections,
    };
  }

  const configurationSections: ConfigurationRoomSection[] = [
    "targets",
    "devices",
    "sensors",
    "comfort",
    "airflow",
  ];

  if (input.presenceAvailable) {
    configurationSections.push("presence");
  }

  configurationSections.push("schedule", "covers");

  const hasTrv = input.devices.some((device) => device.type === "trv");
  const hasAc = input.devices.some((device) => device.type === "ac");
  if (input.hasTemperatureSensor && hasTrv && hasAc) {
    configurationSections.push("heatSource");
  }

  configurationSections.push("outdoor");

  return {
    primarySections: [],
    configurationSections,
  };
}
