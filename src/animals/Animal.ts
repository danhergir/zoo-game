import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { Enclosure } from '../enclosure';
import type { Feeder } from '../feeder';
import type { Spot } from '../layout';
import type { Rng } from '../rng';
import { buildModel, poseLegs, type AnimalModel } from './models';
import type { SpeciesDef } from './species';

export type AnimalState =
  | 'idle'
  | 'wander'
  | 'toFeeder'
  | 'eat'
  | 'sleep'
  | 'toBed'
  | 'toFence'
  | 'greet'
  | 'toTree'
  | 'browse';

const STATE_LABEL: Record<AnimalState, string> = {
  idle: 'Relaxing',
  wander: 'Wandering',
  toFeeder: 'Heading to food',
  eat: 'Eating',
  sleep: 'Sleeping',
  toBed: 'Off to the huddle',
  toFence: 'Coming to see the visitors',
  greet: 'Saying hello to visitors',
  toTree: 'Heading to a tree',
  browse: 'Nibbling leaves',
};

/** States an animal can drop when it gets hungry or sleepy. */
const INTERRUPTIBLE: AnimalState[] = ['idle', 'wander', 'toFence', 'greet', 'toTree', 'browse'];

const { clamp, lerp } = THREE.MathUtils;

function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export class Animal {
  readonly name: string;
  readonly species: SpeciesDef;
  readonly male: boolean;
  readonly enclosure: Enclosure;
  readonly feeder: Feeder;
  readonly root: THREE.Group;
  readonly radius: number;

  /** 1 = full, 0 = starving. */
  hunger = 1;
  energy = 1;
  happiness = 0.8;
  state: AnimalState = 'sleep';
  /** All of this animal's random choices come from here (see reset). */
  private rng: Rng;

  private readonly model: AnimalModel;
  private readonly target = new THREE.Vector3();
  /** Waypoints to `target` around obstacles; the last one is the target itself. */
  private path: THREE.Vector3[] = [];
  private stateTime = 0;
  private moveTime = 0;
  private yaw = 0;
  private stride = 0;
  private time = 0;
  private walking = false;
  private lookYaw = 0;
  private lookTimer = 0;
  // Each animal keeps its own schedule so they don't all drop at once.
  private bedtime = 20;
  private wakeTime = 6.5;
  /** Fence spot claimed while coming over to say hello. */
  private fenceSpot: Spot | null = null;
  /** Seconds until a greeting lion roars (Infinity = not this time). */
  private roarIn = Infinity;
  private roarTime = 0;
  private roared = false;
  /** Seconds left eating a treat from a visitor's hand. */
  private treatTime = 0;
  /** Tree being browsed (giraffes). */
  private tree: { x: number; z: number } | null = null;
  /** Swimmers: seconds until the next dive, and how long the current dive lasts. */
  private diveIn = 0;
  private diveTime = 0;

  private readonly bubbleEl = document.createElement('div');
  private readonly bubble: CSS2DObject;
  private bubbleText = '';

  /** `rng` sets this animal's size; seed it the same everywhere. */
  constructor(species: SpeciesDef, name: string, male: boolean, enclosure: Enclosure, feeder: Feeder, rng: Rng) {
    this.rng = rng;
    this.species = species;
    this.name = name;
    this.male = male;
    this.enclosure = enclosure;
    this.feeder = feeder;

    this.model = buildModel(species.id, male);
    this.root = this.model.root;
    const scale = rng.float(0.88, 1.08);
    this.root.scale.setScalar(scale);
    this.radius = species.radius * scale;
    this.root.userData.pick = { kind: 'animal', animal: this };

    this.bubbleEl.className = 'bubble';
    this.bubble = new CSS2DObject(this.bubbleEl);
    this.bubble.visible = false;
    this.bubble.position.y = this.model.height + 0.5;
    this.root.add(this.bubble);
  }

  /**
   * Start of a zoo day (the nightly reset): asleep at a seeded spot with fresh
   * needs. Every browser resets with the same rng, so everyone's zoo matches.
   */
  reset(rng: Rng): void {
    this.rng = rng;
    this.hunger = rng.float(0.7, 1);
    this.energy = rng.float(0.6, 0.9);
    this.happiness = 0.8;
    this.bedtime = rng.float(19.5, 21);
    this.wakeTime = rng.float(5.5, 7.5);
    this.enclosure.randomPoint(this.radius + 1, rng, this.root.position);
    this.yaw = rng.float(0, Math.PI * 2);
    this.root.rotation.y = this.yaw;
    this.time = rng.float(0, 100);
    this.stride = 0;
    this.walking = false;
    this.lookYaw = 0;
    this.lookTimer = 0;
    this.path = [];
    this.fenceSpot = null;
    this.roarIn = Infinity;
    this.roarTime = 0;
    this.roared = false;
    this.treatTime = 0;
    this.tree = null;
    this.diveIn = 0;
    this.diveTime = 0;
    this.state = 'sleep';
    this.stateTime = 0;
    this.moveTime = 0;
  }

  /** Can this animal go into the pond? */
  get swims(): boolean {
    return this.species.swim !== undefined;
  }

  /** In the water right now (penguins swimming). */
  get swimming(): boolean {
    return this.swims && this.enclosure.inWater(this.root.position.x, this.root.position.z);
  }

  get position(): THREE.Vector3 {
    return this.root.position;
  }

  get stateLabel(): string {
    return STATE_LABEL[this.state];
  }

  get mood(): string {
    if (this.state === 'sleep') return 'Dreaming';
    if (this.hunger < 0.15) return this.feeder.hasFood ? 'Starving' : 'Starving, and the feeder is empty!';
    if (this.hunger < this.species.hungryAt) return 'Hungry';
    if (this.energy < 0.2) return 'Tired';
    if (this.happiness > 0.8) return 'Very happy';
    if (this.happiness > 0.5) return 'Content';
    return 'Unhappy';
  }

  update(dt: number, hour: number): void {
    this.time += dt;
    this.updateNeeds(dt);
    this.checkInterrupts(hour);

    this.stateTime -= dt;
    switch (this.state) {
      case 'idle':
        if (this.stateTime <= 0) this.decide(hour);
        break;
      case 'wander':
      case 'toFeeder':
      case 'toFence':
      case 'toTree':
      case 'toBed':
        this.walk(dt, hour);
        break;
      case 'browse':
        this.browse(dt, hour);
        break;
      case 'greet':
        this.greet(dt, hour);
        break;
      case 'eat':
        this.eat(dt);
        break;
      case 'sleep':
        break;
    }

    this.animate(dt);
    this.updateBubble();
  }

  /** Take a treat from a visitor's hand, if saying hello at the fence. */
  takeTreat(): boolean {
    if (this.state !== 'greet' || this.treatTime > 0) return false;
    this.treatTime = 1.6;
    this.hunger = Math.min(1, this.hunger + 0.04);
    this.happiness = Math.min(1, this.happiness + 0.02);
    return true;
  }

  /** True once per roar, so visitors can react to it. */
  consumeRoar(): boolean {
    const r = this.roared;
    this.roared = false;
    return r;
  }

  /** Called by the separation pass; keeps the animal inside its fence. */
  nudge(dx: number, dz: number): void {
    const p = this.root.position;
    if (this.enclosure.walkable(p.x + dx, p.z + dz, this.radius, this.swims)) {
      p.x += dx;
      p.z += dz;
    }
  }

  private isBedtime(hour: number): boolean {
    return hour >= this.bedtime || hour < this.wakeTime;
  }

  private updateNeeds(dt: number): void {
    const s = this.species;
    const asleep = this.state === 'sleep';
    this.hunger = clamp(this.hunger - s.hungerRate * dt * (asleep ? 0.3 : 1), 0, 1);
    this.energy = clamp(this.energy + (asleep ? 0.03 : -s.tireRate) * dt, 0, 1);

    const fed = Math.min(1, this.hunger / 0.5);
    let goal = 0.15 + 0.6 * fed + 0.25 * this.energy;
    if (this.hunger < 0.1) goal = 0.05;
    this.happiness += (goal - this.happiness) * (1 - Math.exp(-dt * 0.05));
  }

  /** Needs that override whatever the animal is doing. */
  private checkInterrupts(hour: number): void {
    const s = this.state;
    if (s === 'sleep') {
      const rested = this.isBedtime(hour) ? false : this.energy > 0.5;
      const starving = this.hunger < 0.15 && this.feeder.hasFood;
      if (rested || starving) this.decide(hour);
      return;
    }
    if (INTERRUPTIBLE.includes(s) && this.hunger < this.species.hungryAt && this.feeder.hasFood) {
      this.goToFeeder();
      return;
    }
    // Feeding time: penguins waddle over as soon as the keeper starts tossing fish.
    if (this.species.parade && this.enclosure.feedingNow && INTERRUPTIBLE.includes(s) && this.hunger < 0.9) {
      this.goToFeeder();
      return;
    }
    if (INTERRUPTIBLE.includes(s) && this.isBedtime(hour) && this.hunger > 0.25) {
      this.goToSleep();
    }
  }

  private decide(hour: number): void {
    const s = this.species;
    if (this.hunger < s.hungryAt && this.feeder.hasFood) {
      this.goToFeeder();
    } else if (this.isBedtime(hour) && this.hunger > 0.25) {
      this.goToSleep();
    } else if (this.energy < 0.15) {
      this.setState('sleep');
    } else if (this.enclosure.audience > 0 && this.rng.next() < s.curiosity && this.claimFenceSpot()) {
      // Walking over to see the visitors.
    } else if (s.browse && this.enclosure.trees.length && this.rng.chance(s.browse) && this.goToTree()) {
      // Off to eat leaves.
    } else if (s.swim && this.enclosure.pond && this.rng.chance(s.swim)) {
      // A swim: somewhere in the pond.
      this.enclosure.pondPoint(this.rng, this.target);
      this.setState('wander');
    } else if (this.rng.next() < s.idleChance) {
      this.setState('idle', this.rng.float(3, 9));
    } else {
      this.enclosure.randomPoint(this.radius + 0.5, this.rng, this.target);
      this.setState('wander');
    }
  }

  private goToFeeder(): void {
    this.feeder.approachPoint(this.radius, this.enclosure, this.rng, this.target);
    this.setState('toFeeder');
  }

  /** Huddlers walk to the group's sleeping spot first; everyone else sleeps where they are. */
  private goToSleep(): void {
    const h = this.enclosure.huddle;
    if (!this.species.huddles || !h) {
      this.setState('sleep');
      return;
    }
    const a = this.rng.float(0, Math.PI * 2);
    const r = this.rng.float(0.3, 1.8);
    this.target.set(h.x + Math.cos(a) * r, 0, h.z + Math.sin(a) * r);
    this.setState('toBed');
  }

  /** Pick a tree and a spot under its crown to browse from. */
  private goToTree(): boolean {
    const tree = this.rng.pick(this.enclosure.trees);
    for (let i = 0; i < 8; i++) {
      const a = this.rng.float(0, Math.PI * 2);
      // Under the edge of the canopy, so the stretched-up head meets the leaves.
      const x = tree.x + Math.cos(a) * 3.4;
      const z = tree.z + Math.sin(a) * 3.4;
      if (!this.enclosure.walkable(x, z, this.radius)) continue;
      this.tree = tree;
      this.target.set(x, 0, z);
      this.setState('toTree');
      return true;
    }
    return false;
  }

  /** Neck stretched up into the crown, chewing. Leaves are a light snack. */
  private browse(dt: number, hour: number): void {
    if (this.tree) {
      const p = this.root.position;
      this.yaw = lerpAngle(this.yaw, Math.atan2(this.tree.x - p.x, this.tree.z - p.z), 1 - Math.exp(-dt * 3));
    }
    this.hunger = Math.min(1, this.hunger + this.species.eatRate * 0.2 * dt);
    if (this.stateTime <= 0) this.decide(hour);
  }

  private claimFenceSpot(): boolean {
    const e = this.enclosure;
    const free = e.animalSpots.filter((sp) => !e.takenSpots.has(sp));
    if (!free.length) return false;
    const spot = this.rng.pick(free);
    e.takenSpots.add(spot);
    this.fenceSpot = spot;
    this.target.set(spot.x, 0, spot.z);
    this.setState('toFence');
    return true;
  }

  /** At the fence, facing the visitors. Lions sometimes roar. */
  private greet(dt: number, hour: number): void {
    if (this.fenceSpot) this.yaw = lerpAngle(this.yaw, this.fenceSpot.yaw, 1 - Math.exp(-dt * 3));
    this.treatTime = Math.max(0, this.treatTime - dt);
    this.roarTime = Math.max(0, this.roarTime - dt);
    this.roarIn -= dt;
    if (this.roarIn <= 0) {
      this.roarIn = Infinity;
      this.roarTime = 1.4;
      this.roared = true;
    }
    if (this.stateTime <= 0 && this.treatTime <= 0) this.decide(hour);
  }

  private setState(state: AnimalState, duration = 0): void {
    if (this.fenceSpot && state !== 'greet' && state !== 'toFence') {
      this.enclosure.takenSpots.delete(this.fenceSpot);
      this.fenceSpot = null;
    }
    if (state === 'greet') this.roarIn = this.species.id === 'lion' && this.rng.next() < 0.6 ? this.rng.float(2, 6) : Infinity;
    this.state = state;
    this.stateTime = duration;
    this.moveTime = 0;
    if (state === 'wander' || state === 'toFeeder' || state === 'toFence' || state === 'toTree' || state === 'toBed') {
      this.path = this.enclosure.findPath(this.root.position, this.target, this.radius, this.swims) ?? [this.target.clone()];
    }
  }

  private walk(dt: number, hour: number): void {
    if (this.state === 'toFeeder' && !this.feeder.hasFood) {
      this.decide(hour);
      return;
    }
    const p = this.root.position;
    // Pass intermediate waypoints loosely; only the final one needs to be hit exactly.
    while (this.path.length > 1 && Math.hypot(this.path[0].x - p.x, this.path[0].z - p.z) < 0.7) this.path.shift();
    const goal = this.path[0] ?? this.target;
    const dx = goal.x - p.x;
    const dz = goal.z - p.z;
    const dist = this.path.length > 1 ? Math.max(1, Math.hypot(dx, dz)) : Math.hypot(dx, dz);
    this.moveTime += dt;

    if (dist < 0.35 || this.moveTime > 40) {
      this.walking = false;
      const arrived = this.path.length <= 1;
      if (this.state === 'toFeeder' && arrived && dist < 1.5) this.setState('eat');
      else if (this.state === 'toFence' && arrived && dist < 1) this.setState('greet', this.rng.float(8, 15));
      else if (this.state === 'toTree' && arrived && dist < 1) this.setState('browse', this.rng.float(6, 12));
      else if (this.state === 'toBed') this.setState('sleep');
      else this.setState('idle', this.rng.float(1, 4));
      return;
    }

    const desired = Math.atan2(dx, dz);
    this.yaw = lerpAngle(this.yaw, desired, 1 - Math.exp(-dt * 4));
    // Walk along the current heading so turns look natural; slow down while turning.
    let diff = Math.abs(desired - this.yaw) % (Math.PI * 2);
    if (diff > Math.PI) diff = Math.PI * 2 - diff;
    const hurry = this.state === 'toFeeder' && this.hunger < 0.2 ? 1.6 : 1;
    const swimBoost = this.swimming ? 2.6 : 1;
    const step = this.species.speed * hurry * swimBoost * Math.max(0, Math.cos(diff)) * Math.min(1, dist) * dt;
    const nx = p.x + Math.sin(this.yaw) * step;
    const nz = p.z + Math.cos(this.yaw) * step;
    if (this.enclosure.walkable(nx, nz, this.radius, this.swims)) {
      p.x = nx;
      p.z = nz;
    } else if (!this.slide(nx - p.x, nz - p.z, dx, dz) && diff < 0.3) {
      // Heading into the fence: give up on this target.
      this.setState('idle', this.rng.float(1, 3));
    }
    this.walking = step > 0.0005;
    this.stride += step / (this.model.legLength * this.root.scale.x) * 1.7;
  }

  /**
   * The step (mx, mz) runs into a rock, tree or pond: slide along its edge
   * instead, toward the side the target (tx, tz) is on. Returns false if blocked.
   */
  private slide(mx: number, mz: number, tx: number, tz: number): boolean {
    const p = this.root.position;
    const o = this.enclosure.obstacleAt(p.x + mx, p.z + mz, this.radius, this.swims);
    if (!o) return false;
    const step = Math.hypot(mx, mz);
    let nx = p.x - o.x;
    let nz = p.z - o.z;
    const len = Math.hypot(nx, nz) || 1;
    nx /= len;
    nz /= len;
    // Tangent around the obstacle, on the side facing the target.
    let sx = -nz;
    let sz = nx;
    if (sx * tx + sz * tz < 0) {
      sx = -sx;
      sz = -sz;
    }
    // Ease slightly outward too, so the animal doesn't grind along the edge.
    const mxs = (sx + nx * 0.25) * step;
    const mzs = (sz + nz * 0.25) * step;
    if (!this.enclosure.walkable(p.x + mxs, p.z + mzs, this.radius, this.swims)) return false;
    p.x += mxs;
    p.z += mzs;
    this.yaw = lerpAngle(this.yaw, Math.atan2(mxs, mzs), 0.15);
    return true;
  }

  private eat(dt: number): void {
    const s = this.species;
    const want = s.eatRate * dt;
    const got = this.feeder.consume(want * s.portion) / s.portion;
    this.hunger = clamp(this.hunger + got, 0, 1);

    const f = this.feeder.root.position;
    const p = this.root.position;
    this.yaw = lerpAngle(this.yaw, Math.atan2(f.x - p.x, f.z - p.z), 1 - Math.exp(-dt * 5));

    if (this.hunger > 0.98 || !this.feeder.hasFood) this.setState('idle', this.rng.float(2, 5));
  }

  private animate(dt: number): void {
    const m = this.model;
    const k = 1 - Math.exp(-dt * 8);
    const L = m.legLength;
    const asleep = this.state === 'sleep';
    const eating = this.state === 'eat';
    const greeting = this.state === 'greet';
    const browsing = this.state === 'browse';
    if (!['wander', 'toFeeder', 'toFence', 'toTree', 'toBed'].includes(this.state)) {
      this.walking = false;
    }

    this.root.rotation.y = this.yaw;

    // Penguins sleep standing up; in the water everyone tucks their legs.
    const swimming = this.swimming;
    const lying = asleep && !this.species.huddles;
    poseLegs(m, k, lying || swimming ? 'lie' : this.walking ? 'walk' : 'stand', this.stride);

    // Swimmers dive now and then: under for a moment, then back up.
    if (swimming) {
      this.diveIn -= dt;
      this.diveTime = Math.max(0, this.diveTime - dt);
      if (this.diveIn <= 0) {
        this.diveIn = this.rng.float(4, 10);
        this.diveTime = this.rng.float(1, 2.2);
      }
    }
    const bob = this.walking ? Math.abs(Math.sin(this.stride)) * 0.05 * L : 0;
    let poseY = lying ? -L * 0.85 : bob;
    if (swimming) poseY = this.diveTime > 0 ? -0.5 : -0.12 + Math.sin(this.time * 3) * 0.03;
    m.pose.position.y = lerp(m.pose.position.y, poseY, asleep ? k * 0.3 : k);
    // Swimming: body flat in the water. Waddling: rock side to side.
    m.pose.rotation.x = lerp(m.pose.rotation.x, swimming ? 1.35 : 0, k);
    const waddle = m.waddle && this.walking && !swimming ? Math.sin(this.stride) * 0.16 : 0;
    m.pose.rotation.z = lerp(m.pose.rotation.z, waddle, k);
    m.flippers.forEach((f, i) => {
      const side = i === 0 ? 1 : -1;
      let spread = 0.18;
      let stroke = 0;
      if (swimming) [spread, stroke] = [0.55, Math.sin(this.time * 9) * 0.8];
      else if (this.walking) spread = 0.35 + Math.sin(this.stride * 2) * 0.08;
      else if (this.state === 'eat' || this.state === 'greet') spread = 0.3 + Math.abs(Math.sin(this.time * 6)) * 0.25; // excited flapping
      f.rotation.z = lerp(f.rotation.z, side * spread, k);
      f.rotation.x = lerp(f.rotation.x, stroke, k);
    });

    // Head: look around when idle, dip when eating, rest when asleep.
    this.lookTimer -= dt;
    if (this.lookTimer <= 0) {
      this.lookTimer = this.rng.float(1.5, 4);
      this.lookYaw = this.state === 'idle' ? this.rng.float(-0.6, 0.6) : 0;
    }
    let pitch = 0;
    if (eating) pitch = m.eatPitch + Math.sin(this.time * 7) * 0.08;
    else if (greeting && this.roarTime > 0) pitch = -0.6 + Math.sin(this.time * 30) * 0.04; // roar: head up
    else if (greeting && this.treatTime > 0) pitch = m.eatPitch * 0.5 + Math.sin(this.time * 9) * 0.1;
    else if (greeting) pitch = 0.12 + Math.sin(this.time * 1.5) * 0.05;
    else if (browsing) pitch = -0.4 + Math.sin(this.time * 6) * 0.06; // reaching up, chewing
    else if (asleep) pitch = 0.35;
    else if (this.walking) pitch = Math.sin(this.stride * 2) * 0.05;
    m.head.rotation.x = lerp(m.head.rotation.x, pitch, k);
    m.head.rotation.y = lerp(m.head.rotation.y, asleep || eating ? 0 : this.lookYaw, k * 0.5);

    if (m.tail) m.tail.rotation.z = Math.sin(this.time * (asleep ? 0.8 : 2.2)) * (asleep ? 0.05 : 0.3);
    // Trunk sways; reaches out over the fence to visitors; curls back to the mouth to eat.
    m.trunk.forEach((seg, i) => {
      let curl = -0.04 + Math.sin(this.time * 1.1 - i * 0.5) * 0.07;
      if (eating) curl = 0.12 + Math.sin(this.time * 2.2 - i * 0.4) * 0.28;
      else if (greeting && this.treatTime > 0) curl = 0.38;
      else if (greeting) curl = -0.3 + Math.sin(this.time * 1.6 - i * 0.5) * 0.08;
      seg.rotation.x = lerp(seg.rotation.x, curl, k);
      seg.rotation.z = Math.sin(this.time * 0.8 - i * 0.6) * 0.05;
    });
    // Long necks (giraffes): base segment sets the lean, the rest add curve.
    if (m.neck.length) {
      let base = 0.4;
      let rest = -0.05;
      if (this.walking) base = 0.5 + Math.sin(this.stride) * 0.04;
      if (eating) [base, rest] = [0.95, 0.2]; // head down to the raised rack
      if (greeting) [base, rest] = this.treatTime > 0 ? [1.2, 0.33] : [1.1, 0.3]; // over the fence to visitors' hands
      if (browsing) [base, rest] = [0.12, -0.1]; // up into the crown
      if (asleep) [base, rest] = [1.15, 0.4];
      m.neck.forEach((seg, i) => (seg.rotation.x = lerp(seg.rotation.x, i === 0 ? base : rest, k * 0.6)));
    }
    for (const ear of m.ears) {
      ear.pivot.rotation.y = ear.rest + Math.sign(ear.rest) * Math.sin(this.time * 1.7) * 0.18;
    }
  }

  private updateBubble(): void {
    let text = '';
    if (this.state === 'sleep') text = '💤';
    else if (this.hunger < 0.2 && this.state !== 'eat') text = this.feeder.food === 'meat' ? '🍖' : '🌾';
    else if (this.happiness < 0.3) text = '😟';
    if (text === this.bubbleText) return;
    this.bubbleText = text;
    this.bubbleEl.textContent = text;
    this.bubble.visible = text !== '';
  }
}
