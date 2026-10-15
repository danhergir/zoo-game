import * as THREE from 'three';
import type { Feeder } from '../feeder';
import { routeOnPaths, type Spot } from '../layout';
import type { Rng } from '../rng';
import { buildPerson, type PersonModel } from './person';

export type Activity =
  | { kind: 'view'; spot: Spot; enclosure: string }
  | { kind: 'sit'; spot: Spot }
  | { kind: 'stroll'; spot: Spot }
  | { kind: 'feed'; spot: Spot; feeder: Feeder }
  | { kind: 'rest'; spot: Spot }
  | { kind: 'exit'; spot: Spot };

type Phase = 'walking' | 'busy' | 'leaving' | 'done';
type Gesture = 'photo' | 'point' | 'wave';
export type Treat = 'carrot' | 'apple' | 'leaves';

// Small props shared by everyone, attached to the right hand when needed.
const propMats = {
  phone: new THREE.MeshStandardMaterial({ color: '#22252b', roughness: 0.4 }),
  flash: new THREE.MeshBasicMaterial({ color: '#ffffff' }),
  carrot: new THREE.MeshStandardMaterial({ color: '#f28c28', roughness: 0.7 }),
  leaf: new THREE.MeshStandardMaterial({ color: '#4f9a3a', roughness: 0.8 }),
  apple: new THREE.MeshStandardMaterial({ color: '#d63a32', roughness: 0.5 }),
  twig: new THREE.MeshStandardMaterial({ color: '#6e4b2e', roughness: 0.9 }),
};
const propGeo = {
  phone: new THREE.BoxGeometry(0.09, 0.16, 0.02),
  flash: new THREE.SphereGeometry(0.06, 8, 6),
  carrot: new THREE.ConeGeometry(0.045, 0.24, 8).rotateX(Math.PI / 2),
  leaf: new THREE.ConeGeometry(0.04, 0.08, 5).rotateX(-Math.PI / 2).translate(0, 0, -0.15),
  apple: new THREE.SphereGeometry(0.07, 10, 8),
  twig: new THREE.CylinderGeometry(0.015, 0.02, 0.45, 5).rotateX(Math.PI / 2),
  leafBlade: new THREE.SphereGeometry(0.07, 8, 6).scale(1, 0.35, 1.6),
};

const { lerp, clamp } = THREE.MathUtils;

function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/**
 * One person walking the zoo: a guest, or a keeper on a feeding run. Walks
 * waypoint routes along the paths, then does its current activity (watching,
 * sitting, strolling, feeding) until its manager gives it the next one.
 */
export class Visitor {
  readonly root: THREE.Group;
  activity: Activity | null = null;
  /** How many more things this guest wants to do before leaving. */
  plansLeft: number;
  /** Walks faster, e.g. when the zoo is closing. */
  hurry = false;
  phase: Phase = 'walking';
  /** Called when the guest reaches the spot for its current activity. */
  onArrive: ((v: Visitor) => void) | null = null;

  private readonly model: PersonModel;
  private readonly lane: number;
  private readonly speed: number;
  private readonly baseScale: number;
  /** 0..1 pop-in when arriving, back to 0 when leaving. */
  private appear = 0;
  private readonly route: THREE.Vector3[] = [];
  private timer = 0;
  private yaw = 0;
  private stride: number;
  private time: number;
  private walking = false;
  private cheer = 0;
  private gesture: Gesture | null = null;
  private gestureTime = 0;
  private nextGesture: number;
  private startleTime = 0;
  private offering: Treat | null = null;
  private readonly hand = new THREE.Group();
  private readonly phone = new THREE.Mesh(propGeo.phone, propMats.phone);
  private readonly flash = new THREE.Mesh(propGeo.flash, propMats.flash);
  private readonly treats: Record<Treat, THREE.Object3D>;

  /** `rng` drives everything this person does; give each person its own stream. */
  constructor(
    start: Spot,
    readonly child: boolean,
    readonly keeper: boolean,
    private readonly rng: Rng,
  ) {
    this.plansLeft = rng.int(2) + 2;
    this.lane = rng.float(-2.6, 2.6);
    this.speed = rng.float(1.7, 2.2);
    this.stride = rng.float(0, 10);
    this.time = rng.float(0, 10);
    this.nextGesture = rng.float(1, 3);
    this.model = buildPerson(child, keeper, rng);
    this.root = this.model.root;
    this.baseScale = this.root.scale.x;
    this.root.scale.setScalar(0.001);
    this.root.position.set(start.x, 0, start.z);
    this.yaw = start.yaw;

    // Props live at the right hand and are toggled on and off.
    this.hand.position.set(0, -0.47, 0.07);
    this.model.shoulders[0].add(this.hand);
    this.flash.position.set(0, 0.05, 0.03);
    this.phone.add(this.flash);
    const carrot = new THREE.Group();
    carrot.add(new THREE.Mesh(propGeo.carrot, propMats.carrot), new THREE.Mesh(propGeo.leaf, propMats.leaf));
    // A leafy acacia branch for the giraffes.
    const leaves = new THREE.Group();
    leaves.add(new THREE.Mesh(propGeo.twig, propMats.twig));
    for (const [x, y, z] of [[0.05, 0.03, 0.12], [-0.05, 0.04, 0.18], [0.02, -0.03, 0.22]]) {
      const leaf = new THREE.Mesh(propGeo.leafBlade, propMats.leaf);
      leaf.position.set(x, y, z);
      leaves.add(leaf);
    }
    this.treats = { carrot, apple: new THREE.Mesh(propGeo.apple, propMats.apple), leaves };
    for (const p of [this.phone, this.flash, ...Object.values(this.treats)]) p.visible = false;
    this.hand.add(this.phone, ...Object.values(this.treats));
  }

  /** Hold out a treat for an animal at the fence. */
  offerTreat(treat: Treat): void {
    this.offering = treat;
    this.gesture = null;
    this.treats[treat].visible = true;
  }

  /** The animal took it (or gave up): put the hand down. */
  endTreat(): void {
    if (this.offering) this.treats[this.offering].visible = false;
    this.offering = null;
    this.nextGesture = this.rng.float(1, 3);
  }

  get offeringTreat(): boolean {
    return this.offering !== null;
  }

  /** Jump back with hands up, e.g. when a lion roars. */
  startle(): void {
    this.startleTime = 0.9;
    this.endTreat();
  }

  /** Something held in front of the chest (a hay bale, a bucket); null to put it away. */
  hold(item: THREE.Object3D | null): void {
    this.model.carry.clear();
    if (item) this.model.carry.add(item);
  }

  /** Remaining time on the current activity, in seconds. */
  get timeLeft(): number {
    return this.timer;
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
    this.startleTime = Math.max(0, this.startleTime - dt);
    this.updateGesture(dt);
    this.animate(dt);
  }

  /** Walk the zoo's paths to `to` (see routeOnPaths). */
  private planRoute(to: Spot): void {
    this.setRoute(routeOnPaths(this.root.position, to, this.lane));
  }

  /** Walk an explicit list of waypoints, e.g. a route inside an enclosure. */
  goVia(points: [number, number][], activity: Activity): void {
    this.activity = activity;
    this.phase = 'walking';
    this.setRoute(points);
  }

  private setRoute(pts: [number, number][]): void {
    this.route.length = 0;
    let last = this.root.position.clone();
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
    this.timer =
      a.kind === 'view'
        ? this.rng.float(7, 13)
        : a.kind === 'sit' || a.kind === 'rest'
          ? this.rng.float(10, 18)
          : a.kind === 'feed'
            ? 5
            : this.rng.float(2, 5);
    this.onArrive?.(this);
  }


  /** While watching animals: take photos, point and wave now and then. */
  private updateGesture(dt: number): void {
    const watching = this.phase === 'busy' && this.activity?.kind === 'view';
    if (this.gesture) {
      this.gestureTime -= dt;
      // The camera flash fires once, partway through a photo.
      this.flash.visible = this.gesture === 'photo' && this.gestureTime > 0.9 && this.gestureTime < 1.05;
      if (this.gestureTime <= 0 || !watching) {
        this.gesture = null;
        this.phone.visible = this.flash.visible = false;
        this.nextGesture = this.rng.float(2, 5);
      }
      return;
    }
    if (!watching || this.offering || this.startleTime > 0) return;
    this.nextGesture -= dt;
    if (this.nextGesture > 0) return;
    const r = this.rng.next();
    this.gesture = r < 0.45 ? 'photo' : r < 0.75 ? 'point' : 'wave';
    this.gestureTime = this.gesture === 'photo' ? 2.2 : 1.8;
    this.phone.visible = this.gesture === 'photo';
  }

  private animate(dt: number): void {
    const m = this.model;
    const k = 1 - Math.exp(-dt * 10);
    const sitting = this.phase === 'busy' && this.activity?.kind === 'sit';
    const tossing = this.phase === 'busy' && this.activity?.kind === 'feed';
    // Sitting on the ground, legs out in front.
    const resting = this.phase === 'busy' && this.activity?.kind === 'rest';
    const carrying = m.carry.children.length > 0;
    const spot = this.activity?.spot;
    if (this.phase === 'busy' && spot) this.yaw = lerpAngle(this.yaw, spot.yaw, k);
    this.root.rotation.y = this.yaw;

    const swing = this.walking ? Math.sin(this.stride) * 0.55 : 0;
    m.hips.forEach((hip, i) => {
      const s = i === 0 ? swing : -swing;
      hip.rotation.x = lerp(hip.rotation.x, sitting || resting ? -1.5 : s, k);
    });
    m.knees.forEach((knee, i) => {
      const phase = this.stride + (i === 0 ? 0 : Math.PI);
      const bend = this.walking ? Math.max(0, -Math.cos(phase)) * 0.8 : 0;
      knee.rotation.x = lerp(knee.rotation.x, sitting ? 1.5 : bend, k);
    });

    // Arms swing opposite the legs; hold things in front; toss food over the fence; wave when excited.
    m.shoulders.forEach((sh, i) => {
      const side = i === 0 ? 1 : -1;
      let x = this.walking ? -(i === 0 ? swing : -swing) * 0.8 : 0;
      let z = side * 0.08;
      if (carrying) {
        x = -1.1;
        z = -side * 0.12;
      }
      if (tossing) {
        x = -1.5 + Math.sin(this.time * 5) * 0.7;
        z = -side * 0.1;
      }
      if (i === 0) {
        if (this.gesture === 'photo') {
          x = -1.95; // phone up at eye level
          z = -0.25;
        } else if (this.gesture === 'point') {
          x = -1.6;
          z = 0.05;
        }
        if (this.offering) {
          x = -1.45; // arm straight out over the fence
          z = 0;
        }
      }
      if ((this.cheer > 0 || this.gesture === 'wave') && i === 0) {
        x = -2.6;
        z = side * (0.3 + Math.sin(this.time * 14) * 0.25);
      }
      if (this.startleTime > 0) {
        x = -2.4;
        z = side * 0.5;
      }
      if (sitting) x = -0.35;
      if (resting) x = 0.45; // leaning back on the hands
      sh.rotation.x = lerp(sh.rotation.x, x, k);
      sh.rotation.z = lerp(sh.rotation.z, z, k);
    });

    // Sitting lowers the body so the thighs rest on a 0.52-high seat.
    const s = this.baseScale;
    const sitDrop = (0.61 - m.hipHeight * s) / s;
    const bob = this.walking ? Math.abs(Math.sin(this.stride)) * 0.04 : 0;
    const hop = this.cheer > 0 ? Math.abs(Math.sin(this.time * 9)) * 0.12 : this.startleTime > 0.5 ? 0.15 : 0;
    const groundDrop = (0.1 - m.hipHeight * s) / s;
    m.pose.position.y = lerp(m.pose.position.y, resting ? groundDrop : sitting ? sitDrop : bob + hop, k);
    m.pose.position.z = lerp(m.pose.position.z, sitting ? -0.12 : this.startleTime > 0 ? -0.45 : 0, k);
    // Kids at aquarium glass lean in with their hands on it.
    const pressing = this.child && this.phase === 'busy' && this.activity?.kind === 'view' && this.activity.spot.glass === true;
    m.pose.rotation.x = lerp(m.pose.rotation.x, pressing ? 0.22 : 0, k);
    if (pressing && !this.gesture && !this.offering) {
      m.shoulders.forEach((sh) => (sh.rotation.x = lerp(sh.rotation.x, -1.55, k)));
    }

    m.head.rotation.y = this.phase === 'busy' && !sitting && !resting ? Math.sin(this.time * 0.7) * 0.35 : 0;
  }
}
