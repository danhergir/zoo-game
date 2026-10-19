import { canvas, rgb, type Sprite } from './sprite';

/**
 * The zoo train in pixel art, built from the same shapes and sizes as the 3D model (engine and
 * open carriages) and drawn from 8 directions in the map's 3/4 view. Every car is as long as the
 * real one, so the cars sit coupled together the way they run on the track, and the engine's
 * nose always points the way it's going.
 */

/** Art pixels per world unit (same as the map). */
const PX = 8;
const OUTLINE = '#221e1e';
const DARK = '#2c2f33';
const RED = '#c0392b';

/** A solid in the car's own space: x across, y up from the rails, z forward (the engine's nose). */
interface Solid {
  inside: (x: number, y: number, z: number) => boolean;
  /** Surface direction at a point on it (for light and shade). */
  normal: (x: number, y: number, z: number) => [number, number, number];
  color: (x: number, y: number, z: number, frame: number) => string;
}

const solid = (color: string | Solid['color']) => (typeof color === 'string' ? () => color : color);

function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, color: string | Solid['color']): Solid {
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const cz = (z0 + z1) / 2;
  return {
    inside: (x, y, z) => x >= x0 && x <= x1 && y >= y0 && y <= y1 && z >= z0 && z <= z1,
    normal: (x, y, z) => {
      // The face the point is nearest to, relative to the box's size.
      const dx = (x - cx) / ((x1 - x0) / 2);
      const dy = (y - cy) / ((y1 - y0) / 2);
      const dz = (z - cz) / ((z1 - z0) / 2);
      const ax = Math.abs(dx);
      const ay = Math.abs(dy);
      const az = Math.abs(dz);
      if (ay >= ax && ay >= az) return [0, Math.sign(dy), 0];
      return ax >= az ? [Math.sign(dx), 0, 0] : [0, 0, Math.sign(dz)];
    },
    color: solid(color),
  };
}

/** A cylinder lying along z (the boiler). */
function boiler(r: number, cy: number, z0: number, z1: number, color: Solid['color']): Solid {
  return {
    inside: (x, y, z) => z >= z0 && z <= z1 && x * x + (y - cy) ** 2 <= r * r,
    normal: (x, y, z) => (z > z1 - 0.1 ? [0, 0, 1] : [x / r, (y - cy) / r, 0]),
    color,
  };
}

/** A cylinder standing up (the chimney), narrowing towards the top. */
function chimney(r0: number, r1: number, y0: number, y1: number, cz: number, color: string): Solid {
  const r = (y: number) => r0 + ((y - y0) / (y1 - y0)) * (r1 - r0);
  return {
    inside: (x, y, z) => y >= y0 && y <= y1 && x * x + (z - cz) ** 2 <= r(y) ** 2,
    normal: (x, y, z) => (y > y1 - 0.1 ? [0, 1, 0] : [x / r(y), 0, (z - cz) / r(y)]),
    color: solid(color),
  };
}

/** A wheel on its axle across the car: dark rim, spokes that turn with `frame`. */
function wheel(side: number, cz: number, r: number): Solid {
  const x0 = side > 0 ? 0.55 : -0.69;
  const x1 = x0 + 0.14;
  return {
    inside: (x, y, z) => x >= x0 && x <= x1 && (y - r) ** 2 + (z - cz) ** 2 <= r * r,
    normal: (x, y, z) => (Math.abs(x - (side > 0 ? x1 : x0)) < 0.07 ? [side, 0, 0] : [0, (y - r) / r, (z - cz) / r]),
    color: (_x, y, z, frame) => {
      const d = Math.hypot(y - r, z - cz);
      if (d > r * 0.72) return '#3a3d42';
      const a = Math.atan2(y - r, z - cz) + frame * (Math.PI / 4);
      return d < r * 0.28 || Math.cos(a * 2) > 0.8 ? '#b8bcc4' : '#55595f';
    },
  };
}

/** The cowcatcher: a yellow wedge at the front, narrowing to a point. */
function cowcatcher(z0: number, z1: number): Solid {
  const half = (z: number) => 0.7 - ((z - z0) / (z1 - z0)) * 0.55;
  return {
    inside: (x, y, z) => z >= z0 && z <= z1 && y >= 0.18 && y <= 0.75 - (z - z0) * 0.5 && Math.abs(x) <= half(z),
    normal: (x) => [Math.sign(x) * 0.5, 0.4, 0.75],
    color: solid('#ffd23f'),
  };
}

function head(cx: number, cy: number, cz: number, r: number, color: string): Solid {
  return {
    inside: (x, y, z) => (x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2 <= r * r,
    normal: (x, y, z) => [(x - cx) / r, (y - cy) / r, (z - cz) / r],
    color: solid(color),
  };
}

function engine(): Solid[] {
  const gold = '#f0c03a';
  return [
    box(-0.7, 0.7, 0.375, 0.725, -1.6, 1.6, DARK), // chassis
    ...[-1, 1].flatMap((s) => [-1.0, 0.1, 1.1].map((z) => wheel(s, z, 0.38))),
    // Boiler, with a gold band and the headlamp at the front.
    boiler(0.55, 1.25, -0.55, 1.45, (_x, _y, z) => (Math.abs(z - 0.85) < 0.09 ? gold : z > 1.37 ? '#8e2a20' : RED)),
    box(-0.12, 0.12, 1.5, 1.72, 1.4, 1.56, '#fff3b0'),
    chimney(0.2, 0.26, 1.65, 2.45, 1.05, DARK),
    // Cab at the back: windows on every side, a dark roof overhanging it.
    box(-0.7, 0.7, 0.7, 2.2, -1.55, -0.45, (x, y, z) => {
      const window = y > 1.45 && y < 1.95;
      const sideWindow = window && Math.abs(x) > 0.62 && z > -1.35 && z < -0.65;
      const endWindow = window && Math.abs(x) < 0.5 && (z > -0.53 || z < -1.47);
      return sideWindow || endWindow ? '#9fd3ef' : RED;
    }),
    box(-0.8, 0.8, 2.19, 2.32, -1.7, -0.3, DARK),
    cowcatcher(1.45, 2.05),
    box(-0.1, 0.1, 0.42, 0.58, -2.0, -1.6, DARK), // coupler
  ];
}

const SHIRTS = ['#e85d5d', '#4f8fdc', '#f2c14e', '#6cc28a', '#b07ad9', '#ff9f5a', '#f5f5f0'];
const SKINS = ['#f3d2b3', '#e0b18a', '#c68b5e', '#8d5a3b'];

/** Open carriage: low walls in its colour, a plank floor and four passengers (same seed as the 3D ones). */
function carriage(color: string, seed: number): Solid[] {
  const people: Solid[] = [];
  let k = seed;
  for (const z of [-0.7, 0.7]) {
    for (const x of [-0.35, 0.35]) {
      k = (k * 9301 + 49297) % 233280;
      // Seated: shoulders just above the wall, head on top.
      people.push(box(x - 0.2, x + 0.2, 0.65, 1.26, z - 0.17, z + 0.17, SHIRTS[k % SHIRTS.length]));
      people.push(head(x, 1.42, z, 0.17, SKINS[k % SKINS.length]));
    }
  }
  const rim = tone(color, 1.35);
  const trim = (_x: number, y: number) => (y > 1.08 ? rim : color);
  return [
    box(-0.75, 0.75, 0.35, 0.65, -1.5, 1.5, DARK), // underframe
    box(-0.7, 0.7, 0.64, 0.68, -1.42, 1.42, '#9a7350'), // plank floor
    ...[-1, 1].flatMap((s) => [-0.95, 0.95].map((z) => wheel(s, z, 0.3))),
    box(-0.75, 0.75, 0.65, 1.15, 1.42, 1.5, trim),
    box(-0.75, 0.75, 0.65, 1.15, -1.5, -1.42, trim),
    box(0.67, 0.75, 0.65, 1.15, -1.5, 1.5, trim),
    box(-0.75, -0.67, 0.65, 1.15, -1.5, 1.5, trim),
    ...people,
    box(-0.1, 0.1, 0.42, 0.58, 1.5, 1.95, DARK), // couplers
    box(-0.1, 0.1, 0.42, 0.58, -1.95, -1.5, DARK),
  ];
}

/** Light from above, a little from the front-left (as in the rest of the map's art). */
const LIGHT = (() => {
  const v = [-0.45, 0.8, 0.4];
  const n = Math.hypot(...v);
  return v.map((c) => c / n);
})();

const MAX_Y = 2.5;
const REACH = 2.1;

/**
 * Draws the car seen from the map's 3/4 view with its nose at heading `yaw` (0 = towards the
 * viewer, like the 3D models). Each pixel looks down through the car (higher up and nearer the
 * viewer first) and takes the colour of the first surface it meets, shaded in three tones.
 */
function draw(model: Model, yaw: number, frame: number): { sprite: Sprite; ax: number; ay: number } {
  const { solids, half } = model;
  const size = Math.ceil(REACH * 2 * PX) + 2;
  const top = Math.ceil(MAX_Y * PX);
  const w = size;
  const h = size + top;
  const ox = size / 2;
  const oy = top + size / 2; // where the car's centre at rail level lands
  const s = Math.sin(yaw);
  const c = Math.cos(yaw);
  const color: (string | null)[] = new Array(w * h).fill(null);
  const shadow = new Uint8Array(w * h);
  const depth = new Float32Array(w * h).fill(-Infinity);
  const step = 1 / (PX * 3);
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      // World offsets on the screen line through this pixel: x across, z - y down the screen.
      const wx = (px + 0.5 - ox) / PX;
      const line = (py + 0.5 - oy) / PX;
      // The car's shadow on the ground, cast a little away from the light.
      const gx = (wx - 0.2) * c - (line - 0.15) * s;
      const gz = (wx - 0.2) * s + (line - 0.15) * c;
      if (Math.abs(gx) < 0.78 && Math.abs(gz) < half) shadow[py * w + px] = 1;
      for (let y = MAX_Y; y >= 0; y -= step) {
        const wz = line + y;
        // Back into the car's own space (undo the heading).
        const x = wx * c - wz * s;
        const z = wx * s + wz * c;
        if (Math.abs(x) > 1 || Math.abs(z) > REACH) continue;
        let hit: Solid | null = null;
        for (let i = solids.length - 1; i >= 0; i--) {
          if (solids[i].inside(x, y, z)) {
            hit = solids[i];
            break;
          }
        }
        if (!hit) continue;
        const [nx, ny, nz] = hit.normal(x, y, z);
        // The normal turned to face the way the car does.
        const wnx = nx * c + nz * s;
        const wnz = -nx * s + nz * c;
        const lit = wnx * LIGHT[0] + ny * LIGHT[1] + wnz * LIGHT[2];
        const base = hit.color(x, y, z, frame);
        color[py * w + px] = lit > 0.62 ? tone(base, 1.16) : lit > 0.22 ? base : tone(base, 0.72);
        depth[py * w + px] = wz + y;
        break;
      }
    }
  }
  const sprite = canvas(w, h);
  const ctx = sprite.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  const put = (i: number, hex: string) => {
    const [r, g, b] = rgb(hex);
    img.data.set([r, g, b, 255], i * 4);
  };
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const i = py * w + px;
      const here = color[i];
      const near = [px > 0 ? i - 1 : -1, px < w - 1 ? i + 1 : -1, py > 0 ? i - w : -1, py < h - 1 ? i + w : -1].filter((j) => j >= 0);
      if (!here) {
        // A dark outline around the whole car.
        if (near.some((j) => color[j])) put(i, OUTLINE);
        else if (shadow[i]) img.data.set([20, 30, 10, 80], i * 4);
        continue;
      }
      // And between parts at different depths (the cab against the boiler, a head over a wall).
      if (near.some((j) => color[j] && depth[j] - depth[i] > 0.45)) put(i, OUTLINE);
      else put(i, here);
    }
  }
  ctx.putImageData(img, 0, 0);
  return { sprite, ax: ox, ay: oy };
}

const tones = new Map<string, string>();
function tone(hex: string, f: number): string {
  const key = hex + f;
  let t = tones.get(key);
  if (!t) {
    const [r, g, b] = rgb(hex);
    t = '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v * f))).toString(16).padStart(2, '0')).join('');
    tones.set(key, t);
  }
  return t;
}

const CARRIAGE_COLORS = ['#2f6f8f', '#6cc28a', '#ffd23f'];
const CARRIAGE_SEEDS = [7, 19, 31];
/** A car's solids and half its length (for its shadow). */
interface Model {
  solids: Solid[];
  half: number;
}

const models: Model[] = [
  { solids: engine(), half: 1.75 },
  ...CARRIAGE_COLORS.map((col, i) => ({ solids: carriage(col, CARRIAGE_SEEDS[i]), half: 1.55 })),
];
const drawn = new Map<string, { sprite: Sprite; ax: number; ay: number }>();

/** Headings drawn: 8, one every 45°. */
export const TRAIN_DIRECTIONS = 8;

/**
 * Car `index` (0 the engine, then the carriages) facing the nearest of the 8 headings to `yaw`,
 * with its wheels at turn `frame` (0 or 1). `ax, ay` is where its centre at rail level is.
 */
export function trainCar(index: number, yaw: number, frame: number): { sprite: Sprite; ax: number; ay: number } {
  const n = TRAIN_DIRECTIONS;
  const dir = ((Math.round((yaw / (Math.PI * 2)) * n) % n) + n) % n;
  const model = Math.min(index, models.length - 1);
  const key = `${model}:${dir}:${frame}`;
  let d = drawn.get(key);
  if (!d) {
    d = draw(models[model], (dir / n) * Math.PI * 2, frame);
    drawn.set(key, d);
  }
  return d;
}

/** Where the headlamp is, from the engine's centre: forward distance and height (world units). */
export const HEADLAMP = { forward: 1.5, height: 1.6 };
