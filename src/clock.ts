/**
 * The zoo's clock is derived from real time, so everyone who opens the game
 * sees the same moment of the same zoo day.
 */

/** Real seconds per in-game day. */
export const DAY_SECONDS = 360;

/** Day 1 began at this moment (UTC). */
const EPOCH_MS = Date.UTC(2026, 9, 14);

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
