import * as THREE from 'three';
import type { Feeder } from '../feeder';
import { PLAYGROUND, routeOnPaths, type Spot, type StandItem } from '../layout';
import type { Rng } from '../rng';
import { buildPerson, type PersonModel } from './person';

export type Activity =
  | { kind: 'view'; spot: Spot; enclosure: string }
  | { kind: 'sit'; spot: Spot }
  | { kind: 'stroll'; spot: Spot }
  | { kind: 'feed'; spot: Spot; feeder: Feeder }
  | { kind: 'rest'; spot: Spot }
  | { kind: 'queue'; spot: Spot; stand: number; front: boolean }
  | { kind: 'shop'; spot: Spot }
  | { kind: 'swing'; spot: Spot; seat: number }
  | { kind: 'slide'; spot: Spot }
  | { kind: 'dig'; spot: Spot }
  | { kind: 'picnic'; spot: Spot }
  | { kind: 'supervise'; spot: Spot }
  | { kind: 'follow'; spot: Spot }
  | { kind: 'exit'; spot: Spot };

/** Something a visitor walks around with. */
export type Item = StandItem | 'plush';

const SWING_PIVOT_Y = 2.3;
const SWING_ROPE = 1.67;
/** Seconds per slide loop: climb, sit at the top, slide down, walk back round. */
const SLIDE_LOOP = 6;

type Phase = 'walking' | 'busy' | 'leaving' | 'done';
type Gesture = 'photo' | 'point' | 'wave';
export type Treat = 'carrot' | 'apple' | 'leaves';

// Small props shared by everyone, attached to the right hand when needed.
const propMats = {
  phone: new THREE.MeshStandardMaterial({ color: '#22252b', roughness: 0.4 }),
  flash: new THREE.MeshBasicMaterial({ color: '#ffffff' }),
  carrot: new THREE.MeshStandardMaterial({ color: '#f28c28', roughness: 0.7 }),
  wafer: new THREE.MeshStandardMaterial({ color: '#d9a05b', roughness: 0.8 }),
  bun: new THREE.MeshStandardMaterial({ color: '#e3b170', roughness: 0.8 }),
  sausage: new THREE.MeshStandardMaterial({ color: '#b8452f', roughness: 0.6 }),
  string: new THREE.MeshBasicMaterial({ color: '#dddddd' }),
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
  cone: new THREE.ConeGeometry(0.045, 0.14, 8).rotateX(Math.PI).translate(0, 0.05, 0),
  scoop: new THREE.SphereGeometry(0.055, 8, 6).translate(0, 0.14, 0),
  bun: new THREE.CapsuleGeometry(0.035, 0.14, 3, 6).rotateX(Math.PI / 2),
  sausage: new THREE.CapsuleGeometry(0.022, 0.18, 3, 6).rotateX(Math.PI / 2).translate(0, 0.03, 0),
  string: new THREE.CylinderGeometry(0.004, 0.004, 1.25, 3).translate(0, 0.62, 0),
  balloon: new THREE.SphereGeometry(0.22, 12, 10).scale(1, 1.18, 1),
  plushBody: new THREE.SphereGeometry(0.1, 8, 6),
  plushHead: new THREE.SphereGeometry(0.075, 8, 6).translate(0, 0.13, 0.02),
  plushEar: new THREE.SphereGeometry(0.03, 6, 4),
};

const BALLOON_COLORS = ['#e8443a', '#4f8fdc', '#ffd23f', '#6cc28a', '#c77dff', '#ff7aa8'];
const SCOOP_COLORS = ['#ffb3cf', '#fff3d6', '#8b5a3c', '#a6e3a1', '#ffd23f'];
const PLUSH_COLORS = ['#9a6a42', '#d9a457', '#979aa0', '#f2dcab', '#1e2328'];

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
  /** Family: the parent this kid follows (null for parents and solo guests), and the kids following them. */
  leader: Visitor | null = null;
  readonly followers: Visitor[] = [];
  /** Lifted up by a parent at a viewing deck (kids). */
  lifted = false;
  /** Holding an umbrella (it's raining). */
  umbrella = false;
  private umbrellaProp: THREE.Group | null = null;
  /** Current swing angle while on a swing (the seat follows it). */
  swingAngle = 0;
  /** What they're carrying, and for how long (cones and hot dogs get finished). */
  item: Item | null = null;
  private itemTime = 0;
  private readonly itemProps = new THREE.Group();
  /** The balloon floats above on its string, attached to the body rather than the swinging hand. */
  private readonly balloonProp = new THREE.Group();
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
    this.hand.add(this.itemProps);
    this.balloonProp.position.set(0.22, 1.0, 0.12);
    this.root.add(this.balloonProp);
    this.treats = { carrot, apple: new THREE.Mesh(propGeo.apple, propMats.apple), leaves };
    for (const p of [this.phone, this.flash, ...Object.values(this.treats)]) p.visible = false;
    this.hand.add(this.phone, ...Object.values(this.treats));
  }

  /** Start carrying an item (or nothing). */
  carry(item: Item | null): void {
    this.item = item;
    this.itemTime = item === 'icecream' || item === 'hotdog' ? this.rng.float(20, 35) : Infinity;
    this.itemProps.clear();
    this.balloonProp.clear();
    if (item === 'icecream') {
      const scoop = new THREE.Mesh(
        propGeo.scoop,
        new THREE.MeshStandardMaterial({ color: this.rng.pick(SCOOP_COLORS), roughness: 0.6 }),
      );
      this.itemProps.add(new THREE.Mesh(propGeo.cone, propMats.wafer), scoop);
    } else if (item === 'hotdog') {
      this.itemProps.add(new THREE.Mesh(propGeo.bun, propMats.bun), new THREE.Mesh(propGeo.sausage, propMats.sausage));
    } else if (item === 'plush') {
      const fur = new THREE.MeshStandardMaterial({ color: this.rng.pick(PLUSH_COLORS), roughness: 0.9 });
      const ears = [0.05, -0.05].map((x) => {
        const ear = new THREE.Mesh(propGeo.plushEar, fur);
        ear.position.set(x, 0.2, 0.02);
        return ear;
      });
      this.itemProps.add(new THREE.Mesh(propGeo.plushBody, fur), new THREE.Mesh(propGeo.plushHead, fur), ...ears);
    } else if (item === 'balloon') {
      const balloon = new THREE.Mesh(
        propGeo.balloon,
        new THREE.MeshStandardMaterial({ color: this.rng.pick(BALLOON_COLORS), roughness: 0.35 }),
      );
      balloon.position.y = 1.45;
      this.balloonProp.add(new THREE.Mesh(propGeo.string, propMats.string), balloon);
    }
    this.itemProps.traverse((o) => (o.castShadow = true));
  }

  /** Open an umbrella over their head in the rain (made on first use, in their own color). */
  private updateUmbrella(): void {
    if (this.umbrella && !this.umbrellaProp && !this.keeper) {
      const canopy = new THREE.Mesh(
        new THREE.ConeGeometry(0.75, 0.3, 10, 1, true),
        new THREE.MeshStandardMaterial({ color: this.rng.pick(BALLOON_COLORS), roughness: 0.5, side: THREE.DoubleSide }),
      );
      canopy.position.y = 2.15;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.9, 4), propMats.string);
      pole.position.set(-0.2, 1.75, 0.05);
      this.umbrellaProp = new THREE.Group();
      this.umbrellaProp.add(canopy, pole);
      canopy.castShadow = true;
      this.root.add(this.umbrellaProp);
    }
    if (this.umbrellaProp) this.umbrellaProp.visible = this.umbrella;
  }

  /** World position of the balloon (for when it slips away). */
  balloonWorld(out: THREE.Vector3): THREE.Vector3 {
    return this.balloonProp.localToWorld(out.set(0, 1.45, 0));
  }

  /** The balloon's color, for the one that floats away. */
  balloonColor(): THREE.Color | null {
    const mesh = this.balloonProp.children[1] as THREE.Mesh | undefined;
    return mesh ? (mesh.material as THREE.MeshStandardMaterial).color : null;
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
    this.root.position.y = 0;
    this.lifted = false;
    this.planRoute(activity.spot);
  }

  /** Jump and wave for a moment. */
  celebrate(): void {
    this.cheer = 1.2;
  }

  update(dt: number): void {
    this.time += dt;
    if (this.phase === 'walking') this.walk(dt);
    else if (this.phase === 'busy') {
      this.timer -= dt;
      this.play();
    }
    this.itemTime -= dt;
    if (this.itemTime <= 0 && this.item) this.carry(null); // finished the snack
    this.updateUmbrella();

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

  /** Swings, slide and sandbox: positions driven by how long they've been at it. */
  private play(): void {
    const a = this.activity;
    if (!a) return;
    if (a.kind === 'swing') {
      const s = PLAYGROUND.swings[a.seat];
      this.swingAngle = 0.55 * Math.sin(this.time * 2.2 + a.seat * 1.3);
      const seatY = SWING_PIVOT_Y - SWING_ROPE * Math.cos(this.swingAngle) + 0.03;
      this.root.position.set(s.x, seatY - 0.52, s.z + SWING_ROPE * Math.sin(this.swingAngle) + 0.12);
      this.yaw = 0;
    } else if (a.kind === 'slide') {
      this.slideAt(this.time % SLIDE_LOOP);
    }
  }

  /** Slide loop: climb the ladder, sit at the top, whoosh down, walk round to the ladder. */
  private slideAt(t: number): void {
    const { ladder, top, bottom } = PLAYGROUND.slide;
    const p = this.root.position;
    this.walking = false;
    if (t < 1.6) {
      p.set(ladder.x, (t / 1.6) * top, ladder.z - 0.15);
    } else if (t < 2.1) {
      p.set(ladder.x, top + 0.05 - 0.52, ladder.z + 0.55);
    } else if (t < 3.2) {
      const k = (t - 2.1) / 1.1;
      p.set(ladder.x, THREE.MathUtils.lerp(top + 0.05, 0.3, k) - 0.52, THREE.MathUtils.lerp(ladder.z + 0.55, bottom.z, k));
    } else {
      // Walk back round the side of the slide.
      const pts: [number, number][] = [
        [bottom.x, bottom.z],
        [bottom.x + 1.3, bottom.z - 0.4],
        [ladder.x + 1.3, ladder.z - 0.2],
        [ladder.x, ladder.z - 0.15],
      ];
      const k = ((t - 3.2) / (SLIDE_LOOP - 3.2)) * (pts.length - 1);
      const i = Math.min(pts.length - 2, Math.floor(k));
      const f = k - i;
      const x = THREE.MathUtils.lerp(pts[i][0], pts[i + 1][0], f);
      const z = THREE.MathUtils.lerp(pts[i][1], pts[i + 1][1], f);
      this.yaw = Math.atan2(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
      p.set(x, 0, z);
      this.walking = true;
      this.stride += 0.12;
    }
    if (t < 3.2) this.yaw = 0;
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
    const r = (lo: number, hi: number) => this.rng.float(lo, hi);
    const durations: Partial<Record<Activity['kind'], () => number>> = {
      view: () => r(7, 13),
      sit: () => r(10, 18),
      rest: () => r(10, 18),
      feed: () => 5,
      // Only the front of the line gets served; everyone else waits until the line moves up.
      queue: () => (a.kind === 'queue' && a.front ? 2.5 : Infinity),
      shop: () => r(3, 5),
      swing: () => r(12, 20),
      slide: () => SLIDE_LOOP * 3,
      dig: () => r(10, 18),
      picnic: () => r(15, 25),
      supervise: () => r(25, 40),
      follow: () => Infinity,
    };
    this.timer = (durations[a.kind] ?? (() => r(2, 5)))();
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
    const kind = this.phase === 'busy' ? this.activity?.kind : undefined;
    const slideT = kind === 'slide' ? this.time % SLIDE_LOOP : -1;
    const climbing = slideT >= 0 && slideT < 1.6;
    const onSlide = slideT >= 1.6 && slideT < 3.2;
    const sitting = kind === 'sit' || kind === 'picnic' || kind === 'swing' || onSlide;
    const tossing = kind === 'feed';
    // Sitting on the ground, legs out in front (resting, or digging in the sandbox).
    const resting = kind === 'rest' || kind === 'dig';
    const carrying = m.carry.children.length > 0;
    const holdingKid = this.followers.some((f) => f.lifted);
    const snacking = (this.item === 'icecream' || this.item === 'hotdog') && !this.gesture && !this.offering;
    const bite = snacking && (this.time % (kind === 'picnic' ? 3 : 5)) < 1.1;
    const spot = this.activity?.spot;
    if (this.phase === 'busy' && spot && kind !== 'slide') this.yaw = lerpAngle(this.yaw, spot.yaw, k);
    this.root.rotation.y = this.yaw;

    const swing = this.walking ? Math.sin(this.stride) * 0.55 : 0;
    m.hips.forEach((hip, i) => {
      const s = i === 0 ? swing : -swing;
      let target = sitting || resting ? -1.5 : s;
      if (climbing) target = -0.8 + Math.sin(this.time * 8 + i * Math.PI) * 0.6;
      if (this.lifted) target = -0.35; // legs dangling, held up
      hip.rotation.x = lerp(hip.rotation.x, target, k);
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
      if (kind === 'dig' && i === 0) x = -0.7 + Math.sin(this.time * 5) * 0.45;
      if (bite && i === 0) [x, z] = [-2.0, -0.45]; // a lick of ice cream, a bite of hot dog
      if (kind === 'swing') [x, z] = [-2.8, side * 0.12]; // holding the ropes
      if (climbing) x = -2.6 + Math.sin(this.time * 8 + i * Math.PI) * 0.4;
      if (onSlide && slideT > 2.1) x = -2.9; // arms up, wheee
      if (holdingKid) [x, z] = [-1.7, -side * 0.1];
      if (this.umbrella && !this.keeper && i === 1 && !holdingKid && !sitting) [x, z] = [-2.4, 0.25]; // holding the umbrella up
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
