import * as THREE from 'three';
import type { Spot } from './layout';
import { dirtTexture, repeated } from './materials';
import { mergeStatic } from './merge';
import { buildGrid, findPath, type Grid } from './pathfinding';
import type { Rng } from './rng';

export interface EnclosureDef {
  name: string;
  /** Polygon corners as [x, z], in order. */
  points: [number, number][];
  groundColor: string;
  rocks?: number;
  trees?: number;
  /** Spots ([x, z, radius]) kept free of scenery, e.g. around the feeder. */
  keepClear?: [number, number, number][];
  /** Watering hole as [x, z, radius]. */
  pond?: [number, number, number];
}

interface Obstacle {
  x: number;
  z: number;
  r: number;
  /** Animals can't walk through solid obstacles (rocks, trees, water). */
  solid: boolean;
}

const postMat = new THREE.MeshStandardMaterial({ color: '#6b4528', roughness: 0.9 });
const railMat = new THREE.MeshStandardMaterial({ color: '#94673f', roughness: 0.85 });
const rockMat = new THREE.MeshStandardMaterial({ color: '#a39d92', flatShading: true, roughness: 0.95 });
const barkMat = new THREE.MeshStandardMaterial({ color: '#6e4b2e', roughness: 1 });
const leafMat = new THREE.MeshStandardMaterial({ color: '#6a9a3c', flatShading: true, roughness: 0.9 });
const waterMat = new THREE.MeshStandardMaterial({
  color: '#3b8db3',
  roughness: 0.05,
  metalness: 0.1,
  transparent: true,
  opacity: 0.88,
});
const shoreMat = new THREE.MeshStandardMaterial({ color: '#8d7a55', roughness: 1 });

/** A fenced habitat: a polygon on the ground plus fence and scenery meshes. */
export class Enclosure {
  readonly name: string;
  readonly group = new THREE.Group();
  private readonly pts: THREE.Vector2[];
  private readonly obstacles: Obstacle[] = [];
  private readonly min = new THREE.Vector2(Infinity, Infinity);
  private readonly max = new THREE.Vector2(-Infinity, -Infinity);
  /** How many visitors are watching from this enclosure's deck right now. */
  audience = 0;
  /** Spots just inside the fence, facing the deck, where animals come to say hello. */
  animalSpots: Spot[] = [];
  /** Animal spots currently claimed. */
  readonly takenSpots = new Set<Spot>();
  /** Walkability grids, one per (rounded) animal size. */
  private readonly grids = new Map<number, Grid>();

  /** `rng` places the scenery; seed it the same everywhere so obstacles match. */
  constructor(def: EnclosureDef, private readonly rng: Rng) {
    this.name = def.name;
    this.pts = def.points.map(([x, z]) => new THREE.Vector2(x, z));
    for (const p of this.pts) {
      this.min.min(p);
      this.max.max(p);
    }
    this.buildGround(def.groundColor);
    this.buildFence();
    for (const [x, z, r] of def.keepClear ?? []) this.obstacles.push({ x, z, r, solid: false });
    if (def.pond) this.addPond(...def.pond);
    for (let i = 0; i < (def.rocks ?? 0); i++) this.addRock();
    for (let i = 0; i < (def.trees ?? 0); i++) this.addTree();
    // Everything in an enclosure is static: bake it into a handful of meshes.
    const merged = mergeStatic(this.group);
    this.group.clear();
    this.group.add(...merged.children);
  }

  contains(x: number, z: number): boolean {
    let inside = false;
    const p = this.pts;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const a = p[i];
      const b = p[j];
      if (a.y > z !== b.y > z && x < ((b.x - a.x) * (z - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  }

  /** Inside the fence or within `margin` of it. */
  occupies(x: number, z: number, margin: number): boolean {
    return this.contains(x, z) || this.distanceToFence(x, z) < margin;
  }

  /** Somewhere an animal of the given radius can stand. */
  walkable(x: number, z: number, radius: number): boolean {
    if (!this.containsWithMargin(x, z, radius * 0.5)) return false;
    return !this.obstacles.some((o) => o.solid && Math.hypot(o.x - x, o.z - z) < o.r + radius * 0.5);
  }

  /**
   * Route around ponds, rocks and trees for an animal of the given radius:
   * waypoints after `from`, ending at `to`. Null if `to` can't be reached.
   */
  findPath(from: THREE.Vector3, to: THREE.Vector3, radius: number): THREE.Vector3[] | null {
    const key = Math.ceil(radius * 4) / 4;
    let grid = this.grids.get(key);
    if (!grid) {
      grid = buildGrid(this.min.x, this.min.y, this.max.x, this.max.y, 0.75, (x, z) => this.walkable(x, z, key));
      this.grids.set(key, grid);
    }
    const pts = findPath(grid, from.x, from.z, to.x, to.z);
    return pts && pts.map(([x, z]) => new THREE.Vector3(x, 0, z));
  }

  /** The rock, tree or pond (if any) that an animal of this radius would bump into here. */
  obstacleAt(x: number, z: number, radius: number): { x: number; z: number; r: number } | null {
    return this.obstacles.find((o) => o.solid && Math.hypot(o.x - x, o.z - z) < o.r + radius * 0.5) ?? null;
  }

  /** Inside the polygon, at least `margin` from the fence. */
  containsWithMargin(x: number, z: number, margin: number): boolean {
    return this.contains(x, z) && this.distanceToFence(x, z) >= margin;
  }

  /** A random walkable spot, away from the fence and scenery. */
  randomPoint(margin: number, rng: Rng, out = new THREE.Vector3()): THREE.Vector3 {
    for (let i = 0; i < 60; i++) {
      const x = rng.float(this.min.x, this.max.x);
      const z = rng.float(this.min.y, this.max.y);
      if (this.containsWithMargin(x, z, margin) && !this.blocked(x, z, margin * 0.5)) {
        return out.set(x, 0, z);
      }
    }
    return out.set((this.min.x + this.max.x) / 2, 0, (this.min.y + this.max.y) / 2);
  }

  private blocked(x: number, z: number, pad: number): boolean {
    return this.obstacles.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + pad);
  }

  private distanceToFence(x: number, z: number): number {
    let best = Infinity;
    const p = this.pts;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const ax = p[j].x, az = p[j].y;
      const bx = p[i].x, bz = p[i].y;
      const dx = bx - ax, dz = bz - az;
      const t = THREE.MathUtils.clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1);
      best = Math.min(best, Math.hypot(x - (ax + dx * t), z - (az + dz * t)));
    }
    return best;
  }

  private buildGround(color: string): void {
    // ShapeGeometry lives in XY; rotating -90° about X maps shape y to world -z.
    const shape = new THREE.Shape(this.pts.map((p) => new THREE.Vector2(p.x, -p.y)));
    const mesh = new THREE.Mesh(
      new THREE.ShapeGeometry(shape),
      // Shape UVs are in world units, so this tiles every 16 units.
      new THREE.MeshStandardMaterial({ color, map: repeated(dirtTexture(), 1 / 16, 1 / 16), roughness: 1 }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.02;
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  private buildFence(): void {
    const postGeo = new THREE.CylinderGeometry(0.13, 0.16, 1.8, 8).translate(0, 0.9, 0);
    const capGeo = new THREE.ConeGeometry(0.17, 0.2, 8).translate(0, 1.9, 0);
    const p = this.pts;
    for (let i = 0; i < p.length; i++) {
      const a = p[i];
      const b = p[(i + 1) % p.length];
      const len = a.distanceTo(b);
      const yaw = Math.atan2(b.x - a.x, b.y - a.y);
      const posts = Math.max(1, Math.round(len / 2.4));
      for (let k = 0; k < posts; k++) {
        const t = k / posts;
        const post = new THREE.Mesh(postGeo, postMat);
        const cap = new THREE.Mesh(capGeo, postMat);
        post.position.set(a.x + (b.x - a.x) * t, 0, a.y + (b.y - a.y) * t);
        cap.position.copy(post.position);
        post.castShadow = cap.castShadow = true;
        this.group.add(post, cap);
      }
      for (const h of [0.45, 0.95, 1.45]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.22, len), railMat);
        rail.position.set((a.x + b.x) / 2, h, (a.y + b.y) / 2);
        rail.rotation.y = yaw;
        rail.castShadow = rail.receiveShadow = true;
        this.group.add(rail);
      }
    }
  }

  /** A watering hole with a sandy shore and a few reeds. */
  private addPond(x: number, z: number, r: number): void {
    const wobbly = (radius: number, seed: number) => {
      const geo = new THREE.CircleGeometry(radius, 40);
      const pos = geo.attributes.position;
      for (let i = 1; i < pos.count; i++) {
        const a = Math.atan2(pos.getY(i), pos.getX(i));
        const k = 1 + Math.sin(a * 3 + seed) * 0.12 + Math.sin(a * 5 + seed * 2) * 0.06;
        pos.setXY(i, pos.getX(i) * k, pos.getY(i) * k);
      }
      return geo.rotateX(-Math.PI / 2);
    };
    const seed = this.rng.next() * 10;
    const shore = new THREE.Mesh(wobbly(r + 1.1, seed), shoreMat);
    shore.position.set(x, 0.03, z);
    const water = new THREE.Mesh(wobbly(r, seed), waterMat);
    water.position.set(x, 0.05, z);
    shore.receiveShadow = water.receiveShadow = true;
    this.group.add(shore, water);

    const reedMat = new THREE.MeshStandardMaterial({ color: '#4f7a33', roughness: 1 });
    for (let i = 0; i < 26; i++) {
      const a = this.rng.next() * Math.PI * 2;
      const d = r * (0.95 + this.rng.next() * 0.25);
      const h = 0.6 + this.rng.next() * 0.8;
      const reed = new THREE.Mesh(new THREE.ConeGeometry(0.05, h, 4), reedMat);
      reed.position.set(x + Math.cos(a) * d, h / 2, z + Math.sin(a) * d);
      reed.rotation.set((this.rng.next() - 0.5) * 0.3, 0, (this.rng.next() - 0.5) * 0.3);
      this.group.add(reed);
    }
    this.obstacles.push({ x, z, r: r * 1.12, solid: true });
  }

  /** A small cluster of rounded boulders. */
  private addRock(): void {
    const pos = this.randomPoint(3, this.rng);
    const cluster = 1 + Math.floor(this.rng.next() * 3);
    let extent = 0;
    for (let i = 0; i < cluster; i++) {
      const r = this.rng.float(0.5, 1.4) * (i === 0 ? 1 : 0.6);
      const offset = i === 0 ? 0 : r + 0.4;
      const a = this.rng.next() * Math.PI * 2;
      const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), rockMat);
      rock.position.set(pos.x + Math.cos(a) * offset, r * 0.3, pos.z + Math.sin(a) * offset);
      rock.scale.set(1, this.rng.float(0.55, 0.85), this.rng.float(0.8, 1.2));
      rock.rotation.set(this.rng.next() * 0.4, this.rng.next() * Math.PI, this.rng.next() * 0.4);
      rock.castShadow = rock.receiveShadow = true;
      this.group.add(rock);
      extent = Math.max(extent, offset + r);
    }
    this.obstacles.push({ x: pos.x, z: pos.z, r: extent, solid: true });
  }

  /** Flat-topped acacia-style tree. */
  private addTree(): void {
    const pos = this.randomPoint(4, this.rng);
    const tree = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.38, 4.2, 7), barkMat);
    trunk.position.y = 2.1;
    trunk.rotation.z = (this.rng.next() - 0.5) * 0.15;
    tree.add(trunk);
    for (const [x, y, z, r] of [[0, 4.7, 0, 3], [1.6, 4.4, 0.6, 1.8], [-1.5, 4.5, -0.5, 2]]) {
      const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), leafMat);
      crown.scale.set(1.2, 0.3, 1.2);
      crown.position.set(x, y, z);
      tree.add(crown);
    }
    tree.traverse((o) => (o.castShadow = true));
    tree.position.copy(pos);
    tree.rotation.y = this.rng.next() * Math.PI;
    this.group.add(tree);
    this.obstacles.push({ x: pos.x, z: pos.z, r: 0.8, solid: true });
  }
}
