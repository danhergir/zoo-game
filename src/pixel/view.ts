import type * as THREE from 'three';
import type { Ambient } from '../ambient';
import type { Animal } from '../animals/Animal';
import type { Enclosure } from '../enclosure';
import type { Feeder } from '../feeder';
import type { Flamingos } from '../flamingos';
import type { Lagoon } from '../lagoon';
import { LAMPS } from '../layout';
import type { Train } from '../train';
import type { GameState } from '../ui/hud';
import type { Crowd } from '../visitors/Crowd';
import type { Keepers } from '../visitors/Keepers';
import type { ReverseZoo } from '../reverse';
import type { PersonLook } from '../visitors/person';
import type { Visitor } from '../visitors/Visitor';
import type { WeatherState } from '../weather';
import {
  FLAMINGO,
  FLAMINGO_PALETTE,
  PERSON,
  PERSON_SIT,
  TRAIN,
  TRAIN_PALETTE,
  childRows,
  type Directions,
  type Rows,
} from './art';
import { bodyEdge, bubble, butterfly, cloudShadow, feedLoad, flyer, puff, withGesture, withProps, type Bubble } from './extras';
import { MAP_H, MAP_W, PX, bakeProps, buildGround, buildProps, toArtX, toArtY, type Prop } from './map';
import { SPECIES_ART } from './species';
import { cached, canvas, compile, ellipseSprite, glowSprite, hash2, shade, type Sprite } from './sprite';

export interface PixelDeps {
  animals: Animal[];
  crowd: Crowd;
  keepers: Keepers;
  enclosures: Enclosure[];
  feeders: Feeder[];
  flamingos: Flamingos;
  lagoon: Lagoon;
  train: Train;
  reverse: ReverseZoo;
  ambient: Ambient;
  state: GameState;
  weather: WeatherState;
  /** The 3D rig's follow target, shared so the info panel's Follow button works in both views. */
  following: () => THREE.Object3D | null;
  stopFollow: () => void;
  selected: () => Animal | null;
  onPick: (animal: Animal | null) => void;
}

/** CSS pixels per art pixel; only whole steps, so pixels stay square and crisp. */
const MAX_ZOOM = 6;
/**
 * Zoom levels: every whole number of *device* pixels per art pixel, so on a retina screen there
 * are half steps (0.5, 1, 1.5 …) and every level is still perfectly crisp.
 */
function zoomLevels(): number[] {
  const dpr = window.devicePixelRatio || 1;
  const levels: number[] = [];
  // From one device pixel per art pixel (0.5× on retina) up to MAX_ZOOM.
  for (let k = 1; k <= Math.floor(MAX_ZOOM * dpr); k++) levels.push(k / dpr);
  return levels;
}
const START_ZOOM = 3;
/** Pinch distance per zoom step (trackpads report pinches as ctrl+wheel). */
const PINCH_STEP = 20;
const START = { x: -14, z: 0 };
const WALKING = new Set(['wander', 'toFeeder', 'toFence', 'toTree', 'toBed', 'toPole', 'toPond', 'toRock', 'play']);
/** Visitor activities spent sitting down: bench, picnic table, swing, or on the ground (resting, digging in the sand). */
const SITTING = new Set(['sit', 'picnic', 'swing', 'rest', 'dig']);
const BALLOONS = ['#e8453a', '#3d7fd0', '#f0c03a', '#4aa05a', '#c77dff', '#ff7aa8'];
const CARRIAGES = ['#2f6f8f', '#6cc28a', '#ffd23f'];

interface Drawn {
  sprite: Sprite;
  x: number;
  y: number;
  ax: number;
  ay: number;
  shadow?: number;
  animal?: Animal;
  /** Speech bubble shown above an animal (asleep, hungry, unhappy). */
  icon?: Bubble;
  /** Effect drawn with the animal: an elephant's water spray or a lion's roar. */
  effect?: { kind: 'spray' | 'roar'; facing: number };
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t);

/** Which drawing to use for a heading (rotation.y; the models face +z at 0, toward the viewer). */
function facing(yaw: number): { dir: keyof Directions; flip: boolean; dx: number } {
  const dx = Math.sin(yaw);
  const dz = Math.cos(yaw);
  if (Math.abs(dx) > Math.abs(dz) * 0.85) return { dir: 'side', flip: dx < 0, dx };
  return { dir: dz > 0 ? 'front' : 'back', flip: false, dx };
}

/** Draws the shared simulation as a top-down 3/4-view pixel-art zoo. */
export class PixelView {
  readonly canvas = document.createElement('canvas');
  private readonly ctx = this.canvas.getContext('2d')!;
  private readonly art = canvas(1, 1);
  private readonly actx = this.art.getContext('2d')!;
  private readonly ground: Sprite;
  private readonly props: Prop[];
  private zoom = START_ZOOM;
  private camX = toArtX(START.x);
  private camY = toArtY(START.z);
  private readonly keys = new Set<string>();
  /** Distance walked per creature, for the walk cycle. */
  private readonly strides = new WeakMap<object, { x: number; z: number; d: number }>();
  /** Outfit per person, picked once from a hash of their arrival order. */
  private readonly outfits = new WeakMap<PersonLook, Record<string, string>>();
  private nextPerson = 0;
  /** Animals drawn last frame, for clicking. */
  private hits: { animal: Animal; x0: number; y0: number; x1: number; y1: number; y: number }[] = [];
  private view = { left: 0, top: 0, w: 1, h: 1 };
  private readonly glow = glowSprite(26, '#ffd27a');
  private readonly shadows = new Map<number, Sprite>();

  /** On-screen zoom buttons (2D view only). */
  private readonly controls = document.createElement('div');
  private readonly zoomLabel = document.createElement('span');

  constructor(container: HTMLElement, private readonly deps: PixelDeps) {
    this.canvas.className = 'pixel-view';
    container.prepend(this.canvas);
    this.buildControls(container);
    this.ground = buildGround(deps.enclosures);
    const props = buildProps(deps.enclosures, deps.feeders);
    // The forest past the train loop never overlaps anything moving: paint it into the ground once.
    bakeProps(this.ground, props);
    this.props = props.filter((p) => !p.bake);
    this.bindInput();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  /** Centre the view on a world point (and optionally set the zoom). */
  lookAt(x: number, z: number, zoom?: number): void {
    this.camX = toArtX(x);
    this.camY = toArtY(z);
    if (zoom !== undefined) this.zoom = this.nearestLevel(zoom);
  }

  setVisible(on: boolean): void {
    this.canvas.style.display = on ? '' : 'none';
    this.controls.style.display = on ? '' : 'none';
    this.visible = on;
  }

  private visible = true;

  /** Zoom in / out / fit-the-zoo buttons with the current level, plus + − 0 keys. */
  private buildControls(container: HTMLElement): void {
    const button = (label: string, title: string, onClick: () => void) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.title = title;
      b.setAttribute('aria-label', title);
      b.addEventListener('click', onClick);
      return b;
    };
    const center = () => [window.innerWidth / 2, window.innerHeight / 2] as const;
    this.controls.className = 'zoom-controls';
    this.zoomLabel.className = 'zoom-level';
    this.controls.append(
      button('+', 'Zoom in (+)', () => this.stepZoom(1, ...center())),
      this.zoomLabel,
      button('−', 'Zoom out (−)', () => this.stepZoom(-1, ...center())),
      button('⤢', 'Show the whole zoo (0)', () => this.fit()),
    );
    container.append(this.controls);
    window.addEventListener('keydown', (e) => {
      if (!this.visible || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '+' || e.key === '=') this.stepZoom(1, ...center());
      else if (e.key === '-' || e.key === '_') this.stepZoom(-1, ...center());
      else if (e.key === '0') this.fit();
    });
  }

  /** Zoom out to the closest level that shows the whole zoo, centred on it. */
  private fit(): void {
    this.deps.stopFollow();
    // The zoo inside the train loop, roughly x -110..105, z -90..60.
    const w = (215 * PX) / window.innerWidth;
    const h = (150 * PX) / window.innerHeight;
    const want = 1 / Math.max(w, h);
    const levels = zoomLevels();
    this.zoom = [...levels].reverse().find((z) => z <= want) ?? levels[0];
    this.lookAt(-2, -15);
  }

  private resize(): void {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(window.innerWidth * dpr);
    this.canvas.height = Math.round(window.innerHeight * dpr);
  }

  private bindInput(): void {
    let drag: { x: number; y: number; moved: boolean } | null = null;
    this.canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      drag = { x: e.clientX, y: e.clientY, moved: false };
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 5) return;
      if (!drag.moved) this.deps.stopFollow();
      drag.moved = true;
      drag.x = e.clientX;
      drag.y = e.clientY;
      this.camX -= dx / this.zoom;
      this.camY -= dy / this.zoom;
    });
    this.canvas.addEventListener('pointerup', (e) => {
      if (drag && !drag.moved) this.pick(e.clientX, e.clientY);
      drag = null;
    });
    // Map-app controls: on a trackpad, two-finger scroll pans and pinch zooms; a mouse wheel
    // zooms one level per notch. Zoom stays anchored at the cursor.
    let pinch = 0;
    this.canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const px = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1;
        if (e.ctrlKey) {
          pinch -= e.deltaY * px;
          if (Math.abs(pinch) < PINCH_STEP) return;
          this.stepZoom(pinch > 0 ? 1 : -1, e.clientX, e.clientY);
          pinch = 0;
          return;
        }
        // A mouse wheel moves in whole notches (line mode, or ~100px per click with no sideways
        // movement); a trackpad sends small, often fractional deltas, usually with some deltaX.
        const notch = e.deltaMode !== 0 || (e.deltaX === 0 && Math.abs(e.deltaY) >= 50 && Number.isInteger(e.deltaY));
        if (notch) {
          this.stepZoom(e.deltaY < 0 ? 1 : -1, e.clientX, e.clientY);
          return;
        }
        this.deps.stopFollow();
        this.camX += (e.deltaX * px) / this.zoom;
        this.camY += (e.deltaY * px) / this.zoom;
      },
      { passive: false },
    );
    window.addEventListener('keydown', (e) => this.keys.add(e.code));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  private nearestLevel(zoom: number): number {
    return zoomLevels().reduce((best, z) => (Math.abs(z - zoom) < Math.abs(best - zoom) ? z : best));
  }

  /** One zoom level in or out (dir +1 / -1), anchored at the cursor. */
  private stepZoom(dir: number, clientX: number, clientY: number): void {
    const levels = zoomLevels();
    const i = levels.indexOf(this.nearestLevel(this.zoom)) + dir;
    this.zoomTo(levels[Math.max(0, Math.min(levels.length - 1, i))], clientX, clientY);
  }

  /** Change zoom keeping the point under the cursor where it is. */
  private zoomTo(zoom: number, clientX: number, clientY: number): void {
    if (zoom === this.zoom) return;
    const fx = clientX - window.innerWidth / 2;
    const fy = clientY - window.innerHeight / 2;
    this.camX += fx / this.zoom - fx / zoom;
    this.camY += fy / this.zoom - fy / zoom;
    this.zoom = zoom;
  }

  private pick(clientX: number, clientY: number): void {
    const x = this.view.left + clientX / this.zoom;
    const y = this.view.top + clientY / this.zoom;
    const hit = this.hits
      .filter((h) => x >= h.x0 && x <= h.x1 && y >= h.y0 && y <= h.y1)
      .sort((a, b) => b.y - a.y)[0];
    this.deps.onPick(hit?.animal ?? null);
  }

  /** Walk-cycle frame from the distance walked since last frame. */
  private stride(o: object, x: number, z: number): number {
    let s = this.strides.get(o);
    if (!s) this.strides.set(o, (s = { x, z, d: 0 }));
    const step = Math.hypot(x - s.x, z - s.z);
    // Big jumps are teleports (a new day, a reset): don't count them as walking.
    if (step < 1) s.d += step;
    s.x = x;
    s.z = z;
    return Math.floor(s.d / 0.45) % 2;
  }

  private shadow(rx: number): Sprite {
    let s = this.shadows.get(rx);
    if (!s) this.shadows.set(rx, (s = ellipseSprite(rx, Math.max(1, Math.round(rx * 0.4)), 'rgba(20, 30, 10, 0.3)')));
    return s;
  }

  private animal(a: Animal): Drawn | null {
    const art = SPECIES_ART[a.species.id];
    const baby = a.mother !== null && art.baby !== undefined;
    const set = baby ? art.baby! : art.adult;
    const p = a.position;
    const f = facing(a.heading);
    let dir = f.dir;
    let flip = f.flip;
    let pose = 'stand';
    if (a.swimming) pose = 'swim';
    else if ((a.state === 'sleep' && !a.species.huddles) || a.state === 'roll' || a.state === 'bask') pose = 'sleep';
    else if (a.state === 'eat' || a.state === 'browse') pose = 'eat';
    else if (WALKING.has(a.state) && this.stride(a, p.x, p.z) === 1) pose = 'walk';
    // Special poses (lying, grazing, swimming) and babies only exist as side views.
    if ((pose !== 'stand' && pose !== 'walk') || !set[dir].stand) {
      dir = 'side';
      flip = f.dx < 0;
    }
    const frames = set[dir];
    const used = frames[pose] ? pose : 'stand';
    const rows: Rows = frames[used];
    const sprite = cached(`${a.species.id}:${baby}:${dir}:${used}:${flip}`, () => compile(rows, art.palette, flip));
    return {
      sprite,
      x: toArtX(p.x),
      y: toArtY(p.z) - p.y * PX,
      ax: Math.floor(sprite.width / 2),
      ay: sprite.height - 1,
      // Swimmers and climbers cast no ground shadow under their feet.
      shadow: used === 'swim' || a.offGround ? 0 : Math.round(sprite.width * 0.42),
      animal: a,
      icon: a.state === 'sleep' ? 'sleep' : a.hunger < 0.2 && a.state !== 'eat' ? a.feeder.food : a.happiness < 0.3 ? 'unhappy' : undefined,
      effect: a.state === 'spray' && !baby ? { kind: 'spray', facing: flip ? -1 : 1 } : a.roaring ? { kind: 'roar', facing: f.dir === 'side' ? (flip ? -1 : 1) : 0 } : undefined,
    };
  }

  private outfit(v: Visitor): Record<string, string> {
    return this.outfitFor(v.look);
  }

  /** Sprite palette for a person's outfit (cached per outfit). */
  private outfitFor(l: PersonLook): Record<string, string> {
    let o = this.outfits.get(l);
    if (!o) {
      const n = this.nextPerson++;
      const pick = <T,>(list: T[], salt: number) => list[Math.floor(hash2(n, salt, 11) * list.length)];
      // Same colours as their 3D model; a hat shows as the top of the head in the hat's colour.
      const look = { hair: l.hat ?? l.hair ?? '#5a3a22', skin: l.skin, shirt: l.shirt, trousers: l.pants };
      o = {
        o: '#2a2018',
        k: '#1a1410',
        H: look.hair,
        h: shade(look.hair, 0.75),
        S: look.skin,
        s: shade(look.skin, 0.82),
        T: look.shirt,
        t: shade(look.shirt, 0.75),
        P: look.trousers,
        p: shade(look.trousers, 0.75),
        F: '#28241f',
        balloon: pick(BALLOONS, 5),
      };
      this.outfits.set(l, o);
    }
    return o;
  }

  private person(v: Visitor): Drawn | null {
    // Popping in or out at the gate.
    if (v.root.scale.x < 0.4) return null;
    const p = v.position;
    const f = facing(v.root.rotation.y);
    const sitting = v.phase === 'busy' && v.activity !== null && SITTING.has(v.activity.kind);
    const moving = v.phase === 'walking' || v.phase === 'leaving';
    const pose = sitting ? 'sit' : moving && this.stride(v, p.x, p.z) === 1 ? 'walk' : 'stand';
    const outfit = this.outfit(v);
    const item = v.keeper ? null : v.item;
    const umbrella = v.umbrella && !v.keeper && !sitting;
    const gesture = v.keeper || sitting ? null : v.gestureNow;
    const flashing = gesture === 'photo' && v.flashing;
    const wave = gesture === 'wave' ? Math.floor(performance.now() / 220) % 2 : 0;
    // Keepers on a feeding run carry the food.
    const feed = v.keeper && v.activity?.kind === 'feed' ? v.activity.feeder.food : null;
    const key = `person:${Object.values(outfit).join('')}:${v.child}:${f.dir}:${pose}:${f.flip}:${item}:${umbrella}:${gesture}:${flashing}:${wave}:${feed}`;
    const sprite = cached(key, () => {
      const rows = pose === 'sit' ? PERSON_SIT[f.dir] : PERSON[f.dir][pose] ?? PERSON[f.dir].stand;
      // Children: shorter body (and legs, unless they're folded up sitting).
      const kid = v.child ? (pose === 'sit' ? rows.filter((_, i) => i !== 9) : childRows(rows)) : rows;
      let s = compile(kid, outfit, f.flip);
      if (item || umbrella) s = withProps(s, item, umbrella, item === 'balloon' ? outfit.balloon : outfit.T, f.dir === 'side', f.flip).sprite;
      if (gesture) s = withGesture(s, gesture, flashing, f.dir === 'side', f.flip, wave);
      if (feed) {
        const load = feedLoad(feed);
        const c = canvas(s.width + 2, s.height);
        const g = c.getContext('2d')!;
        g.drawImage(s, 1, 0);
        // Held in front: at the leading hand from the side, at the chest from front/back.
        const edge = 1 + bodyEdge(s, s.height - 9, f.flip ? -1 : 1);
        const hx = f.dir === 'side' ? (f.flip ? edge - load.width + 1 : edge) : Math.floor(c.width / 2 - load.width / 2);
        if (f.dir !== 'back') g.drawImage(load, hx, s.height - 9);
        s = c;
      }
      return s;
    });
    // A little hop when a lion roars nearby.
    const hop = v.startled ? 2 : 0;
    return { sprite, x: toArtX(p.x), y: toArtY(p.z) - p.y * PX, ax: Math.floor(sprite.width / 2), ay: sprite.height - 1 + hop, shadow: sitting ? 0 : 4 };
  }

  /** The reverse zoo: animals touring the paths, people in the enclosures and in the water. */
  private reverseZoo(out: Drawn[]): void {
    const scene = this.deps.reverse.scene2d;
    const frame = Math.floor(performance.now() / 260) % 2;
    for (const t of scene.tourists) {
      const art = SPECIES_ART[t.species];
      const f = facing(t.yaw);
      const pose = t.napping ? 'sleep' : t.walking && frame ? 'walk' : 'stand';
      const dir = pose === 'sleep' ? 'side' : f.dir;
      const flip = dir === 'side' ? f.dx < 0 : false;
      const frames = art.adult[dir];
      const used = frames[pose] ? pose : 'stand';
      const sprite = cached(`${t.species}:false:${dir}:${used}:${flip}`, () => compile(frames[used], art.palette, flip));
      out.push({ sprite, x: toArtX(t.x), y: toArtY(t.z), ax: Math.floor(sprite.width / 2), ay: sprite.height - 1, shadow: Math.round(sprite.width * 0.42) });
    }
    for (const v of scene.captives) {
      const d = this.person(v);
      if (d) out.push(d);
    }
    for (const e of scene.extras) {
      const outfit = this.outfitFor(e.look);
      const f = facing(e.yaw);
      const sprite = cached(`extra:${Object.values(outfit).join('')}:${e.kind}:${e.child}:${f.dir}:${f.flip}`, () => {
        const rows = e.kind === 'snorkel' ? PERSON.back.stand.slice(0, 7) : e.kind === 'ring' ? PERSON.front.stand.slice(0, 9) : PERSON[f.dir].stand;
        const base = compile(e.child && e.kind === 'flamingo' ? childRows(rows) : rows, outfit, f.flip);
        if (e.kind === 'flamingo') return base;
        // In the water: ripples around the head (and a red swim ring).
        const s = canvas(base.width + 4, base.height + 2);
        const c = s.getContext('2d')!;
        c.drawImage(base, 2, 0);
        c.fillStyle = e.kind === 'ring' ? '#e8443a' : '#cfe8f0';
        c.fillRect(0, s.height - 3, s.width, 2);
        c.fillStyle = '#2a2018';
        c.fillRect(0, s.height - 1, s.width, 1);
        return s;
      });
      out.push({ sprite, x: toArtX(e.x), y: toArtY(e.z), ax: Math.floor(sprite.width / 2), ay: sprite.height - 1, shadow: e.kind === 'flamingo' ? 4 : 0 });
    }
  }

  private flamingos(out: Drawn[]): void {
    for (const b of this.deps.flamingos.poses) {
      const flip = Math.sin(b.yaw) < 0;
      const sprite = cached(`flamingo:${b.pose}:${flip}`, () => compile(FLAMINGO[b.pose], FLAMINGO_PALETTE, flip));
      out.push({ sprite, x: toArtX(b.x), y: toArtY(b.z), ax: Math.floor(sprite.width / 2), ay: sprite.height - 1, shadow: 3 });
    }
  }

  private train(out: Drawn[]): void {
    this.deps.train.carPoses.forEach((c, i) => {
      const f = facing(c.yaw);
      const engine = i === 0;
      const color = CARRIAGES[(i - 1) % CARRIAGES.length] ?? CARRIAGES[0];
      const rows = f.dir === 'side' ? (engine ? TRAIN.engine : TRAIN.car) : engine ? TRAIN.engineFront : TRAIN.carFront;
      const sprite = cached(`train:${i}:${f.dir === 'side'}:${f.flip}`, () =>
        compile(rows, { ...TRAIN_PALETTE, C: color, c: shade(color, 0.7) }, f.flip),
      );
      out.push({ sprite, x: toArtX(c.x), y: toArtY(c.z), ax: Math.floor(sprite.width / 2), ay: sprite.height - 1, shadow: Math.round(sprite.width * 0.45) });
    });
  }

  render(dt: number): void {
    const { ctx, actx, deps } = this;
    // Camera: follow the selected animal if asked, else WASD.
    const follow = deps.following();
    if (follow) {
      this.camX += (toArtX(follow.position.x) - this.camX) * Math.min(1, dt * 6);
      this.camY += (toArtY(follow.position.z) - this.camY) * Math.min(1, dt * 6);
    }
    const speed = (240 / this.zoom) * dt;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) this.camX -= speed;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) this.camX += speed;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) this.camY -= speed;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) this.camY += speed;

    const dpr = window.devicePixelRatio || 1;
    const scale = Math.max(1, Math.round(this.zoom * dpr));
    const w = Math.ceil(this.canvas.width / scale);
    const h = Math.ceil(this.canvas.height / scale);
    if (this.art.width !== w || this.art.height !== h) {
      this.art.width = w;
      this.art.height = h;
    }
    // Keep the view on the map: it ends at the forest past the train loop.
    this.camX = MAP_W > w ? Math.min(MAP_W - w / 2, Math.max(w / 2, this.camX)) : MAP_W / 2;
    this.camY = MAP_H > h ? Math.min(MAP_H - h / 2, Math.max(h / 2, this.camY)) : MAP_H / 2;
    const left = Math.round(this.camX - w / 2);
    const top = Math.round(this.camY - h / 2);
    this.view = { left, top, w, h };

    actx.globalCompositeOperation = 'source-over';
    actx.fillStyle = '#5c9a3d';
    actx.fillRect(0, 0, w, h);
    actx.drawImage(this.ground, left, top, w, h, 0, 0, w, h);
    this.underwater(left, top, w, h);
    this.cloudShadows(left, top, w, h);

    // Everything standing, sorted back to front.
    const drawn: Drawn[] = [];
    const flat: Prop[] = [];
    const night = this.nightAmount();
    for (const p of this.props) {
      if (p.when && (p.when === 'night') !== night > 0.5) continue;
      const x0 = p.x - p.ax;
      const y0 = p.y - p.ay;
      if (x0 > left + w || y0 > top + h || x0 + p.sprite.width < left || y0 + p.sprite.height < top) continue;
      (p.layer === 'shadow' ? flat : drawn).push(p);
    }
    this.hits = [];
    if (deps.reverse.active) {
      this.reverseZoo(drawn);
    } else {
      for (const a of deps.animals) {
        const d = this.animal(a);
        if (d) drawn.push(d);
      }
      for (const v of [...deps.crowd.visitors, ...deps.keepers.active]) {
        const d = this.person(v);
        if (d) drawn.push(d);
      }
    }
    this.flamingos(drawn);
    this.train(drawn);
    this.butterflies(drawn);
    drawn.sort((a, b) => a.y - b.y);
    // Shadows first, so nothing standing gets darkened by a neighbour's shadow.
    for (const p of flat) actx.drawImage(p.sprite, Math.round(p.x - p.ax - left), Math.round(p.y - p.ay - top));
    for (const d of drawn) {
      if (!d.shadow) continue;
      const s = this.shadow(d.shadow);
      actx.drawImage(s, Math.round(d.x - left - s.width / 2), Math.round(d.y - top - s.height / 2));
    }
    const selected = deps.selected();
    let marker: { x: number; y: number } | null = null;
    const icons: { x: number; y: number; icon: Bubble }[] = [];
    for (const d of drawn) {
      const x = Math.round(d.x - d.ax - left);
      const y = Math.round(d.y - d.ay - top);
      actx.drawImage(d.sprite, x, y);
      if (d.animal) {
        this.hits.push({ animal: d.animal, x0: x + left, y0: y + top, x1: x + left + d.sprite.width, y1: y + top + d.sprite.height, y: d.y });
        if (d.animal === selected) marker = { x: x + Math.floor(d.sprite.width / 2), y: y - 3 };
      }
      if (d.icon) icons.push({ x: x + Math.floor(d.sprite.width / 2) + 3, y: y - 9, icon: d.icon });
      if (d.effect) this.effect(d.effect, x, y, d.sprite.width);
    }
    this.overhead(left, top, w, h);

    this.light(night, left, top, w, h);
    this.rain(w, h);
    // Bubbles stay readable at night, so they're drawn after the light.
    for (const i of icons) {
      const b = cached(`bubble:${i.icon}`, () => bubble(i.icon));
      actx.drawImage(b, i.x, i.y);
    }

    // Selection marker: a little bobbing arrow above the inspected animal.
    if (marker) {
      const bob = Math.round(Math.sin(performance.now() / 180));
      actx.fillStyle = '#2a2018';
      actx.fillRect(marker.x - 3, marker.y - 5 + bob, 7, 2);
      actx.fillRect(marker.x - 2, marker.y - 3 + bob, 5, 1);
      actx.fillRect(marker.x - 1, marker.y - 2 + bob, 3, 1);
      actx.fillStyle = '#ffe066';
      actx.fillRect(marker.x - 2, marker.y - 4 + bob, 5, 1);
      actx.fillRect(marker.x - 1, marker.y - 3 + bob, 3, 1);
    }

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.art, 0, 0, w, h, 0, 0, w * scale, h * scale);
    const label = `${this.zoom}×`;
    if (this.zoomLabel.textContent !== label) this.zoomLabel.textContent = label;
  }

  private readonly cloudSprites = [0, 1, 2, 3].map((i) => cloudShadow(i, PX));

  /** Cloud shadows drifting over the ground (faint, under everything standing). */
  private cloudShadows(left: number, top: number, w: number, h: number): void {
    const { actx } = this;
    actx.globalAlpha = 0.14;
    for (const c of this.deps.ambient.sky.clouds) {
      const s = this.cloudSprites[c.seed % this.cloudSprites.length];
      const x = Math.round(toArtX(c.x) - left - s.width / 2);
      const y = Math.round(toArtY(c.z) - top - s.height / 2);
      if (x > w || y > h || x + s.width < 0 || y + s.height < 0) continue;
      actx.drawImage(s, x, y);
    }
    actx.globalAlpha = 1;
  }

  /** Butterflies flutter low among everything else (a fixed-size sprite, so they don't flicker). */
  private butterflies(out: Drawn[]): void {
    for (const b of this.deps.ambient.sky.butterflies) {
      const open = b.flap > 0.5;
      const sprite = cached(`butterfly:${b.color}:${open}`, () => butterfly(open, b.color));
      out.push({ sprite, x: toArtX(b.x), y: toArtY(b.z), ax: 1, ay: 1 + Math.round(b.y * PX) });
    }
  }

  /** Things above the scene: birds and gulls, train smoke, balloons drifting away. */
  private overhead(left: number, top: number, w: number, h: number): void {
    const { actx, deps } = this;
    const sky = deps.ambient.sky;
    const visible = (x: number, y: number) => x > -20 && y > -20 && x < w + 20 && y < h + 20;
    for (const [list, gull] of [[sky.birds, false], [sky.gulls, true]] as const) {
      for (const b of list) {
        // High fliers are drawn a little above where they are, as in the 3/4 view.
        const x = Math.round(toArtX(b.x) - left - 2);
        const y = Math.round(toArtY(b.z) - b.y * PX * 0.3 - top);
        if (!visible(x, y)) continue;
        const up = b.flap > 0.5;
        actx.drawImage(cached(`flyer:${up}:${gull}`, () => flyer(up, gull)), x, y);
      }
    }
    for (const p of deps.train.smokePuffs) {
      const r = Math.max(2, Math.round(p.size * 2.2));
      const s = cached(`puff:${r}`, () => puff(r));
      const x = Math.round(toArtX(p.x) - left - r);
      const y = Math.round(toArtY(p.z) - p.y * PX - top - r);
      if (!visible(x, y)) continue;
      actx.globalAlpha = Math.max(0.15, 1 - (p.size - 0.5) / 1.8);
      actx.drawImage(s, x, y);
    }
    actx.globalAlpha = 1;
    for (const b of deps.crowd.lostBalloons) {
      const x = Math.round(toArtX(b.x) - left);
      const y = Math.round(toArtY(b.z) - b.y * PX - top);
      if (!visible(x, y)) continue;
      actx.fillStyle = '#e8e4dc';
      actx.fillRect(x, y + 4, 1, 4);
      actx.fillStyle = '#2a2018';
      actx.fillRect(x - 2, y - 1, 5, 6);
      actx.fillStyle = b.color;
      actx.fillRect(x - 1, y, 3, 4);
      actx.fillStyle = shade(b.color, 1.4);
      actx.fillRect(x - 1, y, 1, 1);
    }
  }

  /** An elephant's spray (an arc of droplets over its back) or a lion's roar (sound lines). */
  private effect(e: { kind: 'spray' | 'roar'; facing: number }, x: number, y: number, width: number): void {
    const { actx } = this;
    const t = performance.now() / 1000;
    if (e.kind === 'spray') {
      // From the trunk at the front, up and back over the body.
      const fx = e.facing > 0 ? x + width - 3 : x + 2;
      for (let k = 0; k < 10; k++) {
        const u = (t * 1.3 + k / 10) % 1;
        const dx = -e.facing * u * width * 0.9;
        const dy = -Math.sin(u * Math.PI) * 14;
        actx.fillStyle = k % 2 ? '#e4f4ff' : '#7cc8e8';
        actx.fillRect(Math.round(fx + dx), Math.round(y + 6 + dy), 1, 2);
      }
      return;
    }
    // Roar: nested arcs beside the head (in front of the mouth from the side), pulsing outwards.
    const pulse = Math.floor(t * 8) % 2;
    const arc = (cx: number, cy: number, dir: number) => {
      actx.fillRect(cx, cy - 2, 1, 1);
      actx.fillRect(cx + dir, cy - 1, 1, 3);
      actx.fillRect(cx, cy + 2, 1, 1);
    };
    actx.fillStyle = '#fbf8f0';
    for (const r of [2 + pulse, 5 + pulse]) {
      if (e.facing >= 0) arc(x + width + r - 2, y + 6, 1);
      if (e.facing <= 0) arc(x - r + 1, y + 6, -1);
    }
  }

  /** Reef lagoon life, seen from above through the water (drawn before anything standing). */
  private underwater(left: number, top: number, w: number, h: number): void {
    const { actx } = this;
    const lx = toArtX(84) - left;
    const ly = toArtY(-6) - top;
    if (lx < -140 || ly < -140 || lx > w + 140 || ly > h + 140) return;
    actx.globalAlpha = 0.85;
    for (const c of this.deps.lagoon.creatures) {
      const x = Math.round(toArtX(c.x) - left);
      const y = Math.round(toArtY(c.z) - top);
      const dx = Math.sin(c.yaw);
      const dz = Math.cos(c.yaw);
      const dot = (ox: number, oy: number, color: string) => {
        actx.fillStyle = color;
        actx.fillRect(x + Math.round(ox), y + Math.round(oy), 1, 1);
      };
      if (c.kind === 'fish') {
        dot(0, 0, c.color);
        dot(-dx, -dz, shade(c.color, 0.7));
      } else if (c.kind === 'shark') {
        for (let i = -4; i <= 4; i++) {
          dot(dx * i, dz * i, c.color);
          dot(dx * i - dz * 0.6, dz * i + dx * 0.6, c.color);
        }
        dot(0, 0, shade(c.color, 0.6));
        dot(-dx * 5, -dz * 5, shade(c.color, 0.7));
      } else {
        // Ray (wide diamond) or turtle (shell with a head).
        const r = c.kind === 'ray' ? 2 : 1;
        actx.fillStyle = c.color;
        actx.fillRect(x - r, y - 1, r * 2 + 1, 3);
        actx.fillRect(x - r - 1, y, r * 2 + 3, 1);
        if (c.kind === 'turtle') dot(dx * 2.5, dz * 2.5, '#7aa860');
        else dot(-dx * 3, -dz * 3, shade(c.color, 0.7));
      }
    }
    actx.globalAlpha = 1;
  }

  /** Falling rain streaks (screen-space, purely visual). */
  private rain(w: number, h: number): void {
    const amount = this.deps.weather.rain;
    if (amount < 0.02) return;
    const { actx } = this;
    const t = performance.now() / 1000;
    const count = Math.round((w * h * amount) / 90);
    actx.fillStyle = 'rgba(205, 222, 255, 0.55)';
    for (let i = 0; i < count; i++) {
      const speed = 0.7 + 0.6 * hash2(i, 3);
      const y = ((hash2(i, 2) * (h + 8) + t * 150 * speed) % (h + 8)) - 4;
      const x = (((hash2(i, 1) * w - y * 0.3) % w) + w) % w;
      actx.fillRect(Math.round(x), Math.round(y), 1, 3);
    }
  }

  /** 0 by day, 1 at night (the same curve that switches the 3D lamps on). */
  private nightAmount(): number {
    const elevation = Math.sin(((this.deps.state.hour - 6) / 12) * Math.PI);
    return 1 - smoothstep(-0.05, 0.15, elevation);
  }

  /** Day/night colour over everything, then lamp light at night. */
  private light(night: number, left: number, top: number, w: number, h: number): void {
    const { actx, deps } = this;
    const elevation = Math.sin(((deps.state.hour - 6) / 12) * Math.PI);
    const daylight = smoothstep(-0.12, 0.3, elevation);
    const dusk = Math.exp(-(elevation * elevation) / 0.03) * 0.75;
    let tint = mix([62, 74, 132], [255, 255, 255], daylight);
    tint = mix(tint, [255, 168, 118], dusk * 0.35);
    tint = mix(tint, [196, 202, 214], deps.weather.cloud * 0.35 * daylight);
    // Rain dims the day a little more.
    tint = mix(tint, [150, 160, 178], deps.weather.rain * 0.3 * daylight);
    if (tint.some((v) => v < 254)) {
      actx.globalCompositeOperation = 'multiply';
      actx.fillStyle = `rgb(${tint.map(Math.round).join(',')})`;
      actx.fillRect(0, 0, w, h);
    }
    if (night > 0.02) {
      actx.globalCompositeOperation = 'lighter';
      actx.globalAlpha = night * 0.32;
      for (const [x, z] of LAMPS) {
        const gx = Math.round(toArtX(x) - left - this.glow.width / 2);
        const gy = Math.round(toArtY(z) - top - this.glow.height / 2);
        if (gx > w || gy > h || gx + this.glow.width < 0 || gy + this.glow.height < 0) continue;
        actx.drawImage(this.glow, gx, gy);
      }
      actx.globalAlpha = 1;
      // Lamp heads glow on top of the dark.
      actx.globalCompositeOperation = 'source-over';
      for (const p of this.props) {
        if (p.when !== 'night') continue;
        actx.drawImage(p.sprite, Math.round(p.x - p.ax - left), Math.round(p.y - p.ay - top));
      }
    }
    actx.globalCompositeOperation = 'source-over';
  }
}

