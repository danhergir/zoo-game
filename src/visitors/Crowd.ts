import * as THREE from 'three';
import type { Animal } from '../animals/Animal';
import {
  BOULEVARD_Z,
  DECKS,
  EXIT_X,
  FLAMINGO_POND,
  FLAMINGO_SPOTS,
  GIFT_SHOP,
  LAGOON,
  LAGOON_SPOTS,
  PICNIC_SEATS,
  PLAYGROUND,
  PLAZA,
  SEATS,
  STANDS,
  type Spot,
} from '../layout';
import { Rng } from '../rng';
import { weatherNow } from '../weather';
import { Visitor, type Activity } from './Visitor';

/** Seconds a visitor holds out a treat before the animal takes it. */
const TREAT_REACH = 1.2;

const MAX_VISITORS = 44;
/** Guests arrive while the zoo is open, until shortly before closing. */
const ARRIVE_FROM = 9;
const ARRIVE_UNTIL = 16.5;
const CLOSE_HOUR = 18;

/** Where a parent stands to keep an eye on the kids at the playground. */
const PLAYGROUND_WATCH: Spot[] = [
  { x: 37.6, z: 44.2, yaw: Math.PI / 2 },
  { x: 50.4, z: 44.4, yaw: -Math.PI / 2 },
  { x: 44, z: 42.4, yaw: 0 },
];

const PLAY_KINDS = new Set<Activity['kind']>(['swing', 'slide', 'dig']);

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

/** A balloon that slipped out of a kid's hand, drifting up and away. */
interface LostBalloon {
  mesh: THREE.Mesh;
  x: number;
  y: number;
  z: number;
  age: number;
  drift: number;
}

const balloonGeo = new THREE.SphereGeometry(0.22, 12, 10).scale(1, 1.18, 1);

/**
 * Spawns guests (alone or as families), hands them things to do, runs the
 * snack lines, and sends everyone home at closing. Kids in a family follow
 * their parent, play at the playground and get lifted up at the decks.
 */
export class Crowd {
  readonly visitors: Visitor[] = [];
  private readonly taken = new Set<Spot>();
  private readonly offers: TreatOffer[] = [];
  /** People waiting at each stand, front first. */
  private readonly lines: Visitor[][] = STANDS.map(() => []);
  private readonly lost: LostBalloon[] = [];
  private readonly shopped = new Set<Visitor>();
  private readonly followTimers = new Map<Visitor, number>();
  private readonly liftTimers = new Map<Visitor, number>();
  private spawnTimer = 0;
  private rng = new Rng('crowd');
  private readonly tmp = new THREE.Vector3();

  constructor(
    private readonly scene: THREE.Object3D,
    private readonly hooks: CrowdHooks,
  ) {}

  /** Start of a zoo day: nobody in the park, fresh random stream. */
  reset(rng: Rng): void {
    for (const v of this.visitors) this.scene.remove(v.root);
    for (const b of this.lost) this.scene.remove(b.mesh);
    this.visitors.length = 0;
    this.lost.length = 0;
    this.taken.clear();
    this.offers.length = 0;
    this.lines.forEach((l) => (l.length = 0));
    this.shopped.clear();
    this.followTimers.clear();
    this.liftTimers.clear();
    this.spawnTimer = 0;
    this.rng = rng;
  }

  /** Average animal happiness, 0..1; a happier zoo draws more guests. */
  get rating(): number {
    const a = this.hooks.animals;
    return a.reduce((s, x) => s + x.happiness, 0) / a.length;
  }

  /** Swing angle of whoever is riding each playground swing (null if empty). */
  swingRiders(): (number | null)[] {
    return PLAYGROUND.swings.map((spot) => {
      const v = this.visitors.find((x) => x.phase === 'busy' && x.activity?.kind === 'swing' && x.activity.spot === spot);
      return v ? v.swingAngle : null;
    });
  }

  update(dt: number, hour: number): void {
    const open = hour >= ARRIVE_FROM && hour < ARRIVE_UNTIL;
    this.spawnTimer -= dt;
    if (open && this.spawnTimer <= 0 && this.visitors.length < MAX_VISITORS) {
      this.spawn();
      // Roughly one group every 3 seconds at a perfect rating, slower when animals are unhappy.
      // Rain keeps some people at home.
      this.spawnTimer = (this.rng.float(1.5, 4.5) / (0.3 + this.rating)) * (1 + 1.5 * weatherNow.rain);
    }

    const closing = hour >= CLOSE_HOUR || hour < ARRIVE_FROM;
    const umbrellas = weatherNow.rain > 0.3;
    for (const v of this.visitors) {
      v.umbrella = umbrellas;
      v.update(dt);
      if (v.leader) {
        this.follow(v, dt);
      } else if (closing && v.activity?.kind !== 'exit') {
        this.leaveLine(v);
        this.release(v);
        v.hurry = true;
        v.start({ kind: 'exit', spot: this.exitSpot(v) });
      } else if (v.idle && v.activity?.kind !== 'queue') {
        this.next(v, hour);
      }
    }

    this.serveLines(hour);
    this.interact(dt);
    this.updateBalloons(dt);

    for (let i = this.visitors.length - 1; i >= 0; i--) {
      const v = this.visitors[i];
      if (v.phase !== 'done') continue;
      this.scene.remove(v.root);
      this.visitors.splice(i, 1);
      this.shopped.delete(v);
      this.followTimers.delete(v);
      this.liftTimers.delete(v);
    }
  }

  private spawn(): void {
    const fromRight = this.rng.next() < 0.5;
    const z = BOULEVARD_Z + this.rng.float(-1.8, 1.8);
    const start = { x: fromRight ? EXIT_X : -EXIT_X, z, yaw: fromRight ? -Math.PI / 2 : Math.PI / 2 };
    const adult = this.add(start, false);
    // Families: a parent with one or two kids who tag along.
    if (this.rng.chance(0.4)) {
      const kids = 1 + this.rng.int(2);
      for (let i = 0; i < kids; i++) {
        const kid = this.add({ ...start, x: start.x + (fromRight ? 0.8 : -0.8) * (i + 1) }, true);
        kid.leader = adult;
        adult.followers.push(kid);
        kid.start({ kind: 'follow', spot: { ...start } });
      }
    }
    this.next(adult, ARRIVE_FROM);
  }

  private add(start: Spot, child: boolean): Visitor {
    const v = new Visitor(start, child, false, this.rng.fork('visitor'));
    v.onArrive = () => this.react(v);
    this.scene.add(v.root);
    this.visitors.push(v);
    return v;
  }

  /** Finish the current activity and pick the next (for adults; kids follow their parent). */
  private next(v: Visitor, hour: number): void {
    const done = v.activity;
    this.release(v);
    if (done?.kind === 'picnic') for (const k of v.followers) this.release(k);
    // Leaving the gift shop with a plush toy (one for each kid too).
    if (done?.kind === 'shop') {
      v.carry(v.item ?? 'plush');
      for (const k of v.followers) k.carry('plush');
    }

    if (v.plansLeft <= 0) {
      const shopOpen = hour >= ARRIVE_FROM && hour < CLOSE_HOUR;
      if (shopOpen && !this.shopped.has(v) && this.rng.chance(0.35)) {
        this.shopped.add(v);
        v.start({ kind: 'shop', spot: GIFT_SHOP.door });
      } else {
        v.start({ kind: 'exit', spot: this.exitSpot(v) });
      }
      return;
    }
    v.plansLeft--;

    const family = v.followers.length > 0;
    const roll = this.rng.next();
    let activity: Activity | null = null;
    if (family && roll < 0.15) activity = this.playgroundActivity();
    else if (family && roll < 0.25) activity = this.picnicActivity(v);
    else if (roll < 0.4 && !v.item && this.joinLine(v)) return;
    if (!activity) {
      const r2 = this.rng.next();
      activity = (r2 < 0.7 && this.viewActivity()) || (r2 < 0.85 && this.sitActivity()) || this.strollActivity();
    }
    if (activity.kind !== 'stroll' && activity.kind !== 'supervise') this.taken.add(activity.spot);
    v.start(activity);
  }

  // ---- Snack stands -------------------------------------------------------

  /** Join the shortest line with room (four places). */
  private joinLine(v: Visitor): boolean {
    const options = STANDS.map((_, i) => i).filter((i) => this.lines[i].length < STANDS[i].queue.length);
    if (!options.length) return false;
    const i = options.reduce((a, b) => (this.lines[b].length < this.lines[a].length ? b : a));
    const line = this.lines[i];
    line.push(v);
    v.start({ kind: 'queue', spot: STANDS[i].queue[line.length - 1], stand: i, front: line.length === 1 });
    return true;
  }

  private leaveLine(v: Visitor): void {
    this.lines.forEach((line) => {
      const i = line.indexOf(v);
      if (i >= 0) line.splice(i, 1);
    });
  }

  /** Serve whoever is at the front of each line, then everyone shuffles forward. */
  private serveLines(hour: number): void {
    this.lines.forEach((line, i) => {
      const front = line[0];
      if (!front || !front.idle) return;
      const stand = STANDS[i];
      // Grown-ups mostly want food; kids love the balloons.
      const adultItems = stand.sells.filter((x) => x !== 'balloon');
      front.carry(this.rng.pick(adultItems.length ? adultItems : stand.sells));
      for (const k of front.followers) {
        k.carry(stand.sells.includes('balloon') && this.rng.chance(0.6) ? 'balloon' : this.rng.pick(adultItems));
      }
      line.shift();
      line.forEach((v, j) => v.start({ kind: 'queue', spot: stand.queue[j], stand: i, front: j === 0 }));
      this.next(front, hour);
    });
  }

  // ---- Families -------------------------------------------------------------

  /**
   * Kids stay with their parent: walking along beside them, watching with
   * them (and getting lifted up at the decks), sitting at their picnic table,
   * and playing while the parent watches at the playground.
   */
  private follow(kid: Visitor, dt: number): void {
    const lead = kid.leader!;
    const la = lead.activity;
    // Parent heading out: go with them.
    if (lead.phase === 'leaving' || lead.phase === 'done' || la?.kind === 'exit') {
      if (kid.activity?.kind !== 'exit' && la) {
        this.release(kid);
        kid.hurry = lead.hurry;
        kid.start({ kind: 'exit', spot: la.spot });
      }
      return;
    }
    const busy = lead.phase === 'busy';

    // At the playground: play until the parent moves on.
    if (la?.kind === 'supervise' && busy) {
      if (!PLAY_KINDS.has(kid.activity?.kind ?? 'follow') || kid.idle) {
        this.release(kid);
        const play = this.playActivity();
        if (play) {
          this.taken.add(play.spot);
          kid.start(play);
          return;
        }
      } else {
        return;
      }
    }
    if (PLAY_KINDS.has(kid.activity?.kind ?? 'follow') && la?.kind !== 'supervise') this.release(kid);
    // Picnic: sit at the family's table.
    if (kid.activity?.kind === 'picnic' && la?.kind === 'picnic') return;

    // Otherwise stay beside the parent.
    const idx = lead.followers.indexOf(kid);
    const yaw = busy && la ? la.spot.yaw : Math.atan2(lead.position.x - kid.position.x, lead.position.z - kid.position.z);
    const side = idx === 0 ? 0.8 : -0.8;
    const back = busy ? 0 : -0.6;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const tx = lead.position.x + side * c + back * s;
    const tz = lead.position.z - side * s + back * c;

    // A parent at a viewing deck sometimes lifts the youngest up for a better look.
    const atDeck = busy && la?.kind === 'view' && DECKS.some((d) => d.enclosure === la.enclosure);
    const lift = this.liftTimers.get(kid) ?? 0;
    if (atDeck && idx === 0 && kid.child && kid.phase === 'busy') {
      if (lift > 0) {
        this.liftTimers.set(kid, lift - dt);
        kid.lifted = true;
        kid.position.set(lead.position.x + Math.sin(yaw) * 0.35, 0.75, lead.position.z + Math.cos(yaw) * 0.35);
        return;
      }
      if (kid.lifted) {
        kid.lifted = false;
        kid.position.y = 0;
        this.liftTimers.set(kid, -this.rng.float(6, 12)); // a rest before the next lift
      } else if (lift < 0) {
        this.liftTimers.set(kid, lift + dt);
      } else if (this.rng.chance(dt * 0.5)) {
        this.liftTimers.set(kid, this.rng.float(4, 7));
      }
    } else if (kid.lifted) {
      kid.lifted = false;
      kid.position.y = 0;
    }

    const timer = (this.followTimers.get(kid) ?? 0) - dt;
    this.followTimers.set(kid, timer);
    const far = Math.hypot(kid.position.x - tx, kid.position.z - tz);
    const spot: Spot = { x: tx, z: tz, yaw, glass: la?.spot.glass };
    if (busy && la?.kind === 'view') {
      // Watch alongside the parent (gestures, photos and pressing on aquarium glass included).
      if (kid.activity?.kind !== 'view' || kid.activity.enclosure !== la.enclosure) {
        kid.start({ kind: 'view', spot, enclosure: la.enclosure });
      }
      return;
    }
    if ((kid.phase === 'walking' && timer <= 0 && far > 1.5) || (kid.phase !== 'walking' && far > 1.1)) {
      this.followTimers.set(kid, 1.2);
      kid.start({ kind: 'follow', spot });
    }
  }

  private playgroundActivity(): Activity | null {
    return { kind: 'supervise', spot: this.rng.pick(PLAYGROUND_WATCH) };
  }

  /** A free swing, the slide, or a spot in the sandbox. */
  private playActivity(): Activity | null {
    const options: Activity[] = [];
    // Swings are the favorite (listed twice).
    PLAYGROUND.swings.forEach((spot, seat) => {
      if (!this.taken.has(spot)) options.push({ kind: 'swing', spot, seat }, { kind: 'swing', spot, seat });
    });
    if (!this.taken.has(PLAYGROUND.slide.ladder)) options.push({ kind: 'slide', spot: PLAYGROUND.slide.ladder });
    for (const spot of PLAYGROUND.sandbox) if (!this.taken.has(spot)) options.push({ kind: 'dig', spot });
    return options.length ? this.rng.pick(options) : null;
  }

  /** A table with a seat for every family member; the kids sit down too. */
  private picnicActivity(v: Visitor): Activity | null {
    const free = PICNIC_SEATS.filter((seats) => seats.every((s) => !this.taken.has(s)));
    if (!free.length) return null;
    const seats = this.rng.pick(free);
    v.followers.forEach((k, i) => {
      this.release(k);
      this.taken.add(seats[i + 1]);
      k.start({ kind: 'picnic', spot: seats[i + 1] });
    });
    return { kind: 'picnic', spot: seats[0] };
  }

  // ---- Watching animals -----------------------------------------------------

  /** When a guest reaches a viewing deck: react to what they see. */
  private react(v: Visitor): void {
    const a = v.activity;
    if (a?.kind !== 'view') return;
    const animals = this.hooks.animals.filter((x) => x.enclosure.name === a.enclosure);
    // The lagoon's fish and the flamingos are always out: plenty to get excited about.
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

  /** Balloons drifting away (position and colour), for the 2D view. */
  get lostBalloons(): { x: number; y: number; z: number; color: string }[] {
    return this.lost.map((b) => ({
      ...b.mesh.position,
      color: '#' + (b.mesh.material as THREE.MeshStandardMaterial).color.getHexString(),
    }));
  }

  /** Every so often a balloon slips out of someone's hand and floats away. */
  private updateBalloons(dt: number): void {
    for (const v of this.visitors) {
      if (v.item !== 'balloon' || v.lifted || !this.rng.chance(dt * 0.012)) continue;
      const color = v.balloonColor();
      const p = v.balloonWorld(this.tmp);
      v.carry(null);
      const mesh = new THREE.Mesh(balloonGeo, new THREE.MeshStandardMaterial({ color: color ?? '#e8443a', roughness: 0.35 }));
      mesh.castShadow = true;
      this.scene.add(mesh);
      this.lost.push({ mesh, x: p.x, y: p.y, z: p.z, age: 0, drift: this.rng.float(-1, 1) });
    }
    for (let i = this.lost.length - 1; i >= 0; i--) {
      const b = this.lost[i];
      b.age += dt;
      b.mesh.position.set(b.x + Math.sin(b.age * 0.8) * 0.5 + b.drift * b.age * 0.4, b.y + b.age * 1.2, b.z + b.age * 0.3);
      if (b.age > 16) {
        this.scene.remove(b.mesh);
        this.lost.splice(i, 1);
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
