import * as THREE from 'three';
import type { Feeder } from '../feeder';
import { DECKS, STAFF_DOOR } from '../layout';
import { Visitor } from './Visitor';

/** A feeder below this fraction gets a keeper sent to it. */
const REFILL_BELOW = 0.4;
/** Seconds of tossing food to go from empty to full. */
const FILL_SECONDS = 4;

/** What a keeper carries: a hay bale or a bucket of meat. */
function foodItem(feeder: Feeder): THREE.Object3D {
  const g = new THREE.Group();
  if (feeder.food === 'hay') {
    const bale = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.35, 0.35),
      new THREE.MeshStandardMaterial({ color: '#e2c25c', roughness: 1 }),
    );
    const twine = new THREE.Mesh(
      new THREE.BoxGeometry(0.03, 0.37, 0.37),
      new THREE.MeshStandardMaterial({ color: '#8a5a2b' }),
    );
    for (const x of [-0.14, 0.14]) {
      const t = twine.clone();
      t.position.x = x;
      g.add(t);
    }
    g.add(bale);
  } else {
    const bucket = new THREE.Mesh(
      new THREE.CylinderGeometry(0.2, 0.16, 0.32, 12),
      new THREE.MeshStandardMaterial({ color: '#8f969c', roughness: 0.4, metalness: 0.6 }),
    );
    const meat = new THREE.Mesh(
      new THREE.SphereGeometry(0.17, 10, 6).scale(1, 0.5, 1),
      new THREE.MeshStandardMaterial({ color: '#b2423a', roughness: 0.6 }),
    );
    meat.position.y = 0.16;
    g.add(bucket, meat);
  }
  g.traverse((o) => (o.castShadow = true));
  return g;
}

/**
 * Zookeepers. When a feeder runs low, a keeper walks from the staff hut to the
 * deck in front of it, tosses food over the fence until it's full, and goes back.
 */
export class Keepers {
  readonly active: Visitor[] = [];
  private readonly assigned = new Map<Feeder, Visitor>();

  constructor(
    private readonly scene: THREE.Object3D,
    private readonly feeders: { feeder: Feeder; enclosure: string }[],
  ) {}

  /** Is a keeper on the way to (or working at) this feeder? */
  busyWith(feeder: Feeder): boolean {
    return this.assigned.has(feeder);
  }

  /** The keeper currently tossing food into this feeder, if any. */
  feedingAt(enclosure: string): Visitor | null {
    for (const [feeder, k] of this.assigned) {
      const entry = this.feeders.find((f) => f.feeder === feeder);
      if (entry?.enclosure === enclosure && k.phase === 'busy' && k.activity?.kind === 'feed') return k;
    }
    return null;
  }

  /** Send a keeper now (e.g. the player clicked the feeder). Returns false if one is already going. */
  dispatch(feeder: Feeder): boolean {
    if (this.assigned.has(feeder)) return false;
    const entry = this.feeders.find((f) => f.feeder === feeder);
    const deck = entry && DECKS.find((d) => d.enclosure === entry.enclosure);
    if (!deck) return false;
    const k = new Visitor(STAFF_DOOR, false, true);
    k.hold(foodItem(feeder));
    k.start({ kind: 'feed', spot: deck.feedSpot, feeder });
    this.scene.add(k.root);
    this.active.push(k);
    this.assigned.set(feeder, k);
    return true;
  }

  update(dt: number): void {
    for (const { feeder } of this.feeders) {
      if (feeder.fraction < REFILL_BELOW) this.dispatch(feeder);
    }

    for (const k of this.active) {
      k.update(dt);
      const a = k.activity;
      if (a?.kind === 'feed' && k.phase === 'busy') {
        // Food lands in the feeder while the keeper tosses it over the fence.
        a.feeder.stock = Math.min(a.feeder.capacity, a.feeder.stock + (a.feeder.capacity / FILL_SECONDS) * dt);
        if (k.idle) {
          a.feeder.stock = a.feeder.capacity;
          k.hold(null);
          this.assigned.delete(a.feeder);
          k.start({ kind: 'exit', spot: STAFF_DOOR });
        }
      }
    }

    for (let i = this.active.length - 1; i >= 0; i--) {
      if (this.active[i].phase !== 'done') continue;
      this.scene.remove(this.active[i].root);
      this.active.splice(i, 1);
    }
  }
}
