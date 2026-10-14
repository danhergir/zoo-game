import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { Enclosure } from '../enclosure';
import type { Feeder } from '../feeder';
import { buildModel, type AnimalModel } from './models';
import type { SpeciesDef } from './species';

export type AnimalState = 'idle' | 'wander' | 'toFeeder' | 'eat' | 'sleep';

const STATE_LABEL: Record<AnimalState, string> = {
  idle: 'Relaxing',
  wander: 'Wandering',
  toFeeder: 'Heading to food',
  eat: 'Eating',
  sleep: 'Sleeping',
};

const { clamp, randFloat, lerp } = THREE.MathUtils;

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
  hunger = randFloat(0.55, 1);
  energy = randFloat(0.7, 1);
  happiness = 0.75;
  state: AnimalState = 'idle';

  private readonly model: AnimalModel;
  private readonly target = new THREE.Vector3();
  private stateTime = randFloat(0, 3);
  private moveTime = 0;
  private yaw = Math.random() * Math.PI * 2;
  private stride = 0;
  private time = Math.random() * 100;
  private walking = false;
  private lookYaw = 0;
  private lookTimer = 0;
  // Each animal keeps its own schedule so they don't all drop at once.
  private readonly bedtime = randFloat(19.5, 21);
  private readonly wakeTime = randFloat(5.5, 7.5);

  private readonly bubbleEl = document.createElement('div');
  private bubbleText = '';

  constructor(species: SpeciesDef, name: string, male: boolean, enclosure: Enclosure, feeder: Feeder) {
    this.species = species;
    this.name = name;
    this.male = male;
    this.enclosure = enclosure;
    this.feeder = feeder;

    this.model = buildModel(species.id, male);
    this.root = this.model.root;
    const scale = randFloat(0.88, 1.08);
    this.root.scale.setScalar(scale);
    this.radius = species.radius * scale;
    enclosure.randomPoint(species.radius + 1, this.root.position);
    this.root.rotation.y = this.yaw;
    this.root.userData.pick = { kind: 'animal', animal: this };

    this.bubbleEl.className = 'bubble';
    this.bubbleEl.style.display = 'none';
    const bubble = new CSS2DObject(this.bubbleEl);
    bubble.position.y = this.model.height + 0.5;
    this.root.add(bubble);
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
        this.walk(dt, hour);
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

  /** Called by the separation pass; keeps the animal inside its fence. */
  nudge(dx: number, dz: number): void {
    const p = this.root.position;
    if (this.enclosure.walkable(p.x + dx, p.z + dz, this.radius)) {
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
    if ((s === 'idle' || s === 'wander') && this.hunger < this.species.hungryAt && this.feeder.hasFood) {
      this.goToFeeder();
      return;
    }
    if ((s === 'idle' || s === 'wander') && this.isBedtime(hour) && this.hunger > 0.25) {
      this.setState('sleep');
    }
  }

  private decide(hour: number): void {
    const s = this.species;
    if (this.hunger < s.hungryAt && this.feeder.hasFood) {
      this.goToFeeder();
    } else if (this.isBedtime(hour) && this.hunger > 0.25) {
      this.setState('sleep');
    } else if (this.energy < 0.15) {
      this.setState('sleep');
    } else if (Math.random() < s.idleChance) {
      this.setState('idle', randFloat(3, 9));
    } else {
      this.enclosure.randomPoint(this.radius + 0.5, this.target);
      this.setState('wander');
    }
  }

  private goToFeeder(): void {
    this.feeder.approachPoint(this.radius, this.enclosure, this.target);
    this.setState('toFeeder');
  }

  private setState(state: AnimalState, duration = 0): void {
    this.state = state;
    this.stateTime = duration;
    this.moveTime = 0;
  }

  private walk(dt: number, hour: number): void {
    if (this.state === 'toFeeder' && !this.feeder.hasFood) {
      this.decide(hour);
      return;
    }
    const p = this.root.position;
    const dx = this.target.x - p.x;
    const dz = this.target.z - p.z;
    const dist = Math.hypot(dx, dz);
    this.moveTime += dt;

    if (dist < 0.35 || this.moveTime > 40) {
      this.walking = false;
      if (this.state === 'toFeeder' && dist < 1.5) this.setState('eat');
      else this.setState('idle', randFloat(1, 4));
      return;
    }

    const desired = Math.atan2(dx, dz);
    this.yaw = lerpAngle(this.yaw, desired, 1 - Math.exp(-dt * 4));
    // Walk along the current heading so turns look natural; slow down while turning.
    let diff = Math.abs(desired - this.yaw) % (Math.PI * 2);
    if (diff > Math.PI) diff = Math.PI * 2 - diff;
    const hurry = this.state === 'toFeeder' && this.hunger < 0.2 ? 1.6 : 1;
    const step = this.species.speed * hurry * Math.max(0, Math.cos(diff)) * Math.min(1, dist) * dt;
    const nx = p.x + Math.sin(this.yaw) * step;
    const nz = p.z + Math.cos(this.yaw) * step;
    if (this.enclosure.walkable(nx, nz, this.radius)) {
      p.x = nx;
      p.z = nz;
    } else if (!this.slide(nx - p.x, nz - p.z, dx, dz) && diff < 0.3) {
      // Heading into the fence: give up on this target.
      this.setState('idle', randFloat(1, 3));
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
    const o = this.enclosure.obstacleAt(p.x + mx, p.z + mz, this.radius);
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
    if (!this.enclosure.walkable(p.x + mxs, p.z + mzs, this.radius)) return false;
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

    if (this.hunger > 0.98 || !this.feeder.hasFood) this.setState('idle', randFloat(2, 5));
  }

  private animate(dt: number): void {
    const m = this.model;
    const k = 1 - Math.exp(-dt * 8);
    const L = m.legLength;
    const asleep = this.state === 'sleep';
    const eating = this.state === 'eat';
    if (!(this.state === 'wander' || this.state === 'toFeeder')) this.walking = false;

    this.root.rotation.y = this.yaw;

    // Legs: walk cycle with diagonal pairs; knees lift on the forward swing.
    // Lying down, front legs tuck under and back legs stretch out.
    m.legs.forEach((leg, i) => {
      const phase = this.stride + (i === 0 || i === 3 ? 0 : Math.PI);
      let hip = 0;
      let knee = 0;
      if (asleep) {
        hip = leg.front ? -1.4 : 1.4;
        knee = leg.front ? 1.7 : 0;
      } else if (this.walking) {
        hip = Math.sin(phase) * 0.45;
        knee = Math.max(0, -Math.cos(phase)) * 0.9;
      }
      leg.hip.rotation.x = lerp(leg.hip.rotation.x, hip, k);
      leg.knee.rotation.x = lerp(leg.knee.rotation.x, knee, k);
    });

    const bob = this.walking ? Math.abs(Math.sin(this.stride)) * 0.05 * L : 0;
    m.pose.position.y = lerp(m.pose.position.y, asleep ? -L * 0.85 : bob, asleep ? k * 0.3 : k);

    // Head: look around when idle, dip when eating, rest when asleep.
    this.lookTimer -= dt;
    if (this.lookTimer <= 0) {
      this.lookTimer = randFloat(1.5, 4);
      this.lookYaw = this.state === 'idle' ? randFloat(-0.6, 0.6) : 0;
    }
    let pitch = 0;
    if (eating) pitch = m.eatPitch + Math.sin(this.time * 7) * 0.08;
    else if (asleep) pitch = 0.35;
    else if (this.walking) pitch = Math.sin(this.stride * 2) * 0.05;
    m.head.rotation.x = lerp(m.head.rotation.x, pitch, k);
    m.head.rotation.y = lerp(m.head.rotation.y, asleep || eating ? 0 : this.lookYaw, k * 0.5);

    if (m.tail) m.tail.rotation.z = Math.sin(this.time * (asleep ? 0.8 : 2.2)) * (asleep ? 0.05 : 0.3);
    // Trunk sways; while eating it reaches forward and curls back to the mouth.
    m.trunk.forEach((seg, i) => {
      const curl = eating
        ? 0.12 + Math.sin(this.time * 2.2 - i * 0.4) * 0.28
        : -0.04 + Math.sin(this.time * 1.1 - i * 0.5) * 0.07;
      seg.rotation.x = lerp(seg.rotation.x, curl, k);
      seg.rotation.z = Math.sin(this.time * 0.8 - i * 0.6) * 0.05;
    });
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
    this.bubbleEl.style.display = text ? '' : 'none';
  }
}
