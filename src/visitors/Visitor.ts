import * as THREE from 'three';
import { BOULEVARD_Z, EXIT_X, type Spot } from '../layout';
import { buildPerson, type PersonModel } from './person';

export type Activity =
  | { kind: 'view'; spot: Spot; enclosure: string }
  | { kind: 'sit'; spot: Spot }
  | { kind: 'stroll'; spot: Spot }
  | { kind: 'exit'; spot: Spot };

type Phase = 'walking' | 'busy' | 'leaving' | 'done';

const { lerp, randFloat, clamp } = THREE.MathUtils;

function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/** Avenue section visitors walk along, between the gate and the plaza. */
const SPINE_MIN_Z = -18;
const SPINE_MAX_Z = 29.5;

/**
 * One guest. Walks waypoint routes along the paths, then does its current
 * activity (watching, sitting, strolling) until the crowd gives it the next one.
 */
export class Visitor {
  readonly root: THREE.Group;
  activity: Activity | null = null;
  /** How many more things this guest wants to do before leaving. */
  plansLeft = Math.floor(randFloat(2, 4));
  /** Walks faster, e.g. when the zoo is closing. */
  hurry = false;
  phase: Phase = 'walking';
  /** Called when the guest reaches the spot for its current activity. */
  onArrive: ((v: Visitor) => void) | null = null;

  private readonly model: PersonModel;
  private readonly lane = randFloat(-2.6, 2.6);
  private readonly speed = randFloat(1.7, 2.2);
  private readonly baseScale: number;
  /** 0..1 pop-in when arriving, back to 0 when leaving. */
  private appear = 0;
  private readonly route: THREE.Vector3[] = [];
  private timer = 0;
  private yaw = 0;
  private stride = Math.random() * 10;
  private time = Math.random() * 10;
  private walking = false;
  private cheer = 0;

  constructor(fromRight: boolean, readonly child: boolean) {
    this.model = buildPerson(child);
    this.root = this.model.root;
    this.baseScale = this.root.scale.x;
    this.root.scale.setScalar(0.001);
    const x = fromRight ? EXIT_X : -EXIT_X;
    this.root.position.set(x, 0, BOULEVARD_Z + this.lane * 0.7);
    this.yaw = fromRight ? -Math.PI / 2 : Math.PI / 2;
  }

  get position(): THREE.Vector3 {
    return this.root.position;
  }

  /** Has finished its activity (or arrived somewhere) and needs the next plan. */
  get idle(): boolean {
    return this.phase === 'busy' && this.timer <= 0;
  }

  start(activity: Activity): void {
    this.activity = activity;
    this.phase = 'walking';
    this.planRoute(activity.spot);
  }

  /** Jump and wave for a moment. */
  celebrate(): void {
    this.cheer = 1.2;
  }

  update(dt: number): void {
    this.time += dt;
    if (this.phase === 'walking') this.walk(dt);
    else if (this.phase === 'busy') this.timer -= dt;

    // Pop in on arrival, shrink away at the exit.
    const leaving = this.phase === 'leaving';
    this.appear = clamp(this.appear + (leaving ? -dt : dt) * 3, 0, 1);
    this.root.scale.setScalar(Math.max(0.001, this.baseScale * this.appear));
    if (leaving && this.appear === 0) this.phase = 'done';

    this.cheer = Math.max(0, this.cheer - dt);
    this.animate(dt);
  }

  /**
   * Route along the walkable network: boulevard <-> gate <-> avenue spine <-> target.
   * Every leg is a straight line that stays on paths, decks or the plaza.
   */
  private planRoute(to: Spot): void {
    const from = this.root.position;
    const lane = this.lane;
    const bz = BOULEVARD_Z + lane * 0.7;
    const onBoulevard = (z: number) => z > SPINE_MAX_Z;
    const pts: [number, number][] = [];
    if (onBoulevard(from.z)) pts.push([from.x, bz], [lane, bz]);
    else pts.push([lane, clamp(from.z, SPINE_MIN_Z, SPINE_MAX_Z)]);
    if (onBoulevard(to.z)) pts.push([lane, bz], [to.x, bz]);
    else pts.push([lane, clamp(to.z, SPINE_MIN_Z, SPINE_MAX_Z)]);
    pts.push([to.x, to.z]);

    this.route.length = 0;
    let last = from.clone();
    for (const [x, z] of pts) {
      const p = new THREE.Vector3(x, 0, z);
      if (p.distanceTo(last) > 0.05) this.route.push(p);
      last = p;
    }
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
    const step = Math.min(dist, this.speed * (this.child ? 1.1 : 1) * (this.hurry ? 1.6 : 1) * dt);
    if (dist > 1e-4) {
      p.x += (dx / dist) * step;
      p.z += (dz / dist) * step;
      this.yaw = lerpAngle(this.yaw, Math.atan2(dx, dz), 1 - Math.exp(-dt * 10));
    }
    this.stride += (step / (0.45 * this.baseScale)) * 1.1;
    this.walking = true;
    if (dist - step < 0.02) this.route.shift();
  }

  private arrive(): void {
    this.walking = false;
    const a = this.activity;
    if (!a) return;
    this.phase = a.kind === 'exit' ? 'leaving' : 'busy';
    this.timer = a.kind === 'view' ? randFloat(7, 13) : a.kind === 'sit' ? randFloat(10, 18) : randFloat(2, 5);
    this.onArrive?.(this);
  }


  private animate(dt: number): void {
    const m = this.model;
    const k = 1 - Math.exp(-dt * 10);
    const sitting = this.phase === 'busy' && this.activity?.kind === 'sit';
    const spot = this.activity?.spot;
    if (this.phase === 'busy' && spot) this.yaw = lerpAngle(this.yaw, spot.yaw, k);
    this.root.rotation.y = this.yaw;

    const swing = this.walking ? Math.sin(this.stride) * 0.55 : 0;
    m.hips.forEach((hip, i) => {
      const s = i === 0 ? swing : -swing;
      hip.rotation.x = lerp(hip.rotation.x, sitting ? -1.5 : s, k);
    });
    m.knees.forEach((knee, i) => {
      const phase = this.stride + (i === 0 ? 0 : Math.PI);
      const bend = this.walking ? Math.max(0, -Math.cos(phase)) * 0.8 : 0;
      knee.rotation.x = lerp(knee.rotation.x, sitting ? 1.5 : bend, k);
    });

    // Arms swing opposite the legs; raised and waving when excited.
    m.shoulders.forEach((sh, i) => {
      const side = i === 0 ? 1 : -1;
      let x = this.walking ? -(i === 0 ? swing : -swing) * 0.8 : 0;
      let z = side * 0.08;
      if (this.cheer > 0 && i === 0) {
        x = -2.6;
        z = side * (0.3 + Math.sin(this.time * 14) * 0.25);
      }
      if (sitting) x = -0.35;
      sh.rotation.x = lerp(sh.rotation.x, x, k);
      sh.rotation.z = lerp(sh.rotation.z, z, k);
    });

    // Sitting lowers the body so the thighs rest on a 0.52-high seat.
    const s = this.baseScale;
    const sitDrop = (0.61 - m.hipHeight * s) / s;
    const bob = this.walking ? Math.abs(Math.sin(this.stride)) * 0.04 : 0;
    const hop = this.cheer > 0 ? Math.abs(Math.sin(this.time * 9)) * 0.12 : 0;
    m.pose.position.y = lerp(m.pose.position.y, sitting ? sitDrop : bob + hop, k);
    m.pose.position.z = lerp(m.pose.position.z, sitting ? -0.12 : 0, k);

    m.head.rotation.y = this.phase === 'busy' && !sitting ? Math.sin(this.time * 0.7) * 0.35 : 0;
  }
}
