import type { Rows } from './art';

export type Sprite = HTMLCanvasElement;

export function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

export function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function hex([r, g, b]: [number, number, number]): string {
  return '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
}

/** Scale a colour's brightness (f < 1 darker). */
export function shade(color: string, f: number): string {
  const [r, g, b] = rgb(color);
  return hex([r * f, g * f, b * f]);
}

/** Draw rows of palette characters into a canvas ('.' = transparent). */
export function compile(rows: Rows, palette: Record<string, string>, flip = false): Sprite {
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const c = canvas(w, h);
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      const ch = rows[y][x];
      if (ch === '.' || ch === ' ') continue;
      const col = palette[ch];
      if (!col) continue;
      const [r, g, b] = rgb(col);
      const i = (y * w + (flip ? w - 1 - x : x)) * 4;
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

const cache = new Map<string, Sprite>();
/** compile() with a cache keyed by the caller's key. */
export function cached(key: string, make: () => Sprite): Sprite {
  let s = cache.get(key);
  if (!s) {
    s = make();
    cache.set(key, s);
  }
  return s;
}

/** Deterministic hash of two integers to [0, 1): static texture detail without randomness. */
export function hash2(x: number, y: number, seed = 0): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export interface Tones {
  outline: string;
  dark: string;
  mid: string;
  light: string;
}

/**
 * A rounded blob made of overlapping ellipses (sprite pixels), shaded like pixel art: three
 * tones lit from the top-left, a 2×2 checker where two tones meet, and a 1px dark outline.
 */
export function blob(w: number, h: number, parts: { x: number; y: number; rx: number; ry: number }[], tones: Tones): Sprite {
  const c = canvas(w + 2, h + 2);
  const ctx = c.getContext('2d')!;
  const W = c.width;
  const H = c.height;
  const inside = new Float32Array(W * H).fill(-1);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let best = -1;
      let front = -Infinity;
      for (const p of parts) {
        const dx = (x + 0.5 - 1 - p.x) / p.rx;
        const dy = (y + 0.5 - 1 - p.y) / p.ry;
        const d = dx * dx + dy * dy;
        if (d > 1) continue;
        // Sphere normal of this part; light from the top-left and slightly toward the viewer.
        const nz = Math.sqrt(1 - d);
        // Where parts overlap, the one whose surface is nearest the viewer wins.
        const depth = p.y + nz * p.ry;
        if (depth > front) {
          front = depth;
          best = Math.max(0, -dx * 0.45 - dy * 0.6 + nz * 0.66);
        }
      }
      inside[y * W + x] = best;
    }
  }
  const tone = [rgb(tones.dark), rgb(tones.mid), rgb(tones.light)];
  const out = rgb(tones.outline);
  const img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const v = inside[y * W + x];
      let col: [number, number, number] | null = null;
      if (v >= 0) {
        const checker = (x + y) % 2 === 0 ? 0.06 : -0.06;
        const l = v + checker;
        col = tone[l > 0.62 ? 2 : l > 0.25 ? 1 : 0];
      } else {
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < W && ny < H && inside[ny * W + nx] >= 0) col = out;
        }
      }
      if (!col) continue;
      const i = (y * W + x) * 4;
      img.data[i] = col[0];
      img.data[i + 1] = col[1];
      img.data[i + 2] = col[2];
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** A flat ellipse in one colour (shadows), drawn pixel by pixel so it stays crisp. */
export function ellipseSprite(rx: number, ry: number, color: string): Sprite {
  const c = canvas(rx * 2, ry * 2);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = color;
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      const dx = (x + 0.5 - rx) / rx;
      const dy = (y + 0.5 - ry) / ry;
      if (dx * dx + dy * dy <= 1) ctx.fillRect(x, y, 1, 1);
    }
  }
  return c;
}

/** A glow: concentric rings with checker-dithered edges (lamp light at night). */
export function glowSprite(r: number, color: string): Sprite {
  const c = canvas(r * 2, r * 2);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = color;
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      // Squashed vertically: the pool lies on the ground in the 3/4 view.
      const d = Math.hypot((x + 0.5 - r) / r, ((y + 0.5 - r) / r) * 1.35);
      const checker = (x + y) % 2 === 0;
      if (d < 0.55 || (d < 0.85 && checker) || (d < 1 && checker && (x % 2 === 0))) ctx.fillRect(x, y, 1, 1);
    }
  }
  return c;
}
