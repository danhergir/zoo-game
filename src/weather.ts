import { Rng } from './rng';

/**
 * The weather of the day, the same for everyone: picked from a seed per zoo
 * day and shaped over the hours (showers come and go, morning fog lifts).
 */

export interface WeatherState {
  /** 0 = clear sky, 1 = overcast. */
  cloud: number;
  /** 0 = dry, 1 = steady rain. */
  rain: number;
  /** 0 = clear air, 1 = thick fog. */
  fog: number;
  /** How wet the paths are (lingers after the rain stops). */
  wet: number;
}

/** Updated once per simulation step; animals and guests read it. */
export const weatherNow: WeatherState = { cloud: 0, rain: 0, fog: 0, wet: 0 };

type Kind = 'sunny' | 'cloudy' | 'showers' | 'foggy';

interface DayPlan {
  kind: Kind;
  cloud: number;
  rainStart: number;
  rainEnd: number;
}

const plans = new Map<number, DayPlan>();

function plan(day: number): DayPlan {
  let p = plans.get(day);
  if (!p) {
    const rng = new Rng(`tiny-zoo:weather ${day}`);
    const r = rng.next();
    const kind: Kind = r < 0.45 ? 'sunny' : r < 0.7 ? 'cloudy' : r < 0.9 ? 'showers' : 'foggy';
    const rainStart = rng.float(9.5, 14.5);
    p = {
      kind,
      cloud: kind === 'sunny' ? rng.float(0.05, 0.25) : kind === 'foggy' ? 0.35 : rng.float(0.6, 0.85),
      rainStart,
      rainEnd: rainStart + rng.float(1.5, 3.5),
    };
    plans.set(day, p);
    if (plans.size > 8) plans.delete(plans.keys().next().value!);
  }
  return p;
}

/** Ramp from 0 to 1 over `width` hours starting at `a`, and back down ending at `b`. */
function window(h: number, a: number, b: number, width: number): number {
  return Math.max(0, Math.min(1, (h - a) / width, (b - h) / width));
}

/** Weather on zoo day `day` at zoo hour `hour`. */
export function weatherAt(day: number, hour: number, out: WeatherState = weatherNow): WeatherState {
  const p = plan(day);
  out.cloud = p.cloud;
  out.rain = 0;
  out.fog = 0;
  out.wet = 0;
  if (p.kind === 'showers') {
    out.rain = window(hour, p.rainStart, p.rainEnd, 0.5);
    out.cloud = Math.max(p.cloud, 0.5 + 0.45 * window(hour, p.rainStart - 1, p.rainEnd + 1, 1));
    // Paths stay wet for a couple of hours after the rain stops.
    out.wet = hour < p.rainStart ? 0 : hour < p.rainEnd ? out.rain : Math.max(0, 1 - (hour - p.rainEnd) / 2);
  } else if (p.kind === 'foggy') {
    // Thick from the small hours, lifting through the morning.
    out.fog = hour < 4 ? 0.4 : hour < 9 ? 1 : Math.max(0, 1 - (hour - 9) / 2);
  }
  return out;
}

/** Icon for the clock. */
export function weatherIcon(hour: number, w: WeatherState): string {
  if (w.rain > 0.3) return '🌧️';
  if (w.fog > 0.5) return '🌫️';
  if (hour < 6 || hour >= 19) return '🌙';
  return w.cloud > 0.55 ? '☁️' : '☀️';
}
