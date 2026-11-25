/**
 * Pure 24-hour Schedule + Sleep Phase timeline projection helpers.
 */
import type { ClimateMode, ScheduleBlock, SleepDeviceConfig } from "../types";

export type WeekdayId =
  "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";

export type TimelineSleepPhase = "day" | "pre_warm" | "sleep" | "pre_wake";

export const WEEKDAY_ORDER: readonly WeekdayId[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

export interface AirTargetSegment {
  startMin: number;
  endMin: number;
  targetC: number | null;
  baseTargetC: number | null;
  isEco: boolean;
  sleepPhase: TimelineSleepPhase;
  coupledOffsetApplied: boolean;
}

export interface SleepPhaseSegment {
  startMin: number;
  endMin: number;
  phase: Exclude<TimelineSleepPhase, "day">;
}

export interface DevicePhaseSegment {
  startMin: number;
  endMin: number;
  phase: Exclude<TimelineSleepPhase, "day">;
  gearA: number | null;
  gearB: number | null;
  maxFanLevel: number;
}

export interface TimelineTransition {
  minute: number;
  inMinutes: number;
  targetC: number | null;
  phase: TimelineSleepPhase;
}

export interface TimelineModel {
  weekday: WeekdayId;
  airSegments: AirTargetSegment[];
  sleepSegments: SleepPhaseSegment[];
  deviceSegments: DevicePhaseSegment[];
  minTempC: number;
  maxTempC: number;
  currentSegment: AirTargetSegment | null;
  nextTransition: TimelineTransition | null;
}

export interface BuildTimelineInput {
  weekday: WeekdayId;
  nowMinutes: number | null;
  blocks: ScheduleBlock[];
  climateMode: ClimateMode;
  comfortHeat: number;
  comfortCool: number;
  ecoHeat: number;
  ecoCool: number;
  nightModeEnabled: boolean;
  quietHours: { start: string; end: string } | null;
  prewarmMinutes: number;
  prewakeMinutes: number;
  sleepRampC: number;
  coupledOffsetC: number;
  sleepDevice: SleepDeviceConfig | null;
  maxFanLevelNight: number;
}

export function getLocalWeekday(date = new Date()): WeekdayId {
  // JS getDay(): 0=Sun..6=Sat -> map to monday..sunday
  const jsDay = date.getDay();
  return WEEKDAY_ORDER[jsDay === 0 ? 6 : jsDay - 1]!;
}

export function getMinutesOfDay(date = new Date()): number {
  return date.getHours() * 60 + date.getMinutes();
}

export function parseTimeToMinutes(value: string | undefined | null): number | null {
  if (!value || typeof value !== "string") return null;
  const parts = value.trim().split(":");
  if (parts.length < 2) return null;
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || h > 24 || m < 0 || m > 59) {
    return null;
  }
  if (h === 24 && m > 0) return null;
  return h * 60 + m;
}

export function formatMinutesHhmm(minutes: number): string {
  const normalized = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function addWrappedWindow(
  out: Array<{ startMin: number; endMin: number; phase: Exclude<TimelineSleepPhase, "day"> }>,
  startMin: number,
  endMin: number,
  phase: Exclude<TimelineSleepPhase, "day">,
) {
  const s = ((startMin % 1440) + 1440) % 1440;
  const e = ((endMin % 1440) + 1440) % 1440;
  if (s === e) return;
  if (s < e) {
    out.push({ startMin: s, endMin: e, phase });
  } else {
    out.push({ startMin: s, endMin: 1440, phase });
    out.push({ startMin: 0, endMin: e, phase });
  }
}

function buildSleepWindows(
  nightModeEnabled: boolean,
  quietHours: { start: string; end: string } | null,
  prewarmMinutes: number,
  prewakeMinutes: number,
): SleepPhaseSegment[] {
  if (!nightModeEnabled || !quietHours) return [];
  const qStart = parseTimeToMinutes(quietHours.start);
  const qEnd = parseTimeToMinutes(quietHours.end);
  if (qStart === null || qEnd === null || qStart === qEnd) return [];

  const duration = (qEnd - qStart + 1440) % 1440;
  const prewake = Math.max(0, Math.min(prewakeMinutes, duration));
  const prewarm = Math.max(0, Math.min(prewarmMinutes, 1440 - duration));

  const sleepCoreEnd = (qEnd - prewake + 1440) % 1440;
  const raw: SleepPhaseSegment[] = [];

  if (prewarm > 0) {
    addWrappedWindow(raw, qStart - prewarm, qStart, "pre_warm");
  }
  if (qStart !== sleepCoreEnd) {
    addWrappedWindow(raw, qStart, sleepCoreEnd, "sleep");
  }
  if (prewake > 0) {
    addWrappedWindow(raw, sleepCoreEnd, qEnd, "pre_wake");
  }

  return raw.sort((a, b) => a.startMin - b.startMin);
}

function resolveBlockBaseTarget(
  blocks: ScheduleBlock[],
  midpointMin: number,
  climateMode: ClimateMode,
  comfortHeat: number,
  comfortCool: number,
  ecoHeat: number,
  ecoCool: number,
): { targetC: number | null; isEco: boolean } {
  const isCoolOnly = climateMode === "cool_only";
  const comfort = isCoolOnly ? comfortCool : comfortHeat;
  const eco = isCoolOnly ? ecoCool : ecoHeat;
  if (blocks.length === 0) {
    return { targetC: comfort, isEco: false };
  }

  for (const blk of blocks) {
    const start = parseTimeToMinutes(blk.from);
    const endRaw = parseTimeToMinutes(blk.to);
    const end = endRaw === 0 ? 1440 : endRaw;
    if (start === null || end === null || end <= start) continue;
    if (midpointMin >= start && midpointMin < end) {
      const data = blk.data ?? {};
      if (isCoolOnly && typeof data.cool_temperature === "number") {
        return { targetC: data.cool_temperature, isEco: false };
      }
      if (!isCoolOnly && typeof data.heat_temperature === "number") {
        return { targetC: data.heat_temperature, isEco: false };
      }
      if (typeof data.temperature === "number") {
        return { targetC: data.temperature, isEco: false };
      }
      return { targetC: comfort, isEco: false };
    }
  }
  return { targetC: eco, isEco: true };
}

/**
 * Build aligned 24-hour target, sleep-phase, and bed-device segments for a single day.
 */
export function buildTimelineModel(input: BuildTimelineInput): TimelineModel {
  const sleepSegments = buildSleepWindows(
    input.nightModeEnabled,
    input.quietHours,
    input.prewarmMinutes,
    input.prewakeMinutes,
  );

  const boundaries = new Set<number>([0, 1440]);
  for (const blk of input.blocks) {
    const s = parseTimeToMinutes(blk.from);
    const eRaw = parseTimeToMinutes(blk.to);
    const e = eRaw === 0 ? 1440 : eRaw;
    if (s !== null) boundaries.add(Math.max(0, Math.min(1440, s)));
    if (e !== null) boundaries.add(Math.max(0, Math.min(1440, e)));
  }
  for (const seg of sleepSegments) {
    boundaries.add(seg.startMin);
    boundaries.add(seg.endMin);
  }

  const sorted = [...boundaries].sort((a, b) => a - b);
  const airSegments: AirTargetSegment[] = [];
  const isCoolOnly = input.climateMode === "cool_only";
  const isOff =
    input.climateMode === "off" || input.climateMode === "fan_only" || input.climateMode === "dry";

  for (let i = 0; i < sorted.length - 1; i++) {
    const startMin = sorted[i]!;
    const endMin = sorted[i + 1]!;
    if (endMin <= startMin) continue;
    const mid = (startMin + endMin) / 2;

    const sleepWin = sleepSegments.find((s) => mid >= s.startMin && mid < s.endMin);
    const phase: TimelineSleepPhase = sleepWin?.phase ?? "day";

    const { targetC: baseTargetC, isEco } = isOff
      ? { targetC: null, isEco: false }
      : resolveBlockBaseTarget(
          input.blocks,
          mid,
          input.climateMode,
          input.comfortHeat,
          input.comfortCool,
          input.ecoHeat,
          input.ecoCool,
        );

    let targetC = baseTargetC;
    let coupledOffsetApplied = false;
    if (targetC !== null && phase === "sleep") {
      const coupled = input.sleepDevice && input.coupledOffsetC > 0 ? input.coupledOffsetC : 0;
      const totalRamp = input.sleepRampC + coupled;
      if (totalRamp > 0) {
        targetC = isCoolOnly ? targetC + totalRamp : targetC - totalRamp;
        coupledOffsetApplied = coupled > 0;
      }
    }

    const prev = airSegments[airSegments.length - 1];
    if (
      prev &&
      prev.endMin === startMin &&
      prev.targetC === targetC &&
      prev.isEco === isEco &&
      prev.sleepPhase === phase &&
      prev.coupledOffsetApplied === coupledOffsetApplied
    ) {
      prev.endMin = endMin;
    } else {
      airSegments.push({
        startMin,
        endMin,
        targetC: targetC !== null ? Math.round(targetC * 10) / 10 : null,
        baseTargetC,
        isEco,
        sleepPhase: phase,
        coupledOffsetApplied,
      });
    }
  }

  const temps = airSegments.map((s) => s.targetC).filter((t): t is number => t !== null);
  const minTempC = temps.length > 0 ? Math.min(...temps) : input.ecoHeat;
  const maxTempC = temps.length > 0 ? Math.max(...temps) : input.comfortCool;

  const deviceSegments: DevicePhaseSegment[] = sleepSegments.map((seg) => {
    const gearA =
      input.sleepDevice == null
        ? null
        : seg.phase === "pre_warm"
          ? (input.sleepDevice.prewarm_gear_a ?? 4)
          : seg.phase === "sleep"
            ? (input.sleepDevice.sleep_gear_a ?? 2)
            : 0;
    const gearB =
      input.sleepDevice == null
        ? null
        : seg.phase === "pre_warm"
          ? (input.sleepDevice.prewarm_gear_b ?? 4)
          : seg.phase === "sleep"
            ? (input.sleepDevice.sleep_gear_b ?? 2)
            : 0;
    return {
      startMin: seg.startMin,
      endMin: seg.endMin,
      phase: seg.phase,
      gearA,
      gearB,
      maxFanLevel: input.maxFanLevelNight,
    };
  });

  let currentSegment: AirTargetSegment | null = null;
  let nextTransition: TimelineTransition | null = null;
  if (input.nowMinutes !== null) {
    currentSegment =
      airSegments.find((s) => input.nowMinutes! >= s.startMin && input.nowMinutes! < s.endMin) ??
      null;
    const nextSeg = airSegments.find((s) => s.startMin > input.nowMinutes!);
    if (nextSeg) {
      nextTransition = {
        minute: nextSeg.startMin,
        inMinutes: nextSeg.startMin - input.nowMinutes,
        targetC: nextSeg.targetC,
        phase: nextSeg.sleepPhase,
      };
    }
  }

  return {
    weekday: input.weekday,
    airSegments,
    sleepSegments,
    deviceSegments,
    minTempC,
    maxTempC,
    currentSegment,
    nextTransition,
  };
}
