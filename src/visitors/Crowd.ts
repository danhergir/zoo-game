import * as THREE from 'three';
import type { Animal } from '../animals/Animal';
import { BOULEVARD_Z, DECKS, EXIT_X, PLAZA, SEATS, type Spot } from '../layout';
import { Visitor, type Activity } from './Visitor';

const MAX_VISITORS = 36;
/** Guests arrive while the zoo is open, until shortly before closing. */
const ARRIVE_FROM = 9;
const ARRIVE_UNTIL = 16.5;
const CLOSE_HOUR = 18;

export interface CrowdHooks {
  animals: Animal[];
}

/** Spawns guests, hands them things to do, and sends them home at closing. */
export class Crowd {
  readonly visitors: Visitor[] = [];
  private readonly taken = new Set<Spot>();
  private spawnTimer = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly hooks: CrowdHooks,
  ) {}

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
      this.spawnTimer = THREE.MathUtils.randFloat(1.5, 4.5) / (0.3 + this.rating);
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

    for (let i = this.visitors.length - 1; i >= 0; i--) {
      const v = this.visitors[i];
      if (v.phase !== 'done') continue;
      this.scene.remove(v.root);
      this.visitors.splice(i, 1);
    }
  }

  private spawn(): void {
    const fromRight = Math.random() < 0.5;
    const start = {
      x: fromRight ? EXIT_X : -EXIT_X,
      z: BOULEVARD_Z + THREE.MathUtils.randFloat(-1.8, 1.8),
      yaw: fromRight ? -Math.PI / 2 : Math.PI / 2,
    };
    const v = new Visitor(start, Math.random() < 0.25);
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

    const roll = Math.random();
    const activity = (roll < 0.65 && this.viewActivity()) || (roll < 0.85 && this.sitActivity()) || this.strollActivity();
    if (activity.kind !== 'stroll') this.taken.add(activity.spot);
    v.start(activity);
  }

  /** When a guest reaches a viewing deck: react to what they see. */
  private react(v: Visitor): void {
    const a = v.activity;
    if (a?.kind !== 'view') return;
    const animals = this.hooks.animals.filter((x) => x.enclosure.name === a.enclosure);
    const visible = animals.filter((x) => x.state !== 'sleep' && x.position.distanceTo(v.position) < 26);
    const mood = animals.reduce((s, x) => s + x.happiness, 0) / animals.length;
    if (visible.length > 0 && mood > 0.75) v.celebrate();
  }

  private viewActivity(): Activity | null {
    const options = DECKS.flatMap((d) =>
      d.spots.filter((s) => !this.taken.has(s)).map((spot) => ({ kind: 'view' as const, spot, enclosure: d.enclosure })),
    );
    return options.length ? options[Math.floor(Math.random() * options.length)] : null;
  }

  private sitActivity(): Activity | null {
    const free = SEATS.filter((s) => !this.taken.has(s));
    return free.length ? { kind: 'sit', spot: free[Math.floor(Math.random() * free.length)] } : null;
  }

  private strollActivity(): Activity {
    // Somewhere on the plaza (around the planter) or along the avenue.
    if (Math.random() < 0.6) {
      const a = Math.random() * Math.PI * 2;
      const r = THREE.MathUtils.randFloat(3.4, PLAZA.r - 1.5);
      return { kind: 'stroll', spot: { x: PLAZA.x + Math.cos(a) * r, z: PLAZA.z + Math.sin(a) * r, yaw: a + Math.PI } };
    }
    return {
      kind: 'stroll',
      spot: { x: THREE.MathUtils.randFloat(-3.5, 3.5), z: THREE.MathUtils.randFloat(-15, 26), yaw: Math.random() * 6 },
    };
  }

  private exitSpot(v: Visitor): Spot {
    const right = v.position.x > 0 ? Math.random() < 0.8 : Math.random() < 0.2;
    return { x: right ? EXIT_X : -EXIT_X, z: BOULEVARD_Z + THREE.MathUtils.randFloat(-2, 2), yaw: 0 };
  }

  private release(v: Visitor): void {
    if (v.activity) this.taken.delete(v.activity.spot);
  }
}
