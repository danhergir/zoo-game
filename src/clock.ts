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

/**
 * Daylight hours pass more slowly than night ones: 6:00 to 19:00 (sunrise to dusk) takes this
 * share of each real day, and the rest of the night hurries by.
 */
const DAY_START = 6;
const DAY_END = 19;
const DAY_SHARE = 0.75;
const NIGHT_SHARE_BEFORE_DAWN = ((1 - DAY_SHARE) * DAY_START) / (24 - (DAY_END - DAY_START));

/** [fraction of the real day since zoo midnight, zoo hour] at each change of pace. */
const KNOTS: [number, number][] = [
  [0, 0],
  [NIGHT_SHARE_BEFORE_DAWN, DAY_START],
  [NIGHT_SHARE_BEFORE_DAWN + DAY_SHARE, DAY_END],
  [1, 24],
];

/** Zoo hour for a fraction of the real day since zoo midnight, in [0, 1). */
function hourAt(fraction: number): number {
  for (let i = 1; i < KNOTS.length; i++) {
    const [f0, h0] = KNOTS[i - 1];
    const [f1, h1] = KNOTS[i];
    if (fraction < f1) return h0 + ((fraction - f0) / (f1 - f0)) * (h1 - h0);
  }
  return 0;
}

/** The inverse: how far into the real day (0..1) zoo hour `hour` comes. */
function fractionAt(hour: number): number {
  for (let i = 1; i < KNOTS.length; i++) {
    const [f0, h0] = KNOTS[i - 1];
    const [f1, h1] = KNOTS[i];
    if (hour < h1) return f0 + ((hour - h0) / (h1 - h0)) * (f1 - f0);
  }
  return 0;
}

/** How far into the real day the nightly reset comes. */
const RESET_FRACTION = fractionAt(RESET_HOUR);

/** Zoo hour `seconds` (real) after a nightly reset. */
export function hourAfterReset(seconds: number): number {
  const f = RESET_FRACTION + seconds / DAY_SECONDS;
  return hourAt(f - Math.floor(f));
}

/** Whether `seconds` after a reset is past midnight (the next zoo day). */
export function pastMidnight(seconds: number): boolean {
  return seconds / DAY_SECONDS >= 1 - RESET_FRACTION;
}

/** The most recent nightly reset at or before `nowMs`: its number and when it happened. */
export function lastReset(nowMs: number): { index: number; startMs: number } {
  const dayMs = DAY_SECONDS * 1000;
  const offsetMs = RESET_FRACTION * dayMs;
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
  return { day: whole + 1, hour: hourAt(days - whole) };
}
