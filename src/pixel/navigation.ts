import type * as THREE from 'three';
import type { Animal } from '../animals/Animal';
import type { SpeciesId } from '../animals/species';
import type { Enclosure } from '../enclosure';
import { HABITATS } from '../habitats';
import { FLAMINGO_POND, GIFT_SHOP, LAGOON, PLAYGROUND, TRAIN_TRACK } from '../layout';
import type { Train } from '../train';
import type { Crowd } from '../visitors/Crowd';
import { PX, toArtX, toArtY } from './map';
import type { Sprite } from './sprite';

/** A named spot worth jumping to: every enclosure, plus the lagoon, flamingos, playground and shop. */
export interface Place {
  name: string;
  icon: string;
  x: number;
  z: number;
}

const ICONS: Record<SpeciesId, string> = { zebra: '🦓', elephant: '🐘', lion: '🦁', giraffe: '🦒', penguin: '🐧', monkey: '🐒' };

export const PLACES: Place[] = [
  ...HABITATS.map((h) => {
    const pts = h.enclosure.points;
    return {
      name: h.enclosure.name,
      icon: ICONS[h.species],
      x: pts.reduce((s, p) => s + p[0], 0) / pts.length,
      z: pts.reduce((s, p) => s + p[1], 0) / pts.length,
    };
  }),
  { name: LAGOON.name, icon: '🐠', x: LAGOON.x, z: LAGOON.z },
  { name: FLAMINGO_POND.name, icon: '🦩', x: FLAMINGO_POND.x, z: FLAMINGO_POND.z },
  { name: 'Playground', icon: '🛝', x: PLAYGROUND.slide.ladder.x - 2, z: PLAYGROUND.slide.ladder.z + 2 },
  { name: 'Gift shop', icon: '🎁', x: GIFT_SHOP.x, z: GIFT_SHOP.z },
];

export interface Camera {
  /** World point at the centre of the view, and CSS pixels per world unit. */
  x: number;
  z: number;
  scale: number;
}

/** Names over each place when zoomed out; click one to fly there. */
export class MapLabels {
  readonly root = document.createElement('div');
  private readonly labels: HTMLButtonElement[];

  constructor(container: HTMLElement, onPick: (p: Place) => void) {
    this.root.className = 'map-labels';
    this.labels = PLACES.map((p) => {
      const b = document.createElement('button');
      b.className = 'map-label';
      b.textContent = `${p.icon} ${p.name}`;
      b.addEventListener('click', () => onPick(p));
      this.root.append(b);
      return b;
    });
    container.append(this.root);
  }

  /** Shown only when zoomed out far enough that places are hard to tell apart. */
  update(cam: Camera, zoom: number): void {
    const show = zoom <= 1.5;
    this.root.style.display = show ? '' : 'none';
    if (!show) return;
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    PLACES.forEach((p, i) => {
      const x = cx + (p.x - cam.x) * cam.scale;
      const y = cy + (p.z - cam.z) * cam.scale;
      this.labels[i].style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -50%)`;
    });
  }
}

/** Area the minimap covers: the train loop and a little margin. */
const MINI = { x0: TRAIN_TRACK.x - TRAIN_TRACK.rx - 4, x1: TRAIN_TRACK.x + TRAIN_TRACK.rx + 4, z0: TRAIN_TRACK.z - TRAIN_TRACK.rz - 4, z1: TRAIN_TRACK.z + TRAIN_TRACK.rz + 4 };
const MINI_W = 196;
const MINI_H = Math.round((MINI_W * (MINI.z1 - MINI.z0)) / (MINI.x1 - MINI.x0));
const DOT: Record<SpeciesId, string> = { zebra: '#ffffff', elephant: '#b8bbc0', lion: '#f0b040', giraffe: '#e8c070', penguin: '#2a2e36', monkey: '#9a6a3e' };

/** A small overview in a corner: the zoo, animals as dots, and the current view as a rectangle. Click or drag to move. */
export class Minimap {
  readonly root = document.createElement('div');
  private readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private readonly base = document.createElement('canvas');
  private frame = 0;
  private dpr = 0;

  constructor(
    container: HTMLElement,
    private readonly ground: Sprite,
    onMove: (x: number, z: number, glide: boolean) => void,
  ) {
    this.root.className = 'minimap';
    this.canvas.style.width = `${MINI_W}px`;
    this.canvas.style.height = `${MINI_H}px`;
    this.ctx = this.canvas.getContext('2d')!;
    this.resize();
    this.root.append(this.canvas);
    container.append(this.root);

    const toWorld = (e: PointerEvent) => {
      const r = this.canvas.getBoundingClientRect();
      return [MINI.x0 + ((e.clientX - r.left) / r.width) * (MINI.x1 - MINI.x0), MINI.z0 + ((e.clientY - r.top) / r.height) * (MINI.z1 - MINI.z0)] as const;
    };
    let dragging = false;
    this.canvas.addEventListener('pointerdown', (e) => {
      dragging = true;
      this.canvas.setPointerCapture(e.pointerId);
      onMove(...toWorld(e), true);
    });
    this.canvas.addEventListener('pointermove', (e) => dragging && onMove(...toWorld(e), false));
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) this.canvas.addEventListener(type, () => (dragging = false));
  }

  /** Sharp at the screen's pixel ratio: re-shrinks the map when that changes. */
  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    if (dpr === this.dpr) return;
    this.dpr = dpr;
    for (const c of [this.canvas, this.base]) {
      c.width = Math.round(MINI_W * dpr);
      c.height = Math.round(MINI_H * dpr);
    }
    // The map, shrunk once (smoothing on: this is an overview, not pixel art).
    const b = this.base.getContext('2d')!;
    b.imageSmoothingQuality = 'high';
    b.drawImage(this.ground, toArtX(MINI.x0), toArtY(MINI.z0), (MINI.x1 - MINI.x0) * PX, (MINI.z1 - MINI.z0) * PX, 0, 0, this.base.width, this.base.height);
    this.frame = 0;
  }

  /** Redrawn every few frames: dots don't need 60 fps. */
  update(cam: Camera, animals: Animal[], train: Train): void {
    if (this.frame++ % 4 !== 0) return;
    const { ctx, canvas } = this;
    const sx = canvas.width / (MINI.x1 - MINI.x0);
    const sz = canvas.height / (MINI.z1 - MINI.z0);
    const px = (x: number) => (x - MINI.x0) * sx;
    const pz = (z: number) => (z - MINI.z0) * sz;
    ctx.drawImage(this.base, 0, 0);
    const d = Math.max(2, Math.round(sx * 1.6));
    for (const a of animals) {
      ctx.fillStyle = DOT[a.species.id];
      ctx.fillRect(Math.round(px(a.position.x) - d / 2), Math.round(pz(a.position.z) - d / 2), d, d);
    }
    for (const c of train.carPoses) {
      ctx.fillStyle = '#d6453a';
      ctx.fillRect(Math.round(px(c.x) - d), Math.round(pz(c.z) - d), d * 2, d * 2);
    }
    // The current view.
    const halfW = window.innerWidth / 2 / cam.scale;
    const halfH = window.innerHeight / 2 / cam.scale;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(1, Math.round(this.dpr * 1.5));
    ctx.strokeRect(px(cam.x - halfW), pz(cam.z - halfH), halfW * 2 * sx, halfH * 2 * sz);
  }
}

/** One button per place (keys 1–9, 0 for the whole zoo is the zoom panel's). */
export class QuickJump {
  readonly root = document.createElement('div');

  constructor(container: HTMLElement, onPick: (p: Place) => void) {
    this.root.className = 'quick-jump';
    PLACES.slice(0, 9).forEach((p, i) => {
      const b = document.createElement('button');
      b.textContent = p.icon;
      b.title = `${p.name} (${i + 1})`;
      b.setAttribute('aria-label', `Go to ${p.name}`);
      b.addEventListener('click', () => onPick(p));
      this.root.append(b);
    });
    container.append(this.root);
    window.addEventListener('keydown', (e) => {
      if (this.root.style.display === 'none' || e.metaKey || e.ctrlKey || e.altKey) return;
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= 9 && PLACES[n - 1]) onPick(PLACES[n - 1]);
    });
  }
}

export interface Highlight {
  message: string;
  /** Where to look, and something to follow there (an animal), if any. */
  x: number;
  z: number;
  follow?: THREE.Object3D;
}

/**
 * Spots moments worth watching (feeding time, a roar, a shower, the train leaving, a lost
 * balloon) from the simulation's state, without changing it. Rate-limited so it never spams.
 */
export class Highlights {
  private lastAny = -Infinity;
  private readonly lastKind = new Map<string, number>();
  private feeding = new Set<string>();
  private roaring = new Set<Animal>();
  private spraying = new Set<Animal>();
  private trainRunning = false;
  private balloons = 0;
  private primed = false;

  constructor(
    private readonly animals: Animal[],
    private readonly enclosures: Enclosure[],
    private readonly train: Train,
  ) {}

  /**
   * The newest highlight this frame, if one is due. `now` in ms; whether the train is puffing
   * smoke and the balloons drifting off are passed in, as the view already read them this frame.
   */
  check(now: number, smoking: boolean, lost: Crowd['lostBalloons']): Highlight | null {
    const found: { kind: string; h: Highlight }[] = [];
    const feeding = new Set(this.enclosures.filter((e) => e.feedingNow).map((e) => e.name));
    for (const name of feeding) {
      if (this.feeding.has(name)) continue;
      const p = PLACES.find((pl) => pl.name === name);
      if (p) found.push({ kind: `feed:${name}`, h: { message: `🍽️ Feeding time at ${name}`, x: p.x, z: p.z } });
    }
    this.feeding = feeding;
    const roaring = new Set(this.animals.filter((a) => a.roaring));
    for (const a of roaring) {
      if (!this.roaring.has(a)) found.push({ kind: 'roar', h: { message: `🦁 ${a.name} roars at the visitors!`, x: a.position.x, z: a.position.z, follow: a.root } });
    }
    this.roaring = roaring;
    const spraying = new Set(this.animals.filter((a) => a.state === 'spray' && a.mother === null));
    for (const a of spraying) {
      if (!this.spraying.has(a)) found.push({ kind: 'spray', h: { message: `🐘 ${a.name} is taking a shower`, x: a.position.x, z: a.position.z, follow: a.root } });
    }
    this.spraying = spraying;
    if (smoking && !this.trainRunning) {
      const engine = this.train.carPoses[0];
      found.push({ kind: 'train', h: { message: '🚂 The zoo train is leaving the station', x: engine.x, z: engine.z } });
    }
    this.trainRunning = smoking;
    if (lost.length > this.balloons) {
      const b = lost[lost.length - 1];
      found.push({ kind: 'balloon', h: { message: '🎈 A balloon got away!', x: b.x, z: b.z } });
    }
    this.balloons = lost.length;
    // Don't announce whatever happens to be going on when the page opens.
    if (!this.primed) {
      this.primed = true;
      return null;
    }
    if (now - this.lastAny < 15000) return null;
    for (const f of found) {
      if (now - (this.lastKind.get(f.kind) ?? -Infinity) < 90000) continue;
      this.lastAny = now;
      this.lastKind.set(f.kind, now);
      return f.h;
    }
    return null;
  }
}
