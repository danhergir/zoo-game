import * as THREE from 'three';
import type { Animal } from '../animals/Animal';
import { BOULEVARD_Z, DECKS, EXIT_X, FLAMINGO_POND, FLAMINGO_SPOTS, LAGOON, LAGOON_SPOTS, PLAZA, SEATS, type Spot } from '../layout';
import { Rng } from '../rng';
import { Visitor, type Activity } from './Visitor';

/** Seconds a visitor holds out a treat before the animal takes it. */
const TREAT_REACH = 1.2;

const MAX_VISITORS = 36;
/** Guests arrive while the zoo is open, until shortly before closing. */
const ARRIVE_FROM = 9;
const ARRIVE_UNTIL = 16.5;
const CLOSE_HOUR = 18;

export interface CrowdHooks {
  animals: Animal[];
  /** Is a keeper feeding at this enclosure right now? Feeding time draws a crowd. */
  feedingAt: (enclosure: string) => boolean;
}

interface TreatOffer {
  visitor: Visitor;
  animal: Animal;
  time: number;
}

/** Spawns guests, hands them things to do, and sends them home at closing. */
export class Crowd {
  readonly visitors: Visitor[] = [];
  private readonly taken = new Set<Spot>();
  private readonly offers: TreatOffer[] = [];
  private spawnTimer = 0;
  private rng = new Rng('crowd');

  constructor(
    private readonly scene: THREE.Object3D,
    private readonly hooks: CrowdHooks,
  ) {}

  /** Start of a zoo day: nobody in the park, fresh random stream. */
  reset(rng: Rng): void {
    for (const v of this.visitors) this.scene.remove(v.root);
    this.visitors.length = 0;
    this.taken.clear();
    this.offers.length = 0;
    this.spawnTimer = 0;
    this.rng = rng;
  }

  /** Average animal happiness, 0..1; a happier zoo draws more guests. */
  get rating(): number {
    const a = this.hooks.animals;
    return a.reduce((s, x) => s + x.happiness, 0) / a.length;
  }

  update(dt: number, hour: number): void {
    const open = hour >= ARRIVE_FROM && hour < ARRIVE_UNTIL;
    this.spawnTimer -= dt;
    if (open && this.spawnTimer <= 0 && this.visitors.length < MAX_VISITORS) {
      this.spawn();
      // Roughly one guest every 3 seconds at a perfect rating, slower when animals are unhappy.
      this.spawnTimer = this.rng.float(1.5, 4.5) / (0.3 + this.rating);
    }

    const closing = hour >= CLOSE_HOUR || hour < ARRIVE_FROM;
    for (const v of this.visitors) {
      v.update(dt);
      if (closing && v.activity?.kind !== 'exit') {
        this.release(v);
        v.hurry = true;
        v.start({ kind: 'exit', spot: this.exitSpot(v) });
      } else if (v.idle) {
        this.next(v);
      }
    }

    this.interact(dt);

    for (let i = this.visitors.length - 1; i >= 0; i--) {
      const v = this.visitors[i];
      if (v.phase !== 'done') continue;
      this.scene.remove(v.root);
      this.visitors.splice(i, 1);
    }
  }

  private spawn(): void {
    const fromRight = this.rng.next() < 0.5;
    const start = {
      x: fromRight ? EXIT_X : -EXIT_X,
      z: BOULEVARD_Z + this.rng.float(-1.8, 1.8),
      yaw: fromRight ? -Math.PI / 2 : Math.PI / 2,
    };
    const child = this.rng.chance(0.25);
    const v = new Visitor(start, child, false, this.rng.fork('visitor'));
    v.onArrive = () => this.react(v);
    this.scene.add(v.root);
    this.visitors.push(v);
    this.next(v);
  }

  /** Finish the current activity (react if it was a viewing) and pick the next. */
  private next(v: Visitor): void {
    this.release(v);
    if (v.plansLeft <= 0) {
      v.start({ kind: 'exit', spot: this.exitSpot(v) });
      return;
    }
    v.plansLeft--;

    const roll = this.rng.next();
    const activity = (roll < 0.65 && this.viewActivity()) || (roll < 0.85 && this.sitActivity()) || this.strollActivity();
    if (activity.kind !== 'stroll') this.taken.add(activity.spot);
    v.start(activity);
  }

  /** When a guest reaches a viewing deck: react to what they see. */
  private react(v: Visitor): void {
    const a = v.activity;
    if (a?.kind !== 'view') return;
    const animals = this.hooks.animals.filter((x) => x.enclosure.name === a.enclosure);
    // The lagoon's fish are always out: plenty to get excited about.
    if (!animals.length) {
      if (this.rng.chance(0.35)) v.celebrate();
      return;
    }
    const visible = animals.filter((x) => x.state !== 'sleep' && x.position.distanceTo(v.position) < 26);
    const mood = animals.reduce((s, x) => s + x.happiness, 0) / animals.length;
    if (visible.length > 0 && mood > 0.75) v.celebrate();
  }

  /** Visitors on the decks and the animals at the fence, reacting to each other. */
  private interact(dt: number): void {
    const animals = this.hooks.animals;
    const watching = (v: Visitor, enclosure: string) =>
      v.phase === 'busy' && v.activity?.kind === 'view' && v.activity.enclosure === enclosure;

    // How many people each enclosure has watching; curious animals come over when it's > 0.
    for (const a of animals) a.enclosure.audience = 0;
    for (const v of this.visitors) {
      const a = v.activity;
      if (a?.kind !== 'view' || v.phase !== 'busy') continue;
      const e = animals.find((x) => x.enclosure.name === a.enclosure)?.enclosure;
      if (e) e.audience++;
    }

    // A roar makes everyone on that deck jump back.
    for (const lion of animals) {
      if (!lion.consumeRoar()) continue;
      for (const v of this.visitors) {
        if (watching(v, lion.enclosure.name) && v.position.distanceTo(lion.position) < 12) v.startle();
      }
    }

    // Treats: a visitor holds one out, and an animal at the fence takes it.
    for (let i = this.offers.length - 1; i >= 0; i--) {
      const o = this.offers[i];
      o.time += dt;
      const stillThere = watching(o.visitor, o.animal.enclosure.name) && o.animal.state === 'greet';
      if (!stillThere || !o.visitor.offeringTreat) {
        o.visitor.endTreat();
        this.offers.splice(i, 1);
      } else if (o.time >= TREAT_REACH) {
        o.animal.takeTreat();
        o.visitor.endTreat();
        this.offers.splice(i, 1);
      }
    }
    for (const deck of DECKS) {
      if (!deck.treat) continue;
      const greeters = animals.filter((x) => x.enclosure.name === deck.enclosure && x.state === 'greet');
      for (const animal of greeters) {
        if (this.offers.some((o) => o.animal === animal) || this.rng.next() > dt * 0.4) continue;
        const near = this.visitors.filter(
          (v) => watching(v, deck.enclosure) && !v.offeringTreat && v.position.distanceTo(animal.position) < 7,
        );
        if (!near.length) continue;
        const visitor = this.rng.pick(near);
        visitor.offerTreat(deck.treat);
        this.offers.push({ visitor, animal, time: 0 });
      }
    }
  }

  /** Pick a free deck spot, favoring decks where something is happening (feeding, animals at the fence). */
  private viewActivity(): Activity | null {
    const options: { activity: Activity; weight: number }[] = [];
    for (const d of DECKS) {
      const greeting = this.hooks.animals.filter((x) => x.enclosure.name === d.enclosure && x.state === 'greet').length;
      const weight = 1 + (this.hooks.feedingAt(d.enclosure) ? 4 : 0) + greeting * 2;
      for (const spot of d.spots) {
        if (!this.taken.has(spot)) options.push({ activity: { kind: 'view', spot, enclosure: d.enclosure }, weight });
      }
    }
    // The reef lagoon's glass is a popular spot.
    for (const spot of LAGOON_SPOTS) {
      if (!this.taken.has(spot)) options.push({ activity: { kind: 'view', spot, enclosure: LAGOON.name }, weight: 1.5 });
    }
    for (const spot of FLAMINGO_SPOTS) {
      if (!this.taken.has(spot)) options.push({ activity: { kind: 'view', spot, enclosure: FLAMINGO_POND.name }, weight: 1.2 });
    }
    let r = this.rng.next() * options.reduce((s, o) => s + o.weight, 0);
    for (const o of options) {
      r -= o.weight;
      if (r <= 0) return o.activity;
    }
    return null;
  }

  private sitActivity(): Activity | null {
    const free = SEATS.filter((s) => !this.taken.has(s));
    return free.length ? { kind: 'sit', spot: this.rng.pick(free) } : null;
  }

  private strollActivity(): Activity {
    // Somewhere on the plaza (around the planter) or along the avenue.
    if (this.rng.next() < 0.6) {
      const a = this.rng.next() * Math.PI * 2;
      const r = this.rng.float(3.4, PLAZA.r - 1.5);
      return { kind: 'stroll', spot: { x: PLAZA.x + Math.cos(a) * r, z: PLAZA.z + Math.sin(a) * r, yaw: a + Math.PI } };
    }
    return {
      kind: 'stroll',
      spot: { x: this.rng.float(-3.5, 3.5), z: this.rng.float(-15, 26), yaw: this.rng.next() * 6 },
    };
  }

  private exitSpot(v: Visitor): Spot {
    const right = v.position.x > 0 ? this.rng.next() < 0.8 : this.rng.next() < 0.2;
    return { x: right ? EXIT_X : -EXIT_X, z: BOULEVARD_Z + this.rng.float(-2, 2), yaw: 0 };
  }

  private release(v: Visitor): void {
    if (v.activity) this.taken.delete(v.activity.spot);
  }
}
