/** Far-future sentinel timestamp (year 3000): vacation active indefinitely. */
export const VACATION_SENTINEL = 32503680000;

/** Backward-compatible control policy for settings without an explicit mode. */
export const DEFAULT_CONTROL_MODE = "bangbang" as const;

/** Idle setback deltas are stored in Celsius, independently of HA display units. */
export const DEFAULT_SETBACK_OFFSET = 2;
export const MIN_SETBACK_OFFSET = 1;
export const MAX_SETBACK_OFFSET = 5;
