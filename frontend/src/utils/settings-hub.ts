/**
 * View-model definitions and helpers for the Global Settings Hub.
 */
import type { TranslationKey } from "./localize";

export type SettingsCategoryId = "all" | "automation" | "hardware" | "maintenance";

export type SettingsSectionId =
  | "general"
  | "sensors"
  | "control"
  | "presence"
  | "vacation"
  | "valve"
  | "coil_dry"
  | "compressor"
  | "mold"
  | "notifications"
  | "learning"
  | "reset";

export interface SettingsSectionMeta {
  id: SettingsSectionId;
  category: Exclude<SettingsCategoryId, "all">;
  titleKey: TranslationKey;
  descKey: TranslationKey;
  icon: string;
  isBeta?: boolean;
}

export const SETTINGS_CATEGORIES: Array<{
  id: SettingsCategoryId;
  labelKey: TranslationKey;
}> = [
  { id: "all", labelKey: "settings_hub.cat.all" },
  { id: "automation", labelKey: "settings_hub.cat.automation" },
  { id: "hardware", labelKey: "settings_hub.cat.hardware" },
  { id: "maintenance", labelKey: "settings_hub.cat.maintenance" },
];

export const SETTINGS_SECTIONS: readonly SettingsSectionMeta[] = [
  {
    id: "control",
    category: "automation",
    titleKey: "settings.control_title",
    descKey: "settings.intro.control",
    icon: "mdi:tune-variant",
  },
  {
    id: "presence",
    category: "automation",
    titleKey: "presence.title",
    descKey: "settings.intro.presence",
    icon: "mdi:home-account",
  },
  {
    id: "vacation",
    category: "automation",
    titleKey: "vacation.title",
    descKey: "settings.intro.vacation",
    icon: "mdi:airplane",
  },
  {
    id: "compressor",
    category: "automation",
    titleKey: "compressor.title",
    descKey: "settings.intro.compressor",
    icon: "mdi:heat-pump-outline",
  },
  {
    id: "general",
    category: "hardware",
    titleKey: "settings.general_title",
    descKey: "settings.intro.general",
    icon: "mdi:power",
  },
  {
    id: "sensors",
    category: "hardware",
    titleKey: "settings.sensors_title",
    descKey: "settings.intro.sensors",
    icon: "mdi:thermometer",
  },
  {
    id: "valve",
    category: "hardware",
    titleKey: "valve_protection.title",
    descKey: "settings.intro.valve",
    icon: "mdi:shield-refresh",
  },
  {
    id: "coil_dry",
    category: "hardware",
    titleKey: "coil_dry.title",
    descKey: "settings.intro.coil_dry",
    icon: "mdi:fan-clock",
  },
  {
    id: "mold",
    category: "hardware",
    titleKey: "mold.title",
    descKey: "settings.intro.mold",
    icon: "mdi:water-alert",
  },
  {
    id: "notifications",
    category: "maintenance",
    titleKey: "notifications.title",
    descKey: "settings.intro.notifications",
    icon: "mdi:bell-outline",
    isBeta: true,
  },
  {
    id: "learning",
    category: "maintenance",
    titleKey: "settings.learning_title",
    descKey: "settings.intro.learning",
    icon: "mdi:brain",
  },
  {
    id: "reset",
    category: "maintenance",
    titleKey: "settings.reset_title",
    descKey: "settings.intro.reset",
    icon: "mdi:restart",
  },
];

/**
 * Filter settings hub sections by selected category.
 */
export function filterSettingsSections(category: SettingsCategoryId): SettingsSectionMeta[] {
  if (category === "all") return [...SETTINGS_SECTIONS];
  return SETTINGS_SECTIONS.filter((section) => section.category === category);
}

/**
 * Look up section metadata by id.
 */
export function findSettingsSection(id: SettingsSectionId): SettingsSectionMeta | undefined {
  return SETTINGS_SECTIONS.find((section) => section.id === id);
}

export type HubTone = "accent" | "warning" | "ok" | "neutral";

export interface SettingsSectionStatusInput {
  climateControlActive: boolean;
  controlMode: "mpc" | "bangbang";
  presenceEnabled: boolean;
  presencePersonsCount: number;
  vacationActive: boolean;
  valveProtectionEnabled: boolean;
  coilDryEnabled: boolean;
  outdoorSensorConfigured: boolean;
  weatherEntityConfigured: boolean;
  compressorGroupsCount: number;
  moldDetectionEnabled: boolean;
  moldPreventionEnabled: boolean;
  notificationsEnabled: boolean;
  learningDisabledCount: number;
}

/**
 * Resolve visual tone for a settings section status pill.
 */
export function getSettingsSectionTone(
  id: SettingsSectionId,
  input: SettingsSectionStatusInput,
): HubTone {
  switch (id) {
    case "general":
      return input.climateControlActive ? "ok" : "warning";
    case "sensors":
      return input.outdoorSensorConfigured || input.weatherEntityConfigured ? "ok" : "warning";
    case "control":
      return input.controlMode === "mpc" ? "accent" : "neutral";
    case "presence":
      return input.presenceEnabled
        ? input.presencePersonsCount > 0
          ? "ok"
          : "warning"
        : "neutral";
    case "vacation":
      return input.vacationActive ? "accent" : "neutral";
    case "valve":
      return input.valveProtectionEnabled ? "ok" : "neutral";
    case "coil_dry":
      return input.coilDryEnabled ? "ok" : "neutral";
    case "compressor":
      return input.compressorGroupsCount > 0 ? "accent" : "neutral";
    case "mold":
      return input.moldDetectionEnabled || input.moldPreventionEnabled ? "ok" : "neutral";
    case "notifications":
      return input.notificationsEnabled ? "ok" : "neutral";
    case "learning":
      return input.learningDisabledCount > 0 ? "warning" : "ok";
    case "reset":
      return "neutral";
  }
}
