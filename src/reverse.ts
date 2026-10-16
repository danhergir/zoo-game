import * as THREE from 'three';
import { buildModel, poseLegs, type AnimalModel } from './animals/models';
import type { SpeciesId } from './animals/species';
import type { Enclosure } from './enclosure';
import { BENCHES, DECKS, FLAMINGO_POND, LAGOON, PLAZA, routeOnPaths, type Spot } from './layout';
import { Rng } from './rng';
import { buildPerson, type PersonModel } from './visitors/person';
import { Visitor } from './visitors/Visitor';

/**
 * The reverse zoo easter egg: animals tour the paths and decks while people
 * live inside the fences. It's only a view; the real zoo keeps running hidden.
 */

const { randFloat, lerp } = THREE.MathUtils;

function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

const pick = <T,>(list: T[]): T => list[Math.floor(Math.random() * list.length)];

type Plan =
  | { kind: 'view'; spot: Spot; enclosure: string }
  | { kind: 'bench'; spot: Spot }
  | { kind: 'stroll'; spot: Spot };

/** Two animal-sized viewing spots per deck. */
const DECK_SPOTS: { enclosure: string; spot: Spot }[] = DECKS.flatMap((d) => {
  const f = d.spots[0].yaw;
  // Centered on the deck, a little back from the fence, spread along it.
  const along = { x: Math.cos(f), z: -Math.sin(f) };
  const back = { x: -Math.sin(f) * 1.4, z: -Math.cos(f) * 1.4 };
  const cx = d.feedSpot.x + back.x;
  const cz = d.feedSpot.z + back.z;
  return [-1.3, 1.3].map((o) => ({
    enclosure: d.enclosure,
    spot: { x: cx + along.x * o, z: cz + along.z * o, yaw: f },
  }));
});

/** Animals nap lying along a bench. */
const BENCH_SPOTS: Spot[] = BENCHES.map((b) => ({ x: b.x, z: b.z, yaw: 0 }));

/** An animal visiting the zoo: walks the paths, watches the people, naps on benches. */
class Tourist {
  readonly root: THREE.Group;
  plan: Plan | null = null;
  phase: 'walking' | 'busy' = 'busy';
  private readonly model: AnimalModel;
  private readonly route: THREE.Vector3[] = [];
  private readonly lane = randFloat(-2.2, 2.2);
  private readonly speed: number;
  private timer = 0;
  private yaw = 0;
  private stride = 0;
  private time = Math.random() * 10;
  private walking = false;
  private roarIn = Infinity;
  private roarTime = 0;
  private roared = false;

  constructor(readonly species: SpeciesId) {
    this.model = buildModel(species, Math.random() < 0.5);
    this.root = this.model.root;
    this.root.scale.setScalar(randFloat(0.9, 1.05));
    this.speed = species === 'elephant' ? 1.4 : species === 'lion' ? 1.8 : 2.1;
  }

  get idle(): boolean {
    return this.phase === 'busy' && this.timer <= 0;
  }

  /** Start a plan, walking there along the paths (or appearing there if `teleport`). */
  go(plan: Plan, teleport = false): void {
    this.plan = plan;
    if (teleport) {
      this.root.position.set(plan.spot.x, 0, plan.spot.z);
      this.yaw = plan.spot.yaw;
      this.arrive();
      return;
    }
    this.phase = 'walking';
    this.route.length = 0;
    for (const [x, z] of routeOnPaths(this.root.position, plan.spot, this.lane)) this.route.push(new THREE.Vector3(x, 0, z));
  }

  /** True once per roar, so the people in the lion enclosure can jump. */
  consumeRoar(): boolean {
    const r = this.roared;
    this.roared = false;
    return r;
  }

  update(dt: number): void {
    this.time += dt;
    if (this.phase === 'walking') this.walk(dt);
    else this.timer -= dt;
    if (this.plan?.kind === 'view' && this.phase === 'busy') {
      this.roarIn -= dt;
      if (this.roarIn <= 0) {
        this.roarIn = randFloat(6, 14);
        this.roarTime = 1.4;
        this.roared = true;
      }
    }
    this.roarTime = Math.max(0, this.roarTime - dt);
    this.animate(dt);
  }

  private walk(dt: number): void {
    const target = this.route[0];
    if (!target) {
      this.arrive();
      return;
    }
    const p = this.root.position;
    const dx = target.x - p.x;
    const dz = target.z - p.z;
    const dist = Math.hypot(dx, dz);
    const step = Math.min(dist, this.speed * dt);
    if (dist > 1e-4) {
      p.x += (dx / dist) * step;
      p.z += (dz / dist) * step;
      this.yaw = lerpAngle(this.yaw, Math.atan2(dx, dz), 1 - Math.exp(-dt * 6));
    }
    this.stride += (step / (this.model.legLength * this.root.scale.x)) * 1.7;
    this.walking = true;
    if (dist - step < 0.02) this.route.shift();
  }

  private arrive(): void {
    this.walking = false;
    this.phase = 'busy';
    this.timer = this.plan?.kind === 'bench' ? randFloat(12, 20) : randFloat(7, 14);
    this.roarIn = this.species === 'lion' ? randFloat(2, 6) : Infinity;
  }

  private animate(dt: number): void {
    const m = this.model;
    const k = 1 - Math.exp(-dt * 8);
    const busy = this.phase === 'busy';
    const napping = busy && this.plan?.kind === 'bench';
    const watching = busy && this.plan?.kind === 'view';
    if (busy && this.plan) this.yaw = lerpAngle(this.yaw, this.plan.spot.yaw, k);
    this.root.rotation.y = this.yaw;

    poseLegs(m, k, napping ? 'lie' : this.walking ? 'walk' : 'stand', this.stride);
    // Napping on a bench: lying down, raised to the seat.
    const s = this.root.scale.x;
    const benchY = -m.legLength * 0.85 + 0.55 / s;
    const bob = this.walking ? Math.abs(Math.sin(this.stride)) * 0.05 * m.legLength : 0;
    m.pose.position.y = lerp(m.pose.position.y, napping ? benchY : bob, k);

    let pitch = this.walking ? Math.sin(this.stride * 2) * 0.05 : 0;
    if (watching) pitch = this.roarTime > 0 ? -0.6 : 0.15 + Math.sin(this.time * 1.4) * 0.05;
    if (napping) pitch = 0.35;
    m.head.rotation.x = lerp(m.head.rotation.x, pitch, k);
    m.head.rotation.y = lerp(m.head.rotation.y, watching ? Math.sin(this.time * 0.6) * 0.4 : 0, k * 0.5);
    if (m.tail) m.tail.rotation.z = Math.sin(this.time * 2.2) * 0.3;
    // Elephants raise their trunks at the people, as if taking a picture.
    m.trunk.forEach((seg, i) => {
      const curl = watching ? -0.32 + Math.sin(this.time * 1.6 - i * 0.5) * 0.08 : -0.04 + Math.sin(this.time * 1.1 - i * 0.5) * 0.07;
      seg.rotation.x = lerp(seg.rotation.x, curl, k);
    });
    for (const ear of m.ears) ear.pivot.rotation.y = ear.rest + Math.sign(ear.rest) * Math.sin(this.time * 1.7) * 0.18;
  }
}

/** A person kept in an enclosure. */
interface Captive {
  person: Visitor;
  enclosure: Enclosure;
}

export class ReverseZoo {
  readonly group = new THREE.Group();
  private readonly tourists: Tourist[] = [];
  private readonly captives: Captive[] = [];
  private readonly takenFence = new Set<Spot>();
  private readonly takenTourist = new Set<Spot>();
  /** Fence spots for people, three per animal spot, a step closer to the fence. */
  private readonly fenceSpots = new Map<Enclosure, Spot[]>();
  private built = false;
  /** People where the animals usually are: snorkeling in the lagoon, in swim rings, flamingo-posing. */
  private readonly extras: ((t: number) => void)[] = [];
  private time = 0;
  /** The reverse zoo is a local view, so it doesn't need to match other browsers. */
  private readonly rng = new Rng(`reverse:${Math.random()}`);

  constructor(
    parent: THREE.Object3D,
    private readonly enclosures: Enclosure[],
  ) {
    this.group.visible = false;
    parent.add(this.group);
  }

  get active(): boolean {
    return this.group.visible;
  }

  set active(on: boolean) {
    if (on && !this.built) this.build();
    this.group.visible = on;
  }

  update(dt: number): void {
    if (!this.active) return;
    this.time += dt;
    for (const e of this.extras) e(this.time);
    for (const t of this.tourists) {
      t.update(dt);
      if (t.consumeRoar() && t.plan?.kind === 'view') {
        const enclosure = t.plan.enclosure;
        for (const c of this.captives) if (c.enclosure.name === enclosure && c.person.phase === 'busy') c.person.startle();
      }
      if (t.idle) this.planTourist(t);
    }
    for (const c of this.captives) {
      c.person.update(dt);
      if (c.person.idle) this.planCaptive(c);
    }
  }

  private build(): void {
    this.built = true;
    for (const e of this.enclosures) {
      this.fenceSpots.set(
        e,
        e.animalSpots.flatMap((sp) => {
          const fx = Math.sin(sp.yaw);
          const fz = Math.cos(sp.yaw);
          return [-0.9, 0, 0.9].map((o) => ({ x: sp.x + fx * 1.0 + fz * o, z: sp.z + fz * 1.0 - fx * o, yaw: sp.yaw }));
        }),
      );
    }

    // People inside the fences.
    const counts: Record<string, number> = {
      'Zebra Plains': 8,
      'Elephant Valley': 7,
      'Lion Rock': 6,
      'Giraffe Heights': 6,
      'Penguin Point': 6,
      'Monkey Grove': 5,
    };
    for (const e of this.enclosures) {
      for (let i = 0; i < (counts[e.name] ?? 4); i++) {
        const start = e.randomPoint(1.2, this.rng);
        const person = new Visitor({ x: start.x, z: start.z, yaw: this.rng.float(0, 6) }, this.rng.chance(0.25), false, this.rng.fork('captive'));
        this.group.add(person.root);
        const c = { person, enclosure: e };
        this.captives.push(c);
        this.planCaptive(c);
      }
    }

    // Animals on the paths, already mid-visit so the scene starts busy.
    const species: SpeciesId[] = [
      ...(['zebra', 'zebra', 'zebra', 'elephant', 'elephant', 'lion', 'lion', 'giraffe', 'giraffe'] as SpeciesId[]),
      ...(['penguin', 'penguin', 'penguin', 'penguin', 'monkey', 'monkey', 'monkey'] as SpeciesId[]),
    ];
    this.buildExtras();
    for (const sp of species) {
      const t = new Tourist(sp);
      this.group.add(t.root);
      this.tourists.push(t);
      this.planTourist(t, true);
    }
  }

  /** Snorkelers in the reef lagoon, swim rings in the penguin pool, one-legged people in the flamingo pond. */
  private buildExtras(): void {
    const person = () => {
      const p = buildPerson(this.rng.chance(0.3), false, this.rng.fork('extra'));
      this.group.add(p.root);
      return p;
    };
    const snorkel = new THREE.MeshStandardMaterial({ color: '#ff9a4d', roughness: 0.5 });
    for (let i = 0; i < 4; i++) {
      const p = person();
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.35, 6), snorkel);
      tube.position.set(0.12, 0.3, -0.05);
      p.head.add(tube);
      p.root.rotation.order = 'YXZ';
      const r = 4 + i * 1.6;
      const speed = 0.12 + i * 0.03;
      this.extras.push((t) => {
        // Face down at the surface, gliding around the lagoon and kicking.
        const a = t * speed + i * 1.7;
        p.root.position.set(LAGOON.x + Math.cos(a) * r, 1.32, LAGOON.z + Math.sin(a) * r);
        p.root.rotation.set(Math.PI / 2, Math.atan2(-Math.sin(a), Math.cos(a)), 0);
        poseSwim(p, t * 6 + i);
      });
    }
    const pool = this.enclosures.find((e) => e.name === 'Penguin Point')?.pond;
    if (pool) {
      const ringMat = new THREE.MeshStandardMaterial({ color: '#e8443a', roughness: 0.5 });
      for (let i = 0; i < 3; i++) {
        const p = person();
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.11, 8, 16).rotateX(Math.PI / 2), ringMat);
        ring.position.y = 1.0;
        p.root.add(ring);
        p.shoulders.forEach((sh, k) => (sh.rotation.z = (k === 0 ? 1 : -1) * 1.3)); // arms resting on the ring
        this.extras.push((t) => {
          const x = pool.x + Math.sin(t * 0.07 + i * 2) * pool.r * 0.5;
          const z = pool.z + Math.cos(t * 0.05 + i * 1.3) * pool.r * 0.45;
          p.root.position.set(x, -0.95 + Math.sin(t * 1.5 + i) * 0.05, z);
          p.root.rotation.y = t * 0.2 + i;
        });
      }
    }
    for (let i = 0; i < 4; i++) {
      const p = person();
      const a = (i / 4) * Math.PI * 2 + 0.5;
      const x = FLAMINGO_POND.x + Math.cos(a) * 3;
      const z = FLAMINGO_POND.z + Math.sin(a) * 3;
      this.extras.push((t) => {
        // Standing on one leg like a flamingo, arms out for balance.
        p.root.position.set(x, 0, z);
        p.root.rotation.y = a + Math.PI + Math.sin(t * 0.3 + i) * 0.3;
        p.hips[1].rotation.x = -0.6;
        p.knees[1].rotation.x = 2.3;
        p.shoulders.forEach((sh, k) => (sh.rotation.z = (k === 0 ? 1 : -1) * (1.3 + Math.sin(t * 2 + i) * 0.15)));
        p.pose.rotation.z = Math.sin(t * 1.7 + i) * 0.05;
      });
    }
  }

  private planTourist(t: Tourist, teleport = false): void {
    if (t.plan && t.plan.kind !== 'stroll') this.takenTourist.delete(t.plan.spot);
    const r = Math.random();
    let plan: Plan | null = null;
    if (r < 0.55) {
      const free = DECK_SPOTS.filter((d) => !this.takenTourist.has(d.spot));
      if (free.length) {
        const d = pick(free);
        plan = { kind: 'view', spot: d.spot, enclosure: d.enclosure };
      }
    } else if (r < 0.8 && t.species !== 'elephant' && t.species !== 'giraffe') {
      // Elephants and giraffes don't fit on benches.
      const free = BENCH_SPOTS.filter((s) => !this.takenTourist.has(s));
      if (free.length) plan = { kind: 'bench', spot: pick(free) };
    }
    if (!plan) {
      const onPlaza = Math.random() < 0.5;
      const a = Math.random() * Math.PI * 2;
      const rr = randFloat(4, PLAZA.r - 1.8);
      plan = {
        kind: 'stroll',
        spot: onPlaza
          ? { x: PLAZA.x + Math.cos(a) * rr, z: PLAZA.z + Math.sin(a) * rr, yaw: a + Math.PI }
          : { x: randFloat(-2.8, 2.8), z: randFloat(-14, 24), yaw: Math.random() * 6 },
      };
    }
    if (plan.kind !== 'stroll') this.takenTourist.add(plan.spot);
    t.go(plan, teleport);
  }

  private planCaptive(c: Captive): void {
    const p = c.person;
    if (p.activity && (p.activity.kind === 'view' || p.activity.kind === 'rest')) this.takenFence.delete(p.activity.spot);
    const e = c.enclosure;
    const r = Math.random();
    const from = p.position;
    const route = (to: THREE.Vector3) => (e.findPath(from, to, 0.4) ?? [to]).map((v): [number, number] => [v.x, v.z]);

    if (r < 0.6) {
      // Up against the fence, watching (and photographing) the animals on the deck.
      const free = (this.fenceSpots.get(e) ?? []).filter((s) => !this.takenFence.has(s));
      if (free.length) {
        const spot = pick(free);
        this.takenFence.add(spot);
        p.goVia(route(new THREE.Vector3(spot.x, 0, spot.z)), { kind: 'view', spot, enclosure: e.name });
        return;
      }
    }
    const to = e.randomPoint(1.2, this.rng);
    const spot = { x: to.x, z: to.z, yaw: Math.random() * Math.PI * 2 };
    p.goVia(route(to), r < 0.8 ? { kind: 'stroll', spot } : { kind: 'rest', spot });
  }
}

/** Kicking legs and stroking arms for a swimmer lying face down. */
function poseSwim(p: PersonModel, phase: number): void {
  p.hips.forEach((h, i) => (h.rotation.x = Math.sin(phase + i * Math.PI) * 0.35));
  p.knees.forEach((k) => (k.rotation.x = 0.2));
  p.shoulders.forEach((sh, i) => (sh.rotation.x = -2.6 + Math.sin(phase * 0.5 + i * Math.PI) * 0.6));
}
