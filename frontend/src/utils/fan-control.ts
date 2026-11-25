import type { HassEntity, HomeAssistant, RoomConfig } from "../types";
import { localize, type TranslationKey } from "./localize";

export type FanSpeedTone = "auto" | "calm" | "medium" | "strong";

export interface FanSpeedOption {
  value: string;
  label: string;
  isAuto: boolean;
  bars: 0 | 1 | 2 | 3 | 4 | 5;
  tone: FanSpeedTone;
}

export interface UnitFanControlModel {
  entityId: string;
  name: string;
  domain: "climate" | "fan";
  available: boolean;
  isOn: boolean;
  hvacMode: string | null;
  fanMode: string | null;
  fanModes: string[];
  percentage: number | null;
  percentageStep: number;
  presetMode: string | null;
  presetModes: string[];
  swingMode: string | null;
  swingModes: string[];
  swingHorizontalMode: string | null;
  swingHorizontalModes: string[];
  oscillating: boolean | null;
  direction: string | null;
  supportsSetSpeed: boolean;
  supportsOscillate: boolean;
  supportsDirection: boolean;
  hasAnyControl: boolean;
}

export interface RoomFanCapabilities {
  hasFanControl: boolean;
  roomOptions: FanSpeedOption[];
  units: UnitFanControlModel[];
  standaloneFans: UnitFanControlModel[];
}

const FAN_FEATURE_SET_SPEED = 1;
const FAN_FEATURE_OSCILLATE = 2;
const FAN_FEATURE_DIRECTION = 4;

const CANONICAL_TIERS = ["auto", "quiet", "low", "medium", "high", "turbo"] as const;
const OFF_MODES = new Set(["off", "none", "stop", "stopped"]);

const FAN_LABEL_KEYS: Record<string, TranslationKey> = {
  auto: "fan.auto",
  quiet: "fan.quiet",
  low: "fan.low",
  medium: "fan.medium",
  high: "fan.high",
  turbo: "fan.turbo",
  off: "fan.off",
};

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
}

function hasFeatureBit(supportedFeatures: unknown, bit: number): boolean | null {
  if (typeof supportedFeatures !== "number" || !Number.isFinite(supportedFeatures)) {
    return null;
  }
  return (supportedFeatures & bit) !== 0;
}

export function fanSpeedBars(
  modeOrPct: string | number | null | undefined,
  allModes?: string[],
): 0 | 1 | 2 | 3 | 4 | 5 {
  if (modeOrPct == null) return 0;
  if (typeof modeOrPct === "number") {
    if (modeOrPct <= 0) return 0;
    if (modeOrPct <= 25) return 1;
    if (modeOrPct <= 45) return 2;
    if (modeOrPct <= 70) return 3;
    if (modeOrPct <= 90) return 4;
    return 5;
  }
  const text = modeOrPct.trim().toLowerCase();
  if (!text || OFF_MODES.has(text)) return 0;
  if (text === "auto") return 2;
  if (text.startsWith("pct:")) {
    const num = Number(text.slice(4));
    return Number.isFinite(num) ? fanSpeedBars(num) : 3;
  }
  if (["quiet", "silent", "sleep", "diffuse", "eco", "min", "minimum"].includes(text)) return 1;
  if (["low", "1"].includes(text)) return 2;
  if (["medium", "mid", "middle", "normal", "standard", "2", "3"].includes(text)) return 3;
  if (["high", "strong", "4"].includes(text)) return 4;
  if (["turbo", "boost", "max", "maximum", "full", "5"].includes(text)) return 5;
  if (allModes && allModes.length > 0) {
    const active = allModes.filter(
      (m) => !OFF_MODES.has(m.toLowerCase()) && m.toLowerCase() !== "auto",
    );
    const idx = active.findIndex((m) => m.toLowerCase() === text);
    if (idx >= 0 && active.length > 0) {
      const scaled = Math.round(((idx + 1) / active.length) * 5);
      return Math.max(1, Math.min(5, scaled)) as 1 | 2 | 3 | 4 | 5;
    }
  }
  return 3;
}

export function fanSpeedTone(modeOrPct: string | number | null | undefined): FanSpeedTone {
  if (typeof modeOrPct === "number") {
    if (modeOrPct <= 40) return "calm";
    if (modeOrPct <= 70) return "medium";
    return "strong";
  }
  const text = (modeOrPct ?? "").trim().toLowerCase();
  if (!text || text === "auto") return "auto";
  if (["quiet", "silent", "sleep", "low", "diffuse", "eco", "min", "minimum", "1"].includes(text)) {
    return "calm";
  }
  if (["high", "turbo", "boost", "max", "maximum", "full", "strong", "4", "5"].includes(text)) {
    return "strong";
  }
  return "medium";
}

export function formatFanModeLabel(mode: string, language = "en"): string {
  const key = mode.trim().toLowerCase();
  if (FAN_LABEL_KEYS[key]) {
    return localize(FAN_LABEL_KEYS[key], language);
  }
  return mode.replaceAll("_", " ").replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function buildUnitModel(entityId: string, haState: HassEntity | undefined): UnitFanControlModel {
  const domain: "climate" | "fan" = entityId.startsWith("fan.") ? "fan" : "climate";
  const attrs = haState?.attributes ?? {};
  const available = haState ? !["unavailable", "unknown"].includes(haState.state) : false;
  const hvacMode = haState?.state ?? null;
  const isOn = available && hvacMode !== null && hvacMode !== "off";

  const fanModes = stringArray(attrs.fan_modes);
  const presetModes = stringArray(attrs.preset_modes);
  const swingModes = stringArray(attrs.swing_modes);
  const swingHorizontalModes = stringArray(attrs.swing_horizontal_modes);
  const fanMode = typeof attrs.fan_mode === "string" ? attrs.fan_mode : null;
  const presetMode = typeof attrs.preset_mode === "string" ? attrs.preset_mode : null;
  const swingMode = typeof attrs.swing_mode === "string" ? attrs.swing_mode : null;
  const swingHorizontalMode =
    typeof attrs.swing_horizontal_mode === "string" ? attrs.swing_horizontal_mode : null;
  const percentage = typeof attrs.percentage === "number" ? attrs.percentage : null;
  const percentageStep =
    typeof attrs.percentage_step === "number" && attrs.percentage_step > 0
      ? attrs.percentage_step
      : 1;
  const oscillating = typeof attrs.oscillating === "boolean" ? attrs.oscillating : null;
  const direction = typeof attrs.direction === "string" ? attrs.direction : null;

  const speedFeature = hasFeatureBit(attrs.supported_features, FAN_FEATURE_SET_SPEED);
  const oscFeature = hasFeatureBit(attrs.supported_features, FAN_FEATURE_OSCILLATE);
  const dirFeature = hasFeatureBit(attrs.supported_features, FAN_FEATURE_DIRECTION);

  const supportsSetSpeed =
    domain === "fan" && (speedFeature === true || (speedFeature === null && percentage !== null));
  const supportsOscillate =
    domain === "fan" && (oscFeature === true || (oscFeature === null && oscillating !== null));
  const supportsDirection =
    domain === "fan" && (dirFeature === true || (dirFeature === null && direction !== null));

  const hasAnyControl =
    domain === "fan" ||
    fanModes.length > 0 ||
    swingModes.length > 0 ||
    swingHorizontalModes.length > 0 ||
    presetModes.length > 0;

  return {
    entityId,
    name: String(attrs.friendly_name || entityId),
    domain,
    available,
    isOn,
    hvacMode,
    fanMode,
    fanModes,
    percentage,
    percentageStep,
    presetMode,
    presetModes,
    swingMode,
    swingModes,
    swingHorizontalMode,
    swingHorizontalModes,
    oscillating,
    direction,
    supportsSetSpeed,
    supportsOscillate,
    supportsDirection,
    hasAnyControl,
  };
}

function collectRoomEntityIds(config: RoomConfig): string[] {
  const seen = new Set<string>();
  const add = (id: string | undefined) => {
    if (id && !seen.has(id)) seen.add(id);
  };
  for (const d of config.devices ?? []) add(d.entity_id);
  for (const id of config.acs ?? []) add(id);
  for (const id of config.thermostats ?? []) add(id);
  for (const af of config.airflow_devices ?? []) add(af.entity_id);
  return [...seen];
}

export function buildRoomFanCapabilities(
  config: RoomConfig | null | undefined,
  hass: HomeAssistant | undefined,
): RoomFanCapabilities {
  if (!config) {
    return { hasFanControl: false, roomOptions: [], units: [], standaloneFans: [] };
  }
  const language = hass?.language ?? "en";
  const units = collectRoomEntityIds(config)
    .map((id) => buildUnitModel(id, hass?.states?.[id]))
    .filter((u) => u.hasAnyControl);

  const standaloneFans = units.filter((u) => u.domain === "fan");
  const climateFanUnits = units.filter((u) => u.domain === "climate" && u.fanModes.length > 0);
  const hasFanControl = climateFanUnits.length > 0 || standaloneFans.length > 0;

  if (!hasFanControl) {
    return { hasFanControl: false, roomOptions: [], units, standaloneFans };
  }

  let roomOptions: FanSpeedOption[];
  const [singleClimateUnit] = climateFanUnits;
  if (singleClimateUnit && climateFanUnits.length === 1 && standaloneFans.length === 0) {
    const unitModes = singleClimateUnit.fanModes.filter((m) => !OFF_MODES.has(m.toLowerCase()));
    const nativeAuto = unitModes.find((m) => m.toLowerCase() === "auto");
    const nonAuto = unitModes.filter((m) => m.toLowerCase() !== "auto");
    roomOptions = [
      {
        value: nativeAuto ?? "auto",
        label: formatFanModeLabel("auto", language),
        isAuto: true,
        bars: 2,
        tone: "auto",
      },
      ...nonAuto.map((mode) => ({
        value: mode,
        label: formatFanModeLabel(mode, language),
        isAuto: false,
        bars: fanSpeedBars(mode, unitModes),
        tone: fanSpeedTone(mode),
      })),
    ];
  } else {
    roomOptions = CANONICAL_TIERS.map((tier) => ({
      value: tier,
      label: formatFanModeLabel(tier, language),
      isAuto: tier === "auto",
      bars: fanSpeedBars(tier),
      tone: fanSpeedTone(tier),
    }));
  }

  return {
    hasFanControl,
    roomOptions,
    units,
    standaloneFans,
  };
}
