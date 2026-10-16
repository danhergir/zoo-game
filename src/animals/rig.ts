import * as THREE from 'three';
import { outlineMaterial } from '../materials';
import { NO_AO_LAYER } from '../post';

/**
 * Shared building blocks for procedural animal rigs. Everything faces +Z with feet at y = 0.
 * Swap this module for GLTF loading later; Animal only relies on AnimalModel.
 */
export interface Leg {
  /** Rotation.x swings the whole leg (negative = forward). */
  hip: THREE.Object3D;
  /** Rotation.x > 0 bends the lower leg backward. */
  knee: THREE.Object3D;
  front: boolean;
}

export interface AnimalModel {
  root: THREE.Group;
  /** Lowered as a whole when lying down. */
  pose: THREE.Object3D;
  /** Pivot at the neck; rotation.x > 0 tips the head down. */
  head: THREE.Object3D;
  /** Order: front-left, front-right, back-left, back-right. */
  legs: Leg[];
  tail: THREE.Object3D | null;
  /** Elephant trunk segments, root first. */
  trunk: THREE.Object3D[];
  /** Neck segments, base first (giraffe); bend them forward with rotation.x > 0. */
  neck: THREE.Object3D[];
  /** Flipper pivots (penguins), left then right; rotation.z spreads them. */
  flippers: THREE.Object3D[];
  /** Rocks side to side when walking (penguins). */
  waddle?: boolean;
  /** Pivots that flap (elephant ears), with their resting yaw. */
  ears: { pivot: THREE.Object3D; rest: number }[];
  legLength: number;
  /** Top of the model, for placing the thought bubble. */
  height: number;
  /** Head pitch while eating. */
  eatPitch: number;
}

const materials = new Map<string, THREE.MeshStandardMaterial>();
export function mat(color: string, roughness = 0.85, flat = false): THREE.MeshStandardMaterial {
  const key = `${color}-${roughness}-${flat}`;
  let m = materials.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness, flatShading: flat });
    materials.set(key, m);
  }
  return m;
}

// Geometry helpers. Scaling is baked into geometry so outlines stay even.
export function ell(rx: number, ry: number, rz: number, seg = 20): THREE.BufferGeometry {
  return new THREE.SphereGeometry(1, seg, Math.round(seg * 0.7)).scale(rx, ry, rz);
}
/** Cylinder rising up from its origin. */
export function stem(rBottom: number, rTop: number, length: number, seg = 10): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(rTop, rBottom, length, seg).translate(0, length / 2, 0);
}
/** Cylinder hanging down from its origin. */
export function limb(rTop: number, rBottom: number, length: number, seg = 10): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(rTop, rBottom, length, seg).translate(0, -length / 2, 0);
}

export class Builder {
  constructor(private readonly outline: number) {}

  mesh(
    geo: THREE.BufferGeometry,
    material: THREE.Material,
    pos: [number, number, number] = [0, 0, 0],
    rot: [number, number, number] = [0, 0, 0],
    outline = true,
  ): THREE.Mesh {
    const m = new THREE.Mesh(geo, material);
    m.position.set(...pos);
    m.rotation.set(...rot);
    m.castShadow = true;
    m.receiveShadow = true;
    if (outline && this.outline > 0) {
      const hull = new THREE.Mesh(geo, outlineMaterial(this.outline));
      hull.raycast = () => {};
      hull.layers.set(NO_AO_LAYER);
      m.add(hull);
    }
    return m;
  }

  group(pos: [number, number, number], ...children: THREE.Object3D[]): THREE.Group {
    const g = new THREE.Group();
    g.position.set(...pos);
    if (children.length) g.add(...children);
    return g;
  }

  /** Two-segment leg with a knee pivot and a foot. Returns the total length. */
  leg(
    pose: THREE.Group,
    x: number,
    z: number,
    o: {
      upper: number;
      lower: number;
      rUpper: number;
      rLower: number;
      skin: THREE.Material;
      lowerSkin?: THREE.Material;
      foot: THREE.Mesh;
      footHeight: number;
      front: boolean;
      hipY: number;
    },
  ): Leg {
    const knee = this.group(
      [0, -o.upper, 0],
      this.mesh(ell(o.rLower * 1.15, o.rLower * 1.15, o.rLower * 1.15, 10), o.skin),
      this.mesh(limb(o.rLower, o.rLower * 0.85, o.lower), o.lowerSkin ?? o.skin),
    );
    o.foot.position.y = -o.lower - o.footHeight / 2;
    knee.add(o.foot);
    const hip = this.group(
      [x, o.hipY, z],
      this.mesh(ell(o.rUpper * 1.3, o.rUpper * 1.4, o.rUpper * 1.4, 12), o.skin, [0, 0, 0], [0, 0, 0], false),
      this.mesh(limb(o.rUpper, o.rLower * 1.05, o.upper), o.skin),
      knee,
    );
    pose.add(hip);
    return { hip, knee, front: o.front };
  }
}

/** An invisible box that makes animals easier to click. */
export function hitbox(w: number, h: number, d: number, y: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ visible: false }));
  m.position.y = y;
  return m;
}

export function eyes(b: Builder, x: number, y: number, z: number, r: number): THREE.Mesh[] {
  const eye = mat('#141110', 0.3);
  return [
    b.mesh(ell(r, r, r, 8), eye, [x, y, z], [0, 0, 0], false),
    b.mesh(ell(r, r, r, 8), eye, [-x, y, z], [0, 0, 0], false),
  ];
}

/**
 * Leg pose for a walk cycle (diagonal pairs, knees lifting on the forward
 * swing), standing, or lying down with front legs tucked. `k` is the blend factor.
 */
export function poseLegs(m: AnimalModel, k: number, mode: 'stand' | 'walk' | 'lie', stride: number): void {
  m.legs.forEach((leg, i) => {
    const phase = stride + (i === 0 || i === 3 ? 0 : Math.PI);
    let hip = 0;
    let knee = 0;
    if (mode === 'lie') {
      hip = leg.front ? -1.4 : 1.4;
      knee = leg.front ? 1.7 : 0;
    } else if (mode === 'walk') {
      hip = Math.sin(phase) * 0.45;
      knee = Math.max(0, -Math.cos(phase)) * 0.9;
    }
    leg.hip.rotation.x = THREE.MathUtils.lerp(leg.hip.rotation.x, hip, k);
    leg.knee.rotation.x = THREE.MathUtils.lerp(leg.knee.rotation.x, knee, k);
  });
}

