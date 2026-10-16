/**
 * While a browser fast-forwards from the last reset to now, purely visual
 * work (poses, particles, labels) is skipped. Anything that draws random
 * numbers still runs, in the same order, so the result is identical.
 */
export const fastForward = { on: false };
