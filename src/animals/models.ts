import * as THREE from 'three';
import { outlineMaterial, stripeMaterial } from '../materials';
import { mergeRig } from '../merge';
import { NO_AO_LAYER } from '../post';
import type { SpeciesId } from './species';

/**
 * Procedural stylized animal rigs. Everything faces +Z with feet at y = 0.
 * Swap this module for GLTF loading later; Animal only relies on AnimalModel.
 */
export interface Leg {
  /** Rotation.x swings the whole leg (negative = forward). */
  hip: THREE.Group;
  /** Rotation.x > 0 bends the lower leg backward. */
  knee: THREE.Group;
  front: boolean;
}

export interface AnimalModel {
  root: THREE.Group;
  /** Lowered as a whole when lying down. */
  pose: THREE.Group;
  /** Pivot at the neck; rotation.x > 0 tips the head down. */
  head: THREE.Group;
  /** Order: front-left, front-right, back-left, back-right. */
  legs: Leg[];
  tail: THREE.Group | null;
  /** Elephant trunk segments, root first. */
  trunk: THREE.Group[];
  /** Pivots that flap (elephant ears), with their resting yaw. */
  ears: { pivot: THREE.Group; rest: number }[];
  legLength: number;
  /** Top of the model, for placing the thought bubble. */
  height: number;
  /** Head pitch while eating. */
  eatPitch: number;
}

const materials = new Map<string, THREE.MeshStandardMaterial>();
function mat(color: string, roughness = 0.85, flat = false): THREE.MeshStandardMaterial {
  const key = `${color}-${roughness}-${flat}`;
  let m = materials.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness, flatShading: flat });
    materials.set(key, m);
  }
  return m;
}

// Geometry helpers. Scaling is baked into geometry so outlines stay even.
function ell(rx: number, ry: number, rz: number, seg = 20): THREE.BufferGeometry {
  return new THREE.SphereGeometry(1, seg, Math.round(seg * 0.7)).scale(rx, ry, rz);
}
/** Cylinder hanging down from its origin. */
function limb(rTop: number, rBottom: number, length: number, seg = 10): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(rTop, rBottom, length, seg).translate(0, -length / 2, 0);
}

class Builder {
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
function hitbox(w: number, h: number, d: number, y: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ visible: false }));
  m.position.y = y;
  return m;
}

function eyes(b: Builder, x: number, y: number, z: number, r: number): THREE.Mesh[] {
  const eye = mat('#141110', 0.3);
  return [
    b.mesh(ell(r, r, r, 8), eye, [x, y, z], [0, 0, 0], false),
    b.mesh(ell(r, r, r, 8), eye, [-x, y, z], [0, 0, 0], false),
  ];
}

export function buildModel(species: SpeciesId, male: boolean): AnimalModel {
  const model =
    species === 'zebra' ? buildZebra() : species === 'elephant' ? buildElephant() : buildLion(male);
  // Merge the rigid parts of each joint so an animal costs a few draw calls, not dozens.
  mergeRig(model.root);
  return model;
}

let zebraMats: { body: THREE.Material; limb: THREE.Material; neck: THREE.Material } | null = null;

function buildZebra(): AnimalModel {
  const b = new Builder(0.03);
  const root = new THREE.Group();
  const pose = new THREE.Group();
  root.add(pose);
  zebraMats ??= {
    body: stripeMaterial('z', 4.2),
    limb: stripeMaterial('y', 7),
    neck: stripeMaterial('y', 5),
  };
  const { body, limb: legSkin, neck: neckSkin } = zebraMats;
  const black = mat('#1b1a1a', 0.6);
  const upper = 0.55, lower = 0.5, hoof = 0.1;
  const L = upper + lower + hoof;

  pose.add(
    b.mesh(ell(0.42, 0.44, 0.92), body, [0, L + 0.3, 0]),
    b.mesh(ell(0.37, 0.42, 0.42), body, [0, L + 0.33, 0.62]),
    b.mesh(ell(0.4, 0.44, 0.44), body, [0, L + 0.36, -0.58]),
  );

  const head = b.group(
    [0, L + 0.5, 0.88],
    b.mesh(limb(0.17, 0.27, 0.95), neckSkin, [0, 0.82, 0.42], [0.5, 0, 0]),
    b.mesh(new THREE.BoxGeometry(0.07, 0.95, 0.14), black, [0, 0.5, 0.02], [0.5, 0, 0], false),
    b.mesh(ell(0.17, 0.19, 0.42), body, [0, 0.82, 0.62], [0.35, 0, 0]),
    b.mesh(ell(0.15, 0.14, 0.17), black, [0, 0.68, 0.95]),
    b.mesh(new THREE.ConeGeometry(0.07, 0.26, 8), body, [0.1, 1.06, 0.42], [-0.2, 0, -0.3]),
    b.mesh(new THREE.ConeGeometry(0.07, 0.26, 8), body, [-0.1, 1.06, 0.42], [-0.2, 0, 0.3]),
    ...eyes(b, 0.15, 0.88, 0.66, 0.035),
  );
  pose.add(head);

  const tail = b.group(
    [0, L + 0.55, -1.0],
    b.mesh(limb(0.035, 0.03, 0.6), legSkin),
    b.mesh(ell(0.07, 0.16, 0.07, 10), black, [0, -0.66, 0]),
  );
  tail.rotation.x = 0.3;
  pose.add(tail);

  const legs = [
    [0.22, 0.62, true],
    [-0.22, 0.62, true],
    [0.22, -0.6, false],
    [-0.22, -0.6, false],
  ].map(([x, z, front]) =>
    b.leg(pose, x as number, z as number, {
      upper, lower, rUpper: 0.13, rLower: 0.075, skin: legSkin, hipY: L,
      foot: b.mesh(new THREE.CylinderGeometry(0.08, 0.095, hoof, 10), black),
      footHeight: hoof, front: front as boolean,
    }),
  );

  root.add(hitbox(1.3, 2.4, 2.6, 1.2));
  return { root, pose, head, legs, tail, trunk: [], ears: [], legLength: L, height: L + 1.55, eatPitch: 1.4 };
}

function buildElephant(): AnimalModel {
  const b = new Builder(0.045);
  const root = new THREE.Group();
  const pose = new THREE.Group();
  root.add(pose);
  const skin = mat('#979aa0', 0.95);
  const inner = mat('#c79a9a', 0.9);
  const nail = mat('#b9b2a4', 0.7);
  const ivory = mat('#f3ecdc', 0.5);
  const upper = 0.8, lower = 0.72, foot = 0.14;
  const L = upper + lower + foot;

  pose.add(
    b.mesh(ell(1.02, 1.0, 1.55, 24), skin, [0, L + 0.55, -0.05]),
    b.mesh(ell(0.85, 0.6, 0.9), skin, [0, L + 1.05, 0.25]),
  );

  // Trunk: a chain of tapering segments so it can curl.
  const trunk: THREE.Group[] = [];
  let parent: THREE.Group | null = null;
  const segs = 5;
  for (let i = 0; i < segs; i++) {
    const r0 = 0.2 - i * 0.025;
    const len = 0.36;
    const seg: THREE.Group = b.group(
      i === 0 ? [0, -0.18, 0.86] : [0, -len, 0],
      b.mesh(limb(r0, r0 - 0.025, len), skin),
      b.mesh(ell(r0, r0, r0, 10), skin, [0, 0, 0], [0, 0, 0], false),
    );
    trunk.push(seg);
    if (parent) parent.add(seg);
    parent = seg;
  }

  const ears = [1, -1].map((side) => {
    const pivot = b.group(
      [side * 0.5, 0.2, 0.35],
      b.mesh(ell(0.06, 0.66, 0.52), skin, [side * 0.03, -0.05, -0.42]),
      b.mesh(ell(0.03, 0.52, 0.4), inner, [side * -0.03, -0.05, -0.4], [0, 0, 0], false),
    );
    // Yaw each ear so its back edge flares outward.
    const rest = -side * 0.6;
    pivot.rotation.y = rest;
    return { pivot, rest };
  });

  const head = b.group(
    [0, L + 1.0, 1.3],
    b.mesh(ell(0.62, 0.7, 0.62), skin, [0, 0.15, 0.4]),
    b.mesh(ell(0.48, 0.4, 0.42), skin, [0, 0.55, 0.38]),
    b.mesh(new THREE.ConeGeometry(0.07, 0.7, 10), ivory, [0.3, -0.3, 0.9], [1.25, 0, 0]),
    b.mesh(new THREE.ConeGeometry(0.07, 0.7, 10), ivory, [-0.3, -0.3, 0.9], [1.25, 0, 0]),
    ...eyes(b, 0.42, 0.32, 0.72, 0.05),
    trunk[0],
    ...ears.map((e) => e.pivot),
  );
  pose.add(head);

  const tail = b.group(
    [0, L + 0.8, -1.55],
    b.mesh(limb(0.05, 0.04, 0.85), skin),
    b.mesh(ell(0.06, 0.14, 0.06, 8), mat('#3c3a38'), [0, -0.9, 0]),
  );
  tail.rotation.x = 0.25;
  pose.add(tail);

  const legs = [
    [0.58, 0.85, true],
    [-0.58, 0.85, true],
    [0.58, -0.9, false],
    [-0.58, -0.9, false],
  ].map(([x, z, front]) =>
    b.leg(pose, x as number, z as number, {
      upper, lower, rUpper: 0.34, rLower: 0.27, skin, hipY: L,
      foot: b.mesh(new THREE.CylinderGeometry(0.3, 0.32, foot, 14), nail),
      footHeight: foot, front: front as boolean,
    }),
  );

  root.add(hitbox(2.4, 3.6, 4.0, 1.8));
  return { root, pose, head, legs, tail, trunk, ears, legLength: L, height: L + 2.1, eatPitch: 0.3 };
}

function buildLion(male: boolean): AnimalModel {
  const b = new Builder(0.03);
  const root = new THREE.Group();
  const pose = new THREE.Group();
  root.add(pose);
  const fur = mat('#d9a457');
  const cream = mat('#f0d9ae');
  const maneMat = mat('#7b3d1a', 0.95, true);
  const nose = mat('#4a2c22', 0.5);
  const upper = 0.42, lower = 0.38, paw = 0.1;
  const L = upper + lower + paw;

  pose.add(
    b.mesh(ell(0.36, 0.37, 0.88), fur, [0, L + 0.25, 0]),
    b.mesh(ell(0.35, 0.4, 0.42), fur, [0, L + 0.3, 0.52]),
    b.mesh(ell(0.3, 0.2, 0.6), cream, [0, L + 0.04, 0.05], [0, 0, 0], false),
  );

  const headParts: THREE.Object3D[] = [
    b.mesh(ell(0.3, 0.29, 0.31), fur, [0, 0.12, 0.24]),
    b.mesh(ell(0.17, 0.13, 0.18), cream, [0, 0.0, 0.5]),
    b.mesh(ell(0.07, 0.05, 0.05, 8), nose, [0, 0.09, 0.66], [0, 0, 0], false),
    b.mesh(ell(0.08, 0.09, 0.05, 10), fur, [0.19, 0.38, 0.14]),
    b.mesh(ell(0.08, 0.09, 0.05, 10), fur, [-0.19, 0.38, 0.14]),
    ...eyes(b, 0.13, 0.2, 0.48, 0.035),
  ];
  if (male) {
    headParts.push(
      b.mesh(new THREE.IcosahedronGeometry(0.55, 1).scale(1, 1.05, 0.7), maneMat, [0, 0.1, 0.06]),
      b.mesh(new THREE.IcosahedronGeometry(0.45, 1).scale(0.9, 1, 1), maneMat, [0, -0.28, -0.1]),
    );
  }
  const head = b.group([0, L + 0.45, 0.82], ...headParts);
  pose.add(head);

  const tail = b.group(
    [0, L + 0.38, -0.86],
    b.mesh(limb(0.045, 0.035, 1.0), fur),
    b.mesh(ell(0.08, 0.14, 0.08, 10), maneMat, [0, -1.05, 0]),
  );
  tail.rotation.x = 0.55;
  pose.add(tail);

  const legs = [
    [0.21, 0.55, true],
    [-0.21, 0.55, true],
    [0.21, -0.58, false],
    [-0.21, -0.58, false],
  ].map(([x, z, front]) =>
    b.leg(pose, x as number, z as number, {
      upper, lower, rUpper: 0.17, rLower: 0.12, skin: fur, hipY: L,
      foot: b.mesh(ell(0.13, paw / 2 + 0.02, 0.16, 12), fur),
      footHeight: paw, front: front as boolean,
    }),
  );

  root.add(hitbox(1.2, 1.9, 2.4, 0.95));
  return { root, pose, head, legs, tail, trunk: [], ears: [], legLength: L, height: L + 1.15, eatPitch: 0.95 };
}
