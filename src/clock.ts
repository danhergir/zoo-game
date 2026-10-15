/**
 * The zoo's clock is derived from real time, so everyone who opens the game
 * sees the same moment of the same zoo day.
 */

/** Real seconds per in-game day. */
export const DAY_SECONDS = 360;

/** Day 1 began at this moment (UTC). */
const EPOCH_MS = Date.UTC(2026, 9, 14);

/** The zoo resets to a known state at this hour each night, while everyone's asleep. */
export const RESET_HOUR = 4;
/** Real seconds per in-game hour. */
export const HOUR_SECONDS = DAY_SECONDS / 24;

/** The most recent nightly reset at or before `nowMs`: its number and when it happened. */
export function lastReset(nowMs: number): { index: number; startMs: number } {
  const offsetMs = RESET_HOUR * HOUR_SECONDS * 1000;
  const dayMs = DAY_SECONDS * 1000;
  const index = Math.floor((nowMs - EPOCH_MS - offsetMs) / dayMs);
  return { index, startMs: EPOCH_MS + offsetMs + index * dayMs };
}

export interface ZooTime {
  day: number;
  /** In [0, 24). */
  hour: number;
}

export function zooTime(nowMs: number): ZooTime {
  const days = (nowMs - EPOCH_MS) / 1000 / DAY_SECONDS;
  const whole = Math.floor(days);
  return { day: whole + 1, hour: (days - whole) * 24 };
}
