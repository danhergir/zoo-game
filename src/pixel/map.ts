import type { Enclosure } from '../enclosure';
import type { Feeder } from '../feeder';
import { HABITATS } from '../habitats';
import {
  BENCHES,
  DECKS,
  FLAMINGO_POND,
  GATE_Z,
  GIFT_SHOP,
  LAGOON,
  LAMPS,
  OPEN_AREAS,
  PATH_RECTS,
  PICNIC_TABLES,
  PLAYGROUND,
  PLAZA,
  STAFF_HUT,
  STANDS,
  TRAIN_TRACK,
} from '../layout';
import { blob, canvas, ellipseSprite, hash2, rgb, shade, type Sprite } from './sprite';

/** Art pixels per world unit. */
export const PX = 8;
/** World area covered by the map (the zoo, the train loop and a margin). */
export const MIN_X = -122;
export const MIN_Z = -120;
const MAX_X = 122;
const MAX_Z = 92;
export const MAP_W = (MAX_X - MIN_X) * PX;
export const MAP_H = (MAX_Z - MIN_Z) * PX;

/** World x/z to map art pixels. */
export const toArtX = (x: number) => (x - MIN_X) * PX;
export const toArtY = (z: number) => (z - MIN_Z) * PX;

/** Something standing on the map, drawn in depth order: its foot point and the sprite's anchor. */
export interface Prop {
  sprite: Sprite;
  /** Foot point in art pixels; props are sorted by y. */
  x: number;
  y: number;
  /** Where the foot point is inside the sprite. */
  ax: number;
  ay: number;
  /** Shown only at night (lit lamp heads), or only by day. */
  when?: 'night' | 'day';
  /** Flat on the ground (shadows): drawn before everything standing. */
  layer?: 'shadow';
}

const enum K {
  Grass,
  Path,
  Deck,
  Floor,
  Water,
  Shore,
  Ice,
  Deep,
  IceShore,
  Gravel,
  Rail,
  Sand,
  Lagoon,
  Glass,
}

const C = {
  grass: '#6dab48',
  grassDark: '#5c9a3d',
  grassLight: '#82c15a',
  path: '#d8c9a3',
  mortar: '#bba982',
  pathLight: '#e6dabb',
  curb: '#9d8b66',
  deck: '#b07a44',
  deckLine: '#8a5c30',
  water: '#3f86d0',
  waterLight: '#6aa8e8',
  shore: '#a88f5c',
  bank: '#7d683f',
  ice: '#e8eef1',
  iceSpeck: '#d3dee4',
  deep: '#1f6c9c',
  deepLight: '#3d8cc0',
  iceShore: '#f7fbfc',
  gravel: '#a39c8e',
  rail: '#5d5852',
  sand: '#e2cf95',
  lagoon: '#47a9c6',
  lagoonLight: '#7cc8dc',
  glass: '#d4ecf2',
  flamingoWater: '#5fb3c9',
  flamingoShore: '#9a8a62',
};

function inPolygon(pts: [number, number][], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i];
    const [xj, zj] = pts[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Wobbly pond outline, like the 3D ponds: radius multiplier at angle a. */
const wobble = (a: number, seed: number) => 1 + Math.sin(a * 3 + seed) * 0.12 + Math.sin(a * 5 + seed * 2) * 0.06;

/** Paints the whole zoo ground once. */
export function buildGround(enclosures: Enclosure[]): Sprite {
  const W = MAP_W;
  const H = MAP_H;
  const kind = new Uint8Array(W * H);
  const color = new Uint32Array(W * H);
  const pack = (hexColor: string) => {
    const [r, g, b] = rgb(hexColor);
    return (255 << 24) | (b << 16) | (g << 8) | r;
  };
  const P: Record<string, number> = {};
  for (const [k, v] of Object.entries(C)) P[k] = pack(v);
  const floors = HABITATS.map((h, i) => {
    const xs = h.enclosure.points.map((p) => p[0]);
    const zs = h.enclosure.points.map((p) => p[1]);
    const base = h.enclosure.groundColor;
    return {
      pts: h.enclosure.points,
      box: [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)],
      icy: h.enclosure.icy === true,
      base: pack(base),
      dark: pack(shade(base, 0.88)),
      light: pack(shade(base, 1.07)),
      pond: enclosures[i].pond,
      seed: i * 1.7 + 0.4,
    };
  });
  const T = TRAIN_TRACK;

  for (let py = 0; py < H; py++) {
    const z = MIN_Z + (py + 0.5) / PX;
    for (let px = 0; px < W; px++) {
      const x = MIN_X + (px + 0.5) / PX;
      const i = py * W + px;
      const h = hash2(px, py);
      let k = K.Grass;
      let col = h < 0.025 ? P.grassDark : h < 0.045 ? P.grassLight : P.grass;

      // Train loop: gravel bed with two rails.
      const dx = x - T.x;
      const dz = z - T.z;
      const q = Math.hypot(dx / T.rx, dz / T.rz);
      const grad = Math.hypot(dx / (T.rx * T.rx), dz / (T.rz * T.rz)) / Math.max(q, 1e-6);
      const d = (q - 1) / grad;
      if (Math.abs(d) < 1.6) {
        k = K.Gravel;
        col = h < 0.08 ? pack(shade(C.gravel, 0.85)) : h < 0.14 ? pack(shade(C.gravel, 1.1)) : P.gravel;
        if (Math.abs(Math.abs(d) - 0.7) < 0.09) {
          k = K.Rail;
          col = P.rail;
        }
      }

      for (const [cx, cz, w, dd] of PATH_RECTS) {
        if (Math.abs(x - cx) <= w / 2 && Math.abs(z - cz) <= dd / 2) k = K.Path;
      }
      if (Math.hypot(x - PLAZA.x, z - PLAZA.z) <= PLAZA.r) k = K.Path;
      const [sx, sz, sw, sd] = OPEN_AREAS[0];
      if (Math.abs(x - sx) <= sw / 2 && Math.abs(z - sz) <= sd / 2) {
        k = K.Sand;
        col = h < 0.05 ? pack(shade(C.sand, 0.9)) : P.sand;
      }
      if (k === K.Path) {
        const row = Math.floor(py / 4);
        const mortar = py % 4 === 3 || (px + (row % 2) * 4) % 8 === 7;
        col = mortar ? P.mortar : h < 0.04 ? P.pathLight : P.path;
      }
      for (const deck of DECKS) {
        if (Math.abs(x - deck.x) <= deck.w / 2 && Math.abs(z - deck.z) <= deck.d / 2) {
          k = K.Deck;
          col = py % 3 === 2 ? P.deckLine : P.deck;
        }
      }

      for (const f of floors) {
        const [x0, x1, z0, z1] = f.box;
        if (x < x0 || x > x1 || z < z0 || z > z1 || !inPolygon(f.pts, x, z)) continue;
        k = f.icy ? K.Ice : K.Floor;
        col = f.icy ? (h < 0.06 ? P.iceSpeck : P.ice) : h < 0.04 ? f.dark : h < 0.06 ? f.light : f.base;
        if (f.pond) {
          const a = Math.atan2(z - f.pond.z, x - f.pond.x);
          const r = Math.hypot(x - f.pond.x, z - f.pond.z);
          const wb = wobble(a, f.seed);
          if (r <= (f.pond.r + 1.1) * wb) {
            k = f.icy ? K.IceShore : K.Shore;
            col = f.icy ? P.iceShore : P.shore;
          }
          if (r <= f.pond.r * wb) {
            k = f.icy ? K.Deep : K.Water;
            const ripple = py % 3 === 0 && hash2(Math.floor(px / 7), py, 3) < 0.25 && px % 7 < 3;
            col = f.icy ? (ripple ? P.deepLight : P.deep) : ripple ? P.waterLight : P.water;
          }
        }
      }

      // Reef lagoon: walkway ring, glass rim, water.
      const lr = Math.hypot(x - LAGOON.x, z - LAGOON.z);
      if (lr <= LAGOON.r + LAGOON.walk) {
        k = K.Path;
        const row = Math.floor(py / 4);
        col = py % 4 === 3 || (px + (row % 2) * 4) % 8 === 7 ? P.mortar : P.path;
      }
      if (lr <= LAGOON.r + 0.3) {
        k = K.Glass;
        col = P.glass;
      }
      if (lr <= LAGOON.r) {
        k = K.Lagoon;
        const ripple = py % 3 === 0 && hash2(Math.floor(px / 7), py, 5) < 0.25 && px % 7 < 3;
        col = ripple ? P.lagoonLight : P.lagoon;
      }

      // Flamingo pond.
      const fr = Math.hypot(x - FLAMINGO_POND.x, z - FLAMINGO_POND.z);
      const fa = Math.atan2(z - FLAMINGO_POND.z, x - FLAMINGO_POND.x);
      if (fr <= (FLAMINGO_POND.r + 1.2) * wobble(fa, 9)) {
        k = K.Shore;
        col = pack(C.flamingoShore);
      }
      if (fr <= FLAMINGO_POND.r * wobble(fa, 9)) {
        k = K.Water;
        col = pack(C.flamingoWater);
      }

      kind[i] = k;
      color[i] = col;
    }
  }

  // Edges: a darker curb where paving meets grass, a darker bank where shore meets water.
  for (let py = 1; py < H - 1; py++) {
    for (let px = 1; px < W - 1; px++) {
      const i = py * W + px;
      const k = kind[i];
      const n = [kind[i - 1], kind[i + 1], kind[i - W], kind[i + W]];
      if (k === K.Path && n.some((v) => v === K.Grass || v === K.Floor || v === K.Ice)) color[i] = P.curb;
      if ((k === K.Shore || k === K.IceShore) && n.some((v) => v === K.Water || v === K.Deep)) color[i] = k === K.Shore ? P.bank : P.iceSpeck;
      if (k === K.Deck && n.some((v) => v !== K.Deck)) color[i] = P.deckLine;
    }
  }

  const c = canvas(W, H);
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(W, H);
  new Uint32Array(img.data.buffer).set(color);
  ctx.putImageData(img, 0, 0);
  return c;
}

/* ---------- Standing things ---------- */

/** How far ropes sag at their midpoint (the 3D ropes dip ~0.6 units). */
const ROPE_SAG_PX = Math.round(0.6 * PX);

const LEAVES = { outline: '#22381a', dark: '#2f5e22', mid: '#46802f', light: '#63a03f' };
const ROCK = { outline: '#3a3632', dark: '#77716a', mid: '#9c968c', light: '#c4beb3' };
const BUSH = { outline: '#22381a', dark: '#2f6a26', mid: '#438a33', light: '#5ea544' };

function shadowSprite(rx: number, ry: number): Sprite {
  return ellipseSprite(rx, ry, 'rgba(20, 30, 10, 0.28)');
}

/** Acacia: flat crown of three clumps on a trunk, plus its shadow. */
function tree(x: number, z: number, tall: number, seed: number): Prop[] {
  const crownY = (4.7 + 4.4 * (tall - 1)) * PX;
  const flip = hash2(seed, 1) < 0.5 ? -1 : 1;
  const parts = [
    { x: 0, y: 0, rx: 3.2 * PX, ry: 1.7 * PX },
    { x: 1.7 * PX * flip, y: 0.6 * PX, rx: 2 * PX, ry: 1.15 * PX },
    { x: -1.6 * PX * flip, y: -0.5 * PX, rx: 2.2 * PX, ry: 1.2 * PX },
  ];
  const w = 2 * 5.4 * PX;
  const ch = 4 * PX;
  const crown = blob(w, ch, parts.map((p) => ({ ...p, x: p.x + w / 2, y: p.y + ch / 2 })), LEAVES);
  const s = canvas(crown.width, crownY + ch / 2 + 2);
  const ctx = s.getContext('2d')!;
  // Trunk: dark with a lit left edge, from the ground up into the crown.
  const tx = Math.round(s.width / 2) - 2;
  ctx.fillStyle = '#3e2816';
  ctx.fillRect(tx, ch / 2, 4, s.height - ch / 2);
  ctx.fillStyle = '#6a4628';
  ctx.fillRect(tx, ch / 2, 1, s.height - ch / 2);
  ctx.drawImage(crown, 0, 0);
  const ax = s.width / 2;
  const ay = s.height - 1;
  return [
    { sprite: shadowSprite(3 * PX, 1.2 * PX), x: toArtX(x) + PX, y: toArtY(z) - 1, ax: 3 * PX, ay: 1.2 * PX, layer: 'shadow' },
    { sprite: s, x: toArtX(x), y: toArtY(z), ax, ay },
  ];
}

/** Round tree for the plaza planter. */
function roundTree(x: number, z: number): Prop[] {
  const r = 1.8 * PX;
  const crown = blob(r * 2, r * 1.8, [
    { x: r, y: r * 0.9, rx: r, ry: r * 0.85 },
    { x: r * 0.6, y: r * 0.6, rx: r * 0.6, ry: r * 0.5 },
  ], LEAVES);
  const s = canvas(crown.width, crown.height + 2.2 * PX);
  const ctx = s.getContext('2d')!;
  ctx.fillStyle = '#3e2816';
  ctx.fillRect(s.width / 2 - 1, crown.height - 4, 3, s.height - crown.height + 4);
  ctx.drawImage(crown, 0, 0);
  return [{ sprite: s, x: toArtX(x), y: toArtY(z), ax: s.width / 2, ay: s.height - 1 }];
}

function rock(x: number, z: number, r: number, h: number): Prop {
  const rx = Math.max(3, r * PX * 1.05);
  const ry = Math.max(2, (r * 0.55 + h * 0.45) * PX);
  const s = blob(rx * 2, ry * 2, [
    { x: rx, y: ry, rx, ry },
    { x: rx * 0.8, y: ry * 0.75, rx: rx * 0.7, ry: ry * 0.6 },
  ], ROCK);
  return { sprite: s, x: toArtX(x), y: toArtY(z) + r * 0.3 * PX, ax: s.width / 2, ay: s.height - 1 };
}

/** A fence section from post a to post b: the post at a and two rails (one rail if low). */
function fenceSection(ax: number, ay: number, bx: number, by: number, style: 'wood' | 'glass' | 'low'): Prop {
  const post = style === 'low' ? 8 : 13;
  const rails = style === 'low' ? [5] : style === 'glass' ? [6, 11] : [5, 10];
  const x0 = Math.floor(Math.min(ax, bx)) - 1;
  const y0 = Math.floor(Math.min(ay, by)) - post - 1;
  const x1 = Math.ceil(Math.max(ax, bx)) + 2;
  const y1 = Math.ceil(Math.max(ay, by)) + 2;
  const s = canvas(x1 - x0, y1 - y0);
  const ctx = s.getContext('2d')!;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(bx - ax), Math.abs(by - ay))));
  const colors =
    style === 'glass'
      ? { top: '#e6f3f6', bottom: '#9cc2cc', post: '#8a9298', postLight: '#c5ccd0' }
      : { top: '#b07c45', bottom: '#6e4a2a', post: '#4a2f1a', postLight: '#7a5232' };
  if (style === 'glass') {
    // Faint glass panel between the rails.
    ctx.fillStyle = 'rgba(200, 235, 245, 0.35)';
    for (let i = 0; i <= steps; i++) {
      const px = Math.round(ax + ((bx - ax) * i) / steps) - x0;
      const py = Math.round(ay + ((by - ay) * i) / steps) - y0;
      ctx.fillRect(px, py - 11, 1, 6);
    }
  }
  // Fences running toward the viewer are seen edge-on: draw their rails two pixels wide so they
  // still read as a fence rather than a hairline.
  const steep = Math.abs(by - ay) > Math.abs(bx - ax);
  for (const hgt of rails) {
    for (let i = 0; i <= steps; i++) {
      const px = Math.round(ax + ((bx - ax) * i) / steps) - x0;
      const py = Math.round(ay + ((by - ay) * i) / steps) - y0 - hgt;
      ctx.fillStyle = colors.top;
      ctx.fillRect(px, py, steep ? 2 : 1, 1);
      ctx.fillStyle = colors.bottom;
      ctx.fillRect(px, py + 1, steep ? 2 : 1, 1);
    }
  }
  const px = Math.round(ax) - x0;
  const py = Math.round(ay) - y0;
  ctx.fillStyle = colors.post;
  ctx.fillRect(px - 1, py - post, 2, post + 1);
  ctx.fillStyle = colors.postLight;
  ctx.fillRect(px - 1, py - post, 1, post);
  return { sprite: s, x: x0, y: Math.max(ay, by), ax: 0, ay: Math.max(ay, by) - y0 };
}

function fence(points: [number, number][], style: 'wood' | 'glass' | 'low'): Prop[] {
  const out: Prop[] = [];
  for (let i = 0; i < points.length; i++) {
    const [ax, az] = points[i];
    const [bx, bz] = points[(i + 1) % points.length];
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.round(len / 2.4));
    for (let k = 0; k < n; k++) {
      const t0 = k / n;
      const t1 = (k + 1) / n;
      const p = fenceSection(
        toArtX(ax + (bx - ax) * t0),
        toArtY(az + (bz - az) * t0),
        toArtX(ax + (bx - ax) * t1),
        toArtY(az + (bz - az) * t1),
        style,
      );
      out.push(p);
    }
  }
  return out;
}

function feeder(f: Feeder): Prop {
  const r = Math.max(5, f.radius * PX);
  const food = { hay: '#e2c25a', fruit: '#e0603a', fish: '#a9bcc8', meat: '#b0453a' }[f.food];
  const s = canvas(r * 2 + 2, r + 6);
  const ctx = s.getContext('2d')!;
  const tub = blob(r * 2, r, [{ x: r, y: r / 2, rx: r, ry: r / 2 }], { outline: '#2a1a0e', dark: '#5a3a1e', mid: '#7a5230', light: '#9a6a3e' });
  ctx.drawImage(tub, 0, 4);
  const top = blob(r * 2 - 4, r - 3, [{ x: r - 2, y: (r - 3) / 2, rx: r - 2, ry: (r - 3) / 2 }], {
    outline: shade(food, 0.55),
    dark: shade(food, 0.8),
    mid: food,
    light: shade(food, 1.15),
  });
  ctx.drawImage(top, 2, 3);
  return { sprite: s, x: toArtX(f.root.position.x), y: toArtY(f.root.position.z) + r / 2, ax: s.width / 2, ay: s.height - 1 };
}

function lamp(x: number, z: number): Prop[] {
  const h = 22;
  const off = canvas(5, h + 1);
  const ctx = off.getContext('2d')!;
  ctx.fillStyle = '#2a2d30';
  ctx.fillRect(2, 3, 1, h - 2);
  ctx.fillRect(1, h - 1, 3, 2);
  ctx.fillRect(1, 1, 3, 3);
  ctx.fillStyle = '#c9c3a8';
  ctx.fillRect(2, 2, 1, 1);
  const on = canvas(5, h + 1);
  const c2 = on.getContext('2d')!;
  c2.drawImage(off, 0, 0);
  c2.fillStyle = '#fff6c8';
  c2.fillRect(1, 1, 3, 3);
  const base = { x: toArtX(x), y: toArtY(z), ax: 2, ay: h };
  return [
    { ...base, sprite: off, when: 'day' },
    { ...base, sprite: on, when: 'night' },
  ];
}

function bench(x: number, z: number): Prop {
  // Benches run along the avenue (north-south): a narrow vertical strip in the 3/4 view.
  const s = canvas(5, 14);
  const ctx = s.getContext('2d')!;
  ctx.fillStyle = '#2a1a0e';
  ctx.fillRect(0, 0, 5, 14);
  ctx.fillStyle = '#9a6a3e';
  ctx.fillRect(1, 1, 3, 10);
  ctx.fillStyle = '#7a5230';
  ctx.fillRect(1, 11, 3, 2);
  ctx.fillStyle = '#c08a52';
  ctx.fillRect(1, 1, 1, 10);
  return { sprite: s, x: toArtX(x), y: toArtY(z) + 6, ax: 2, ay: 13 };
}

/** A box building seen from the front and above: roof on top, front wall with a door. */
function building(wU: number, dU: number, hU: number, wall: string, roof: string, awning = false): Sprite {
  const w = Math.round(wU * PX);
  const roofH = Math.round(dU * PX * 0.6);
  const wallH = Math.round(hU * PX);
  const s = canvas(w + 2, roofH + wallH + 2);
  const ctx = s.getContext('2d')!;
  const outline = '#2a2018';
  ctx.fillStyle = outline;
  ctx.fillRect(0, 0, w + 2, roofH + wallH + 2);
  // Roof (stripes for a market awning).
  for (let y = 0; y < roofH; y++) {
    for (let x = 0; x < w; x++) {
      let c = roof;
      if (awning && Math.floor(x / 3) % 2 === 1) c = '#f4f0e6';
      if (y === 0) c = shade(c, 1.15);
      if (y === roofH - 1) c = shade(c, 0.7);
      ctx.fillStyle = c;
      ctx.fillRect(x + 1, y + 1, 1, 1);
    }
  }
  // Front wall, darker at the bottom.
  ctx.fillStyle = wall;
  ctx.fillRect(1, roofH + 1, w, wallH);
  ctx.fillStyle = shade(wall, 0.8);
  ctx.fillRect(1, roofH + wallH - 1, w, 1);
  // Door and windows.
  const door = Math.max(3, Math.round(PX * 0.9));
  ctx.fillStyle = '#4a2f1a';
  ctx.fillRect(Math.round(w / 2 - door / 2) + 1, roofH + wallH - Math.round(wallH * 0.7), door, Math.round(wallH * 0.7));
  if (w > 24) {
    ctx.fillStyle = '#8fc8e0';
    ctx.fillRect(4, roofH + 4, 5, 4);
    ctx.fillRect(w - 8, roofH + 4, 5, 4);
  }
  return s;
}

function buildingProp(x: number, z: number, wU: number, dU: number, hU: number, wall: string, roof: string, awning = false): Prop {
  const s = building(wU, dU, hU, wall, roof, awning);
  return { sprite: s, x: toArtX(x), y: toArtY(z + dU / 2), ax: s.width / 2, ay: s.height - 1 };
}

const WOOD = { outline: '#2a1a0e', dark: '#5a3a1e', mid: '#7a5232', light: '#9a6a3e' };

/** Monkeys' climbing frame: a pole and deck per platform, sagging ropes between them. */
function jungleGym(gym: NonNullable<Enclosure['gym']>): Prop[] {
  const props: Prop[] = [];
  for (const p of gym.platforms) {
    const h = Math.round(p.h * PX);
    const deck = blob(18, 8, [{ x: 9, y: 4, rx: 9, ry: 4 }], WOOD);
    const s = canvas(deck.width, h + deck.height / 2 + 1);
    const ctx = s.getContext('2d')!;
    const cx = Math.floor(s.width / 2);
    ctx.fillStyle = '#2a1a0e';
    ctx.fillRect(cx - 2, deck.height / 2, 4, s.height - deck.height / 2);
    ctx.fillStyle = '#7a5232';
    ctx.fillRect(cx - 1, deck.height / 2, 2, s.height - deck.height / 2 - 1);
    ctx.drawImage(deck, 0, 0);
    // Sorted just behind anything standing at the same spot, so a monkey on the deck draws on top.
    props.push({ sprite: s, x: toArtX(p.x), y: toArtY(p.z) - 1, ax: cx, ay: s.height - 1 });
  }
  for (const [a, b] of gym.ropes) {
    const pa = gym.platforms[a];
    const pb = gym.platforms[b];
    const ax = toArtX(pa.x);
    const ay = toArtY(pa.z) - pa.h * PX;
    const bx = toArtX(pb.x);
    const by = toArtY(pb.z) - pb.h * PX;
    const x0 = Math.floor(Math.min(ax, bx)) - 1;
    const y0 = Math.floor(Math.min(ay, by)) - 1;
    const s = canvas(Math.abs(bx - ax) + 3, Math.abs(by - ay) + ROPE_SAG_PX + 3);
    const ctx = s.getContext('2d')!;
    ctx.fillStyle = '#b08a55';
    const steps = Math.ceil(Math.hypot(bx - ax, by - ay));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const sag = 4 * t * (1 - t) * ROPE_SAG_PX;
      ctx.fillRect(Math.round(ax + (bx - ax) * t) - x0, Math.round(ay + (by - ay) * t + sag) - y0, 1, 1);
    }
    const ground = (toArtY(pa.z) + toArtY(pb.z)) / 2;
    props.push({ sprite: s, x: x0, y: ground, ax: 0, ay: ground - y0 });
  }
  return props;
}

/** Playground: a swing frame, a slide and a sandbox; picnic tables on the lawn. */
function playground(): Prop[] {
  const props: Prop[] = [];
  // Swing frame across both swings: posts at each end, a beam, chains down to the seats.
  const [s0, s1] = PLAYGROUND.swings;
  const x0 = toArtX(s0.x - 0.9);
  const x1 = toArtX(s1.x + 0.9);
  const beam = Math.round(2.6 * PX);
  const frame = canvas(x1 - x0 + 3, beam + 2);
  const f = frame.getContext('2d')!;
  f.fillStyle = '#2a2a2e';
  f.fillRect(0, 0, frame.width, 3);
  f.fillRect(0, 0, 3, frame.height);
  f.fillRect(frame.width - 3, 0, 3, frame.height);
  f.fillStyle = '#d6453a';
  f.fillRect(1, 1, frame.width - 2, 1);
  f.fillRect(1, 1, 1, frame.height - 1);
  f.fillRect(frame.width - 2, 1, 1, frame.height - 1);
  f.fillStyle = '#8a8f99';
  for (const sw of PLAYGROUND.swings) {
    const cx = Math.round(toArtX(sw.x) - x0);
    f.fillRect(cx - 2, 3, 1, beam - 8);
    f.fillRect(cx + 2, 3, 1, beam - 8);
  }
  props.push({ sprite: frame, x: x0, y: toArtY(s0.z) - 1, ax: 0, ay: frame.height - 1 });
  // Slide: a ladder at the north end (rails either side of the chute), a small platform on
  // top, and the chute running down to the south with side rails and a lip at the bottom.
  const top = Math.round(PLAYGROUND.slide.top * PX);
  const ladderY = toArtY(PLAYGROUND.slide.ladder.z);
  const bottomY = toArtY(PLAYGROUND.slide.bottom.z);
  const slide = canvas(11, bottomY - ladderY + top + 3);
  const c = slide.getContext('2d')!;
  const dark = '#2a2a2e';
  c.fillStyle = dark;
  c.fillRect(0, 0, 2, top + 3);
  c.fillRect(9, 0, 2, top + 3);
  c.fillStyle = '#8a8f99';
  for (let y = 2; y <= top; y += 2) {
    c.fillRect(0, y, 2, 1);
    c.fillRect(9, y, 2, 1);
  }
  c.fillStyle = dark;
  c.fillRect(1, 0, 9, 3);
  c.fillStyle = '#c8ccd4';
  c.fillRect(2, 1, 7, 1);
  for (let y = 3; y < slide.height - 1; y++) {
    const lip = y >= slide.height - 4 ? 1 : 0;
    c.fillStyle = dark;
    c.fillRect(2 - lip, y, 7 + lip * 2, 1);
    c.fillStyle = '#d6453a';
    c.fillRect(3 - lip, y, 1, 1);
    c.fillRect(7 + lip, y, 1, 1);
    c.fillStyle = '#f0c03a';
    c.fillRect(4, y, 3, 1);
    c.fillStyle = '#f8dc78';
    c.fillRect(4, y, 1, 1);
  }
  c.fillStyle = dark;
  c.fillRect(1, slide.height - 1, 9, 1);
  props.push({ sprite: slide, x: toArtX(PLAYGROUND.slide.ladder.x), y: bottomY, ax: 5, ay: slide.height - 1 });
  // Sandbox: a wooden frame flat on the ground.
  const box = canvas(3.2 * PX, 2.6 * PX);
  const b = box.getContext('2d')!;
  b.fillStyle = '#7a5232';
  b.fillRect(0, 0, box.width, box.height);
  b.fillStyle = '#f0dca0';
  b.fillRect(2, 2, box.width - 4, box.height - 4);
  props.push({ sprite: box, x: toArtX(44.4), y: toArtY(50.9), ax: box.width / 2, ay: box.height / 2, layer: 'shadow' });
  // Picnic tables: a table top with a bench either side.
  for (const t of PICNIC_TABLES) {
    const tbl = canvas(15, 14);
    const g = tbl.getContext('2d')!;
    g.fillStyle = '#2a1a0e';
    g.fillRect(0, 0, 15, 3);
    g.fillRect(1, 4, 13, 6);
    g.fillRect(0, 11, 15, 3);
    g.fillStyle = '#9a6a3e';
    g.fillRect(1, 1, 13, 1);
    g.fillRect(2, 5, 11, 4);
    g.fillRect(1, 12, 13, 1);
    g.fillStyle = '#c08a52';
    g.fillRect(2, 5, 11, 1);
    props.push({ sprite: tbl, x: toArtX(t.x), y: toArtY(t.z) + 3, ax: 7, ay: 10 });
  }
  return props;
}

/** The entrance arch: two posts and a beam with the zoo's name, over the avenue. */
function gate(): Prop {
  const w = 13 * PX;
  const h = 4.4 * PX;
  const s = canvas(w + 2, h + 2);
  const ctx = s.getContext('2d')!;
  const wood = '#7a5232';
  ctx.fillStyle = '#2a1a0e';
  ctx.fillRect(4, 6, 6, h - 4);
  ctx.fillRect(w - 8, 6, 6, h - 4);
  ctx.fillRect(0, 2, w + 2, 9);
  ctx.fillStyle = wood;
  ctx.fillRect(5, 7, 4, h - 6);
  ctx.fillRect(w - 7, 7, 4, h - 6);
  ctx.fillStyle = '#9a6a3e';
  ctx.fillRect(1, 3, w, 7);
  // "ZOO" in a 3×5 pixel font.
  const font: Record<string, string[]> = {
    Z: ['111', '001', '010', '100', '111'],
    O: ['111', '101', '101', '101', '111'],
  };
  ctx.fillStyle = '#f4e3a0';
  'ZOO'.split('').forEach((ch, i) => {
    font[ch].forEach((row, y) =>
      row.split('').forEach((b, x) => b === '1' && ctx.fillRect(w / 2 - 6 + i * 4 + x, 4 + y, 1, 1)),
    );
  });
  return { sprite: s, x: toArtX(0), y: toArtY(GATE_Z), ax: s.width / 2, ay: s.height - 1 };
}

/** Every static standing thing on the map. */
export function buildProps(enclosures: Enclosure[], feeders: Feeder[]): Prop[] {
  const props: Prop[] = [];
  HABITATS.forEach((h, i) => {
    const e = enclosures[i];
    props.push(...fence(h.enclosure.points, h.enclosure.glass ? 'glass' : 'wood'));
    e.trees.forEach((t, k) => props.push(...tree(t.x, t.z, h.enclosure.tallTrees ? 1.45 : 1, i * 31 + k)));
    for (const b of e.boulders) props.push(rock(b.x, b.z, b.r, b.h));
    if (e.warmRock) props.push(rock(e.warmRock.x, e.warmRock.z, e.warmRock.r, e.warmRock.h + 0.3));
    if (e.gym) props.push(...jungleGym(e.gym));
  });
  for (const f of feeders) props.push(feeder(f));
  for (const [x, z] of LAMPS) props.push(...lamp(x, z));
  for (const b of BENCHES) props.push(bench(b.x, b.z));
  // Plaza planter with its tree.
  props.push({
    sprite: blob(4.6 * PX, 2.6 * PX, [{ x: 2.3 * PX, y: 1.3 * PX, rx: 2.3 * PX, ry: 1.3 * PX }], ROCK),
    x: toArtX(PLAZA.x),
    y: toArtY(PLAZA.z) + 1.3 * PX,
    ax: 2.3 * PX + 1,
    ay: 2.6 * PX,
  });
  props.push(...roundTree(PLAZA.x, PLAZA.z + 0.2));
  // Flamingo pond's low fence.
  const ring: [number, number][] = Array.from({ length: 24 }, (_, i) => {
    const a = (i / 24) * Math.PI * 2;
    return [FLAMINGO_POND.x + Math.cos(a) * FLAMINGO_POND.fence, FLAMINGO_POND.z + Math.sin(a) * FLAMINGO_POND.fence];
  });
  props.push(...fence(ring, 'low'));
  // Buildings.
  props.push(buildingProp(STAFF_HUT.x, STAFF_HUT.z, STAFF_HUT.w, STAFF_HUT.d, 2.4, '#c9b08a', '#3f6e3a'));
  props.push(buildingProp(GIFT_SHOP.x, GIFT_SHOP.z, GIFT_SHOP.w, GIFT_SHOP.d, 3, '#efe2c4', '#b5493a'));
  for (const s of STANDS) props.push(buildingProp(s.x, s.z, 2.8, 2.2, 1.8, '#efe2c4', '#d6453a', true));
  props.push(gate());
  props.push(...playground());
  // A few bushes along the avenue, placed by a fixed hash (decoration only).
  for (let z = -16; z <= 22; z += 4) {
    for (const side of [-1, 1]) {
      if (hash2(z, side, 7) < 0.45) continue;
      const s = blob(14, 9, [{ x: 7, y: 5, rx: 7, ry: 4.5 }, { x: 4, y: 3.5, rx: 4, ry: 3 }], BUSH);
      props.push({ sprite: s, x: toArtX(side * 7.2), y: toArtY(z + 1.5), ax: s.width / 2, ay: s.height - 1 });
    }
  }
  return props;
}
