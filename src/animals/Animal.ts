import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { ROPE_SAG, type Enclosure } from '../enclosure';
import type { Feeder } from '../feeder';
import type { Spot } from '../layout';
import type { Rng } from '../rng';
import { weatherNow } from '../weather';
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
  | 'browse'
  | 'toPole'
  | 'climb'
  | 'perch'
  | 'swing'
  | 'play'
  | 'toPond'
  | 'spray'
  | 'roll'
  | 'toRock'
  | 'bask';

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
  toPole: 'Heading for the climbing frame',
  climb: 'Climbing',
  perch: 'Hanging out up high',
  swing: 'Swinging across',
  play: 'Playing',
  toPond: 'Off to the water',
  spray: 'Spraying water',
  roll: 'Rolling in the dust',
  toRock: 'Heading for the warm rock',
  bask: 'Sunbathing on the rock',
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
  /** Climbers: height above ground and which climbing-frame platform they're on (-1 = on the ground). */
  private elevation = 0;
  private platform = -1;
  /** Platform being walked to, and the spot at the foot of its pole. */
  private targetPlatform = -1;
  private readonly poleBase = { x: 0, z: 0 };
  private climbDir = 0;
  private swingFrom = -1;
  private swingT = 0;
  /** Heading up the frame to sleep. */
  private sleepUp = false;
  /** Babies: siblings to play with, and the sibling being chased (or fled from). */
  siblings: Animal[] = [];
  private playWith: Animal | null = null;
  private chasing = false;
  private pounce = 0;
  /** Warm rock: claimed spot on top, the edge we hopped up from, and hop progress (0 = ground, 1 = on top). */
  private baskSpot = -1;
  private readonly baskEdge = { x: 0, z: 0 };
  private hop = 0;
  /** Elephant water spray and zebra dust puffs (visual particles, shown during those states). */
  private readonly particles: THREE.InstancedMesh | null = null;
  /** Swimmers: seconds until the next dive, and how long the current dive lasts. */
  private diveIn = 0;
  private diveTime = 0;

  private readonly bubbleEl = document.createElement('div');
  private readonly bubble: CSS2DObject;
  private bubbleText = '';

  /** `rng` sets this animal's size; seed it the same everywhere. */
  /**
   * `mother` makes this a baby that follows her around.
   */
  constructor(
    species: SpeciesDef,
    name: string,
    male: boolean,
    enclosure: Enclosure,
    feeder: Feeder,
    rng: Rng,
    readonly mother: Animal | null = null,
  ) {
    this.rng = rng;
    this.species = species;
    this.name = name;
    this.male = male;
    this.enclosure = enclosure;
    this.feeder = feeder;

    this.model = buildModel(species.id, male);
    this.root = this.model.root;
    const scale = mother ? rng.float(0.45, 0.52) : rng.float(0.88, 1.08);
    this.root.scale.setScalar(scale);
    this.radius = species.radius * scale;
    this.root.userData.pick = { kind: 'animal', animal: this };
    if (species.sprays || species.rolls) {
      // Water droplets (elephants) or dust puffs (zebras), positioned in animate().
      const water = species.sprays !== undefined;
      this.particles = new THREE.InstancedMesh(
        new THREE.SphereGeometry(water ? 0.07 : 0.22, 6, 4),
        new THREE.MeshStandardMaterial({
          color: water ? '#9fd8f0' : '#cdb78a',
          transparent: true,
          opacity: water ? 0.75 : 0.45,
          depthWrite: false,
          roughness: 1,
        }),
        water ? 24 : 10,
      );
      this.particles.visible = false;
      this.particles.frustumCulled = false;
      this.particles.raycast = () => {};
      this.root.add(this.particles);
    }

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
    this.elevation = 0;
    this.platform = -1;
    this.targetPlatform = -1;
    this.sleepUp = false;
    this.playWith = null;
    this.chasing = false;
    this.pounce = 0;
    this.baskSpot = -1;
    this.hop = 0;
    this.state = 'sleep';
    this.stateTime = 0;
    this.moveTime = 0;
    // Babies start the day asleep next to their mother.
    if (this.mother) {
      const m = this.mother.position;
      const a = rng.float(0, Math.PI * 2);
      const d = this.mother.radius + this.radius + 0.2;
      this.root.position.set(m.x + Math.cos(a) * d, 0, m.z + Math.sin(a) * d);
      if (!this.enclosure.walkable(this.root.position.x, this.root.position.z, this.radius)) {
        this.root.position.set(m.x, 0, m.z);
      }
      return;
    }
    // Climbers start the day asleep up on the frame, where they spent the night.
    const g = this.enclosure.gym;
    if (this.species.climb && g) {
      const free = g.platforms.map((_, i) => i).filter((i) => g.occupants[i] < 2);
      if (free.length) {
        this.platform = rng.pick(free);
        g.occupants[this.platform]++;
        const p = g.platforms[this.platform];
        const a = rng.float(0, Math.PI * 2);
        this.root.position.set(p.x + Math.cos(a) * 0.5, 0, p.z + Math.sin(a) * 0.5);
        this.elevation = p.h;
        this.root.position.y = p.h;
      }
    }
  }

  /** Facing direction (babies line up beside their mother). */
  get heading(): number {
    return this.yaw;
  }

  /** Off the ground (on the climbing frame or the warm rock): skip ground-level spacing. */
  get offGround(): boolean {
    return this.platform >= 0 || this.elevation > 0.05;
  }

  /** Up on the climbing frame (monkeys). */
  get aloft(): boolean {
    return this.platform >= 0;
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
    if (this.mother) {
      this.updateBaby(dt);
      this.root.position.y = this.elevation;
      this.animate(dt);
      this.updateBubble();
      return;
    }
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
      case 'toPole':
        this.walk(dt, hour);
        break;
      case 'climb':
        this.climb(dt, hour);
        break;
      case 'perch':
        this.perch(dt, hour);
        break;
      case 'swing':
        this.swing(dt, hour);
        break;
      case 'toPond':
      case 'toRock':
        this.walk(dt, hour);
        break;
      case 'spray':
      case 'roll':
        if (this.stateTime <= 0) this.decide(hour);
        break;
      case 'bask':
        this.bask(dt, hour);
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

    this.root.position.y = this.elevation;
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
    if (this.offGround) return;
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
    if (this.aloft) {
      // Up on the frame: wake in the morning, come down for food, sleep at bedtime.
      if (s === 'sleep') {
        const rested = this.isBedtime(hour) ? false : this.energy > 0.5;
        if (rested || (this.hunger < 0.15 && this.feeder.hasFood)) this.decideAloft(hour);
      } else if (s === 'perch' && this.hunger < this.species.hungryAt && this.feeder.hasFood) {
        this.startClimbDown();
      } else if (s === 'perch' && this.isBedtime(hour)) {
        this.setState('sleep');
      }
      return;
    }
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
    if (this.aloft) {
      this.decideAloft(hour);
      return;
    }
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
    } else if (s.basks && hour > 11 && hour < 15.5 && this.rng.chance(s.basks) && this.goToRock()) {
      // Off to sunbathe.
    } else if (
      s.sprays &&
      hour > 9 &&
      hour < 18 &&
      this.enclosure.pond &&
      // Elephants love the rain: showers bring out the trunk showers.
      this.rng.chance(Math.min(0.9, s.sprays * (weatherNow.rain > 0.3 ? 3 : 1))) &&
      this.goToPond()
    ) {
      // Off for a shower.
    } else if (s.rolls && this.rng.chance(s.rolls)) {
      this.setState('roll', 5);
    } else if (s.climb && this.enclosure.gym && this.rng.chance(s.climb) && this.goToPole(false)) {
      // Off to the climbing frame.
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
    // Monkeys sleep up on the climbing frame.
    if (this.species.climb && this.enclosure.gym && this.goToPole(true)) return;
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

  /** Walk to the pond's edge, facing the water, for a trunk shower. */
  private goToPond(): boolean {
    const pond = this.enclosure.pond!;
    for (let k = 0; k < 8; k++) {
      const a = this.rng.float(0, Math.PI * 2);
      const d = pond.r * 1.12 + this.radius * 0.6 + 0.4;
      const x = pond.x + Math.cos(a) * d;
      const z = pond.z + Math.sin(a) * d;
      if (!this.enclosure.walkable(x, z, this.radius)) continue;
      this.target.set(x, 0, z);
      this.setState('toPond');
      return true;
    }
    return false;
  }

  /** Claim a free spot on the warm rock and walk to the edge below it. */
  private goToRock(): boolean {
    const rock = this.enclosure.warmRock;
    if (!rock) return false;
    const free = rock.spots.map((_, i) => i).filter((i) => !this.enclosure.baskTaken.has(i));
    if (!free.length) return false;
    const i = this.rng.pick(free);
    const s = rock.spots[i];
    const dx = s.x - rock.x;
    const dz = s.z - rock.z;
    const len = Math.hypot(dx, dz) || 1;
    const d = rock.r + this.radius * 0.6 + 0.3;
    const ex = rock.x + (dx / len) * d;
    const ez = rock.z + (dz / len) * d;
    if (!this.enclosure.walkable(ex, ez, this.radius)) return false;
    this.enclosure.baskTaken.add(i);
    this.baskSpot = i;
    this.baskEdge.x = ex;
    this.baskEdge.z = ez;
    this.target.set(ex, 0, ez);
    this.setState('toRock');
    return true;
  }

  /** Hop up onto the rock, lie in the sun, hop back down. */
  private bask(dt: number, hour: number): void {
    const rock = this.enclosure.warmRock!;
    const spot = rock.spots[this.baskSpot];
    const leaving = this.stateTime <= 0 || (this.hunger < this.species.hungryAt && this.feeder.hasFood) || this.isBedtime(hour);
    this.hop = THREE.MathUtils.clamp(this.hop + (leaving ? -dt : dt) * 2.5, 0, 1);
    const p = this.root.position;
    p.x = THREE.MathUtils.lerp(this.baskEdge.x, spot.x, this.hop);
    p.z = THREE.MathUtils.lerp(this.baskEdge.z, spot.z, this.hop);
    this.elevation = rock.h * Math.sin((this.hop * Math.PI) / 2);
    this.yaw = lerpAngle(this.yaw, spot.yaw, 1 - Math.exp(-dt * 3));
    if (leaving && this.hop === 0) {
      this.enclosure.baskTaken.delete(this.baskSpot);
      this.baskSpot = -1;
      this.elevation = 0;
      this.decide(hour);
    }
  }

  /**
   * Babies stay by their mother: walk at her side, sleep next to her, and
   * (lion cubs) chase each other around her. They nurse, so they're as fed
   * and content as she is.
   */
  private updateBaby(dt: number): void {
    const mom = this.mother!;
    this.hunger = mom.hunger;
    this.energy = mom.energy;
    this.happiness = Math.min(1, mom.happiness + 0.05);
    this.pounce = Math.max(0, this.pounce - dt);
    const p = this.root.position;

    // Mom asleep (or up somewhere): curl up right beside her.
    const momResting = mom.state === 'sleep' || mom.offGround;
    let goal: { x: number; z: number };
    let speed = this.species.speed * 1.4;
    if (this.playWith && (momResting || this.stateTime <= 0)) this.stopPlaying();
    if (!momResting && !this.playWith && this.siblings.length && this.rng.chance(dt * 0.06)) {
      // Start a game of chase with a sibling.
      const sib = this.rng.pick(this.siblings);
      if (!sib.playWith) {
        this.playWith = sib;
        sib.playWith = this;
        this.chasing = true;
        sib.chasing = false;
        this.setState('play', this.rng.float(6, 11));
        sib.state = 'play';
        sib.stateTime = this.stateTime;
      }
    }
    this.stateTime -= dt;
    if (this.playWith) {
      if (this.chasing) {
        goal = this.playWith.root.position;
        if (Math.hypot(goal.x - p.x, goal.z - p.z) < this.radius * 2.2) {
          // Caught! Pounce, then it's the other cub's turn to chase.
          this.pounce = 0.5;
          this.chasing = false;
          this.playWith.chasing = true;
        }
      } else {
        // Run circles around mom.
        const a = this.time * 0.9 + (this.name.length % 3);
        const r = mom.radius + 2.5;
        goal = { x: mom.position.x + Math.cos(a) * r, z: mom.position.z + Math.sin(a) * r };
      }
      speed *= 1.2;
    } else {
      // Beside mom, a little behind her shoulder.
      const side = this.name.length % 2 ? 1 : -1;
      const off = mom.radius + this.radius + 0.25;
      const c = Math.cos(mom.heading);
      const sn = Math.sin(mom.heading);
      const lx = side * off;
      const lz = -0.3 * off;
      goal = { x: mom.position.x + lx * c + lz * sn, z: mom.position.z - lx * sn + lz * c };
    }

    const dx = goal.x - p.x;
    const dz = goal.z - p.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 0.3) {
      const desired = Math.atan2(dx, dz);
      this.yaw = lerpAngle(this.yaw, desired, 1 - Math.exp(-dt * 6));
      const step = Math.min(dist, speed * Math.min(1, dist) * dt);
      const nx = p.x + Math.sin(this.yaw) * step;
      const nz = p.z + Math.cos(this.yaw) * step;
      if (this.enclosure.walkable(nx, nz, this.radius)) {
        p.x = nx;
        p.z = nz;
      } else {
        this.slide(nx - p.x, nz - p.z, dx, dz);
      }
      this.walking = step > 0.002;
      this.stride += (step / (this.model.legLength * this.root.scale.x)) * 1.7;
    } else {
      this.walking = false;
      this.yaw = lerpAngle(this.yaw, mom.heading, 1 - Math.exp(-dt * 2));
    }
    if (!this.playWith) this.state = momResting && dist < 1 ? 'sleep' : this.walking ? 'wander' : 'idle';
  }

  private stopPlaying(): void {
    if (this.playWith) {
      this.playWith.playWith = null;
      this.playWith.state = 'idle';
    }
    this.playWith = null;
    this.state = 'idle';
  }

  /** Walk to the foot of a pole whose platform has room (at most two monkeys per platform). */
  private goToPole(toSleep: boolean): boolean {
    const g = this.enclosure.gym;
    if (!g) return false;
    const free = g.platforms.map((_, i) => i).filter((i) => g.occupants[i] < 2);
    if (!free.length) return false;
    const i = this.rng.pick(free);
    if (!this.pickPoleBase(i)) return false;
    this.targetPlatform = i;
    this.sleepUp = toSleep;
    this.target.set(this.poleBase.x, 0, this.poleBase.z);
    this.setState('toPole');
    return true;
  }

  /** A walkable spot at the foot of platform `i`'s pole. */
  private pickPoleBase(i: number): boolean {
    const p = this.enclosure.gym!.platforms[i];
    for (let k = 0; k < 8; k++) {
      const a = this.rng.float(0, Math.PI * 2);
      const x = p.x + Math.cos(a) * 1.05;
      const z = p.z + Math.sin(a) * 1.05;
      if (!this.enclosure.walkable(x, z, this.radius)) continue;
      this.poleBase.x = x;
      this.poleBase.z = z;
      return true;
    }
    return false;
  }

  /** Hug the pole, between its foot and the pole itself. */
  private hugPole(): void {
    const p = this.enclosure.gym!.platforms[this.platform];
    const dx = this.poleBase.x - p.x;
    const dz = this.poleBase.z - p.z;
    const len = Math.hypot(dx, dz) || 1;
    this.root.position.set(p.x + (dx / len) * 0.32, 0, p.z + (dz / len) * 0.32);
    this.yaw = Math.atan2(-dx, -dz);
  }

  private startClimbUp(i: number): void {
    this.enclosure.gym!.occupants[i]++;
    this.platform = i;
    this.climbDir = 1;
    this.hugPole();
    this.setState('climb');
  }

  private startClimbDown(): void {
    if (!this.pickPoleBase(this.platform)) {
      this.setState('perch', this.rng.float(2, 4));
      return;
    }
    this.climbDir = -1;
    this.hugPole();
    this.setState('climb');
  }

  private climb(dt: number, hour: number): void {
    const g = this.enclosure.gym!;
    const p = g.platforms[this.platform];
    this.hugPole();
    this.elevation += this.climbDir * 1.4 * dt;
    if (this.climbDir > 0 && this.elevation >= p.h) {
      this.elevation = p.h;
      this.arriveOnPlatform(hour);
    } else if (this.climbDir < 0 && this.elevation <= 0) {
      this.elevation = 0;
      this.root.position.set(this.poleBase.x, 0, this.poleBase.z);
      g.occupants[this.platform]--;
      this.platform = -1;
      this.setState('idle', this.rng.float(1, 3));
    }
  }

  /** Settle on the current platform, at a random spot near its edge. */
  private arriveOnPlatform(hour: number): void {
    const p = this.enclosure.gym!.platforms[this.platform];
    const a = this.rng.float(0, Math.PI * 2);
    this.root.position.set(p.x + Math.cos(a) * 0.5, 0, p.z + Math.sin(a) * 0.5);
    this.yaw = Math.atan2(Math.cos(a), Math.sin(a));
    this.elevation = p.h;
    if (this.sleepUp || this.isBedtime(hour)) {
      this.sleepUp = false;
      this.setState('sleep');
    } else {
      this.setState('perch', this.rng.float(5, 12));
    }
  }

  private perch(_dt: number, hour: number): void {
    if (this.stateTime <= 0) this.decideAloft(hour);
  }

  /** Up on the frame and done perching: swing to another platform, climb down, or stay a while. */
  private decideAloft(hour: number): void {
    if (this.hunger < this.species.hungryAt && this.feeder.hasFood) return this.startClimbDown();
    if (this.isBedtime(hour)) return this.setState('sleep');
    const r = this.rng.next();
    if (r < 0.45 && this.startSwing()) return;
    if (r < 0.75) return this.startClimbDown();
    this.setState('perch', this.rng.float(4, 10));
  }

  private startSwing(): boolean {
    const g = this.enclosure.gym!;
    const options = g.ropes
      .filter(([a, b]) => a === this.platform || b === this.platform)
      .map(([a, b]) => (a === this.platform ? b : a))
      .filter((to) => g.occupants[to] < 2);
    if (!options.length) return false;
    const to = this.rng.pick(options);
    g.occupants[this.platform]--;
    g.occupants[to]++;
    this.swingFrom = this.platform;
    this.platform = to;
    this.swingT = 0;
    this.setState('swing');
    return true;
  }

  /** Hand over hand along the rope, following the same sagging curve the rope is drawn with. */
  private swing(dt: number, hour: number): void {
    const g = this.enclosure.gym!;
    const a = g.platforms[this.swingFrom];
    const b = g.platforms[this.platform];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    this.swingT = Math.min(1, this.swingT + (dt * 1.5) / len);
    const t = this.swingT;
    const mid = (a.h + b.h) / 2 - ROPE_SAG * 2;
    this.root.position.set(a.x + (b.x - a.x) * t, 0, a.z + (b.z - a.z) * t);
    this.elevation = (1 - t) * (1 - t) * a.h + 2 * t * (1 - t) * mid + t * t * b.h;
    this.yaw = Math.atan2(b.x - a.x, b.z - a.z);
    if (t >= 1) this.arriveOnPlatform(hour);
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
    if (['wander', 'toFeeder', 'toFence', 'toTree', 'toBed', 'toPole', 'toPond', 'toRock'].includes(state)) {
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
      else if (this.state === 'toPole' && arrived && dist < 1) this.startClimbUp(this.targetPlatform);
      else if (this.state === 'toPond' && arrived && dist < 1) {
        const pond = this.enclosure.pond!;
        this.yaw = Math.atan2(pond.x - this.root.position.x, pond.z - this.root.position.z);
        this.setState('spray', this.rng.float(7, 11));
      } else if (this.state === 'toRock' && arrived && dist < 1) {
        this.hop = 0;
        this.setState('bask', this.rng.float(15, 30));
      } else if (this.state === 'toRock') {
        // Didn't make it: give the spot back.
        this.enclosure.baskTaken.delete(this.baskSpot);
        this.baskSpot = -1;
        this.setState('idle', this.rng.float(1, 4));
      }
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
    if (!['wander', 'toFeeder', 'toFence', 'toTree', 'toBed', 'toPole', 'toPond', 'toRock', 'play'].includes(this.state) && !this.mother) {
      this.walking = false;
    }

    this.root.rotation.y = this.yaw;

    // Penguins sleep standing up; in the water everyone tucks their legs.
    const swimming = this.swimming;
    const rolling = this.state === 'roll';
    const basking = this.state === 'bask';
    const spraying = this.state === 'spray';
    const lying = (asleep && !this.species.huddles) || rolling || basking;
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
    // Cubs at play: a little hop on the pounce.
    if (this.pounce > 0) poseY += Math.sin(((0.5 - this.pounce) / 0.5) * Math.PI) * 0.25;
    if (swimming) poseY = this.diveTime > 0 ? -0.5 : -0.12 + Math.sin(this.time * 3) * 0.03;
    m.pose.position.y = lerp(m.pose.position.y, poseY, asleep ? k * 0.3 : k);
    // Swimming: body flat in the water. Waddling: rock side to side.
    m.pose.rotation.x = lerp(m.pose.rotation.x, swimming ? 1.35 : 0, k);
    const waddle = m.waddle && this.walking && !swimming ? Math.sin(this.stride) * 0.16 : 0;
    // Dust bath: roll over onto the back and back again, legs kicking.
    const rollT = rolling ? THREE.MathUtils.clamp(1 - this.stateTime / 5, 0, 1) : 0;
    const roll = rolling ? Math.sin(rollT * Math.PI) * 2.5 * (this.name.length % 2 ? 1 : -1) : 0;
    m.pose.rotation.z = lerp(m.pose.rotation.z, waddle + roll, rolling ? 0.2 : k);
    if (rolling) m.legs.forEach((leg, i) => (leg.hip.rotation.x += Math.sin(this.time * 12 + i) * 0.25));
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
    else if (basking) pitch = -0.1 + Math.sin(this.time * 0.8) * 0.05; // head up, eyes half closed
    else if (spraying) pitch = (this.time % 2.6) / 2.6 < 0.35 ? 0.35 : -0.2;
    else if (asleep) pitch = 0.35;
    else if (this.walking) pitch = Math.sin(this.stride * 2) * 0.05;
    m.head.rotation.x = lerp(m.head.rotation.x, pitch, k);
    m.head.rotation.y = lerp(m.head.rotation.y, asleep || eating ? 0 : this.lookYaw, k * 0.5);

    if (m.tail) m.tail.rotation.z = Math.sin(this.time * (asleep ? 0.8 : 2.2)) * (asleep ? 0.05 : 0.3);
    // Trunk sways; reaches out over the fence to visitors; curls back to the mouth to eat.
    m.trunk.forEach((seg, i) => {
      let curl = -0.04 + Math.sin(this.time * 1.1 - i * 0.5) * 0.07;
      if (eating) curl = 0.12 + Math.sin(this.time * 2.2 - i * 0.4) * 0.28;
      else if (spraying) curl = (this.time % 2.6) / 2.6 < 0.35 ? 0.35 : -0.55; // dip in the water, then up over the head
      else if (greeting && this.treatTime > 0) curl = 0.38;
      else if (greeting) curl = -0.3 + Math.sin(this.time * 1.6 - i * 0.5) * 0.08;
      seg.rotation.x = lerp(seg.rotation.x, curl, spraying ? Math.min(1, k * 2.5) : k);
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
    if (this.species.climb !== undefined) this.poseClimber(k);
    this.updateParticles(spraying, rolling ? rollT : -1);
    for (const ear of m.ears) {
      ear.pivot.rotation.y = ear.rest + Math.sign(ear.rest) * Math.sin(this.time * 1.7) * 0.18;
    }
  }

  /**
   * Elephant shower: droplets arcing from the raised trunk back over the body.
   * Zebra dust bath: puffs billowing around the body while it rolls.
   */
  private updateParticles(spraying: boolean, rollT: number): void {
    const p = this.particles;
    if (!p) return;
    const phase = (this.time % 2.6) / 2.6;
    const showSpray = spraying && phase > 0.55;
    p.visible = showSpray || rollT >= 0;
    if (!p.visible) return;
    const m = new THREE.Matrix4();
    const count = p.count;
    for (let j = 0; j < count; j++) {
      let x: number;
      let y: number;
      let z: number;
      let s: number;
      if (showSpray) {
        const u = (((phase - 0.55) / 0.45) * 1.6 + j / count) % 1;
        x = Math.sin(j * 2.39) * 0.35 * u;
        y = 4.1 + 1.6 * u - 3.2 * u * u;
        z = 0.9 - 2.6 * u;
        s = 1;
      } else {
        const u = (rollT * 2 + j / count) % 1;
        const a = j * 0.63;
        x = Math.cos(a) * (0.8 + 0.6 * u);
        y = 0.2 + 0.5 * u;
        z = Math.sin(a) * (0.8 + 0.6 * u);
        s = 0.6 + 1.2 * u;
      }
      m.makeScale(s, s, s).setPosition(x, y, z);
      p.setMatrixAt(j, m);
    }
    p.instanceMatrix.needsUpdate = true;
  }

  /**
   * Monkey poses that the quadruped walk cycle can't express: hugging the pole
   * while climbing, hanging from the rope while swinging, sitting up on a
   * platform (waving at visitors when greeting).
   */
  private poseClimber(k: number): void {
    const m = this.model;
    const st = this.state;
    const sitting = st === 'perch' || st === 'greet' || st === 'sleep' || st === 'idle' || st === 'eat';
    let pitch: number;
    let y: number;
    let roll = 0;
    let head: number;
    let limbs: [number, number][]; // [hip, knee] for front-left, front-right, back-left, back-right
    if (st === 'climb') {
      const c = Math.sin(this.time * 9);
      [pitch, y, head] = [-1.45, 0, 1.2];
      limbs = [[-0.4 + c * 0.6, 0.4], [-0.4 - c * 0.6, 0.4], [0.5 - c * 0.4, 0.8], [0.5 + c * 0.4, 0.8]];
    } else if (st === 'swing') {
      const c = Math.sin(this.time * 7);
      [pitch, y, head] = [-1.45, -0.9, 1.2];
      roll = Math.sin(this.time * 6) * 0.2;
      limbs = [[-1.6 + c * 0.45, 0], [-1.6 - c * 0.45, 0], [0.2 + c * 0.2, 0.3], [0.2 - c * 0.2, 0.3]];
    } else if (sitting && !this.walking) {
      [pitch, y, head] = [st === 'sleep' ? -0.6 : -0.95, -0.18, st === 'sleep' ? 1.3 : 0.8];
      if (st === 'eat') head = 1.1;
      limbs = [[0.95, 0], [0.95, 0], [-1.3, 1.5], [-1.3, 1.5]];
      if (st === 'greet') limbs[0] = [-2.4 + Math.sin(this.time * 10) * 0.35, 0.2]; // waving at the visitors
    } else {
      m.pose.rotation.x = lerp(m.pose.rotation.x, 0, k);
      return;
    }
    m.pose.rotation.x = lerp(m.pose.rotation.x, pitch, k);
    m.pose.rotation.z = lerp(m.pose.rotation.z, roll, k);
    m.pose.position.y = lerp(m.pose.position.y, y, k);
    m.head.rotation.x = lerp(m.head.rotation.x, head, k);
    m.legs.forEach((leg, i) => {
      leg.hip.rotation.x = lerp(leg.hip.rotation.x, limbs[i][0], k);
      leg.knee.rotation.x = lerp(leg.knee.rotation.x, limbs[i][1], k);
    });
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
