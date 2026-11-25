/**
 * Week model of a Home Assistant schedule helper for the built-in schedule editor.
 */

export const WEEKDAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

export type Weekday = (typeof WEEKDAYS)[number];

export const DAY_MINUTES = 1440;
export const SNAP_MINUTES = 15;
export const MIN_BLOCK_MINUTES = SNAP_MINUTES;

export type BlockData = Record<string, string | number | boolean>;

export interface ScheduleBlock {
  start: number;
  end: number;
  data?: BlockData;
}

export type Week = ScheduleBlock[][];

export interface HaTimeRange {
  from: string;
  to: string;
  data?: BlockData;
}

export type HaWeek = Record<Weekday, HaTimeRange[]>;

export const TEMP_KEYS = ["temperature", "heat_temperature", "cool_temperature"] as const;

export function emptyWeek(): Week {
  return WEEKDAYS.map(() => []);
}

export function parseTime(value: string): number {
  const [h = "0", m = "0", s = "0"] = String(value).split(":");
  const seconds = Number(h) * 3600 + Number(m) * 60 + Number(s);
  if (!Number.isFinite(seconds)) return 0;
  if (seconds >= DAY_MINUTES * 60 - 1) return DAY_MINUTES;
  return Math.max(0, Math.min(DAY_MINUTES, Math.round(seconds / 60)));
}

export function formatTime(minutes: number): string {
  return `${hm(minutes)}:00`;
}

export function hm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function dayTimes(day: ScheduleBlock[]): string {
  return day.map((b) => `${hm(b.start)}–${hm(b.end)}`).join(", ");
}

function sortDay(day: ScheduleBlock[]): ScheduleBlock[] {
  return [...day].sort((a, b) => a.start - b.start);
}

export function parseWeek(source: Partial<Record<string, unknown>>): Week {
  return WEEKDAYS.map((name) => {
    const raw = source[name];
    if (!Array.isArray(raw)) return [];
    return sortDay(
      raw
        .filter((r): r is HaTimeRange => !!r && typeof r === "object" && "from" in r && "to" in r)
        .map((r) => {
          const block: ScheduleBlock = { start: parseTime(r.from), end: parseTime(r.to) };
          if (r.data && typeof r.data === "object" && Object.keys(r.data).length > 0) {
            block.data = { ...r.data };
          }
          return block;
        }),
    );
  });
}

export function serializeWeek(week: Week): HaWeek {
  const out = {} as HaWeek;
  WEEKDAYS.forEach((name, d) => {
    out[name] = sortDay(week[d] ?? []).map((b) => {
      const range: HaTimeRange = { from: formatTime(b.start), to: formatTime(b.end) };
      if (b.data && Object.keys(b.data).length > 0) range.data = { ...b.data };
      return range;
    });
  });
  return out;
}

export function dayIsValid(day: ScheduleBlock[]): boolean {
  const sorted = sortDay(day);
  for (let i = 0; i < sorted.length; i++) {
    const b = sorted[i];
    if (!b || b.start < 0 || b.end > DAY_MINUTES || b.start >= b.end) return false;
    if (i > 0 && (sorted[i - 1]?.end ?? 0) > b.start) return false;
  }
  return true;
}

export function weekIsValid(week: Week): boolean {
  return week.length === 7 && week.every(dayIsValid);
}

export function weeksEqual(a: Week, b: Week): boolean {
  return JSON.stringify(serializeWeek(a)) === JSON.stringify(serializeWeek(b));
}

export function snap(minutes: number, step = SNAP_MINUTES): number {
  return Math.max(0, Math.min(DAY_MINUTES, Math.round(minutes / step) * step));
}

export function neighbourLimits(day: ScheduleBlock[], index: number): { min: number; max: number } {
  return {
    min: index > 0 ? (day[index - 1]?.end ?? 0) : 0,
    max: index < day.length - 1 ? (day[index + 1]?.start ?? DAY_MINUTES) : DAY_MINUTES,
  };
}

export function gapAt(day: ScheduleBlock[], minute: number): { min: number; max: number } | null {
  let min = 0;
  for (const b of sortDay(day)) {
    if (minute >= b.start && minute < b.end) return null;
    if (b.end <= minute) min = b.end;
    else return { min, max: b.start };
  }
  return { min, max: DAY_MINUTES };
}

function replaceBlock(week: Week, dayIndex: number, index: number, block: ScheduleBlock): Week {
  return week.map((day, d) =>
    d === dayIndex ? sortDay(day.map((b, i) => (i === index ? block : b))) : day,
  );
}

export function setBlockTimes(
  week: Week,
  dayIndex: number,
  index: number,
  start: number,
  end: number,
): Week | null {
  const day = week[dayIndex];
  const block = day?.[index];
  if (!day || !block || start >= end || start < 0 || end > DAY_MINUTES) return null;
  const others = day.filter((_, i) => i !== index);
  if (others.some((b) => b.start < end && start < b.end)) return null;
  return replaceBlock(week, dayIndex, index, { ...block, start, end });
}

export function createBlock(
  week: Week,
  dayIndex: number,
  a: number,
  b: number,
  data?: BlockData,
): { week: Week; index: number } | null {
  const day = week[dayIndex];
  if (!day) return null;
  const gap = gapAt(day, Math.min(Math.max(a, 0), DAY_MINUTES - 1));
  if (!gap || gap.max - gap.min < MIN_BLOCK_MINUTES) return null;
  let start = Math.max(gap.min, Math.min(a, b));
  let end = Math.min(gap.max, Math.max(a, b));
  if (end - start < MIN_BLOCK_MINUTES) {
    if (start + MIN_BLOCK_MINUTES <= gap.max) {
      end = start + MIN_BLOCK_MINUTES;
    } else {
      end = gap.max;
      start = end - MIN_BLOCK_MINUTES;
    }
  }
  const block: ScheduleBlock = { start, end };
  if (data && Object.keys(data).length > 0) block.data = { ...data };
  const next = sortDay([...day, block]);
  return {
    week: week.map((d, i) => (i === dayIndex ? next : d)),
    index: next.indexOf(block),
  };
}

export function suggestBlock(day: ScheduleBlock[]): { start: number; end: number } | null {
  const sorted = sortDay(day);
  if (sorted.length === 0) return { start: 8 * 60, end: 10 * 60 };
  const last = sorted[sorted.length - 1]!;
  if (DAY_MINUTES - last.end >= 120) return { start: last.end, end: last.end + 120 };
  let best: { start: number; end: number } | null = null;
  let prevEnd = 0;
  for (const b of [...sorted, { start: DAY_MINUTES, end: DAY_MINUTES }]) {
    const size = b.start - prevEnd;
    if (size >= MIN_BLOCK_MINUTES && (!best || size > best.end - best.start)) {
      best = { start: prevEnd, end: b.start };
    }
    prevEnd = Math.max(prevEnd, b.end);
  }
  if (!best) return null;
  return { start: best.start, end: Math.min(best.end, best.start + 120) };
}

export function removeBlock(week: Week, dayIndex: number, index: number): Week {
  return week.map((day, d) => (d === dayIndex ? day.filter((_, i) => i !== index) : day));
}

export function updateBlockData(
  week: Week,
  dayIndex: number,
  index: number,
  data: BlockData | undefined,
): Week {
  const block = week[dayIndex]?.[index];
  if (!block) return week;
  const next: ScheduleBlock = { start: block.start, end: block.end };
  if (data && Object.keys(data).length > 0) next.data = { ...data };
  return replaceBlock(week, dayIndex, index, next);
}

export function copyDay(week: Week, from: number, targets: number[]): Week {
  const source = week[from] ?? [];
  return week.map((day, d) =>
    d !== from && targets.includes(d)
      ? source.map((b) => ({ ...b, ...(b.data ? { data: { ...b.data } } : {}) }))
      : day,
  );
}

export interface WeekTemplate {
  id: "split" | "day" | "home";
  make: () => Week;
}

function dayRanges(...ranges: Array<[string, string]>): ScheduleBlock[] {
  return ranges.map(([from, to]) => ({ start: parseTime(from), end: parseTime(to) }));
}

const weekdays = (fn: () => ScheduleBlock[]) => [0, 1, 2, 3, 4].map(fn);

export const TEMPLATES: WeekTemplate[] = [
  {
    id: "split",
    make: () => [
      ...weekdays(() => dayRanges(["06:00", "08:30"], ["17:00", "22:30"])),
      dayRanges(["08:00", "23:00"]),
      dayRanges(["08:00", "23:00"]),
    ],
  },
  { id: "day", make: () => WEEKDAYS.map(() => dayRanges(["07:00", "22:00"])) },
  {
    id: "home",
    make: () => [
      ...weekdays(() => dayRanges(["07:00", "22:00"])),
      dayRanges(["08:00", "23:00"]),
      dayRanges(["08:00", "23:00"]),
    ],
  },
];

export const DAY_GROUPS = {
  weekdays: [0, 1, 2, 3, 4],
  weekend: [5, 6],
  all: [0, 1, 2, 3, 4, 5, 6],
} as const;
