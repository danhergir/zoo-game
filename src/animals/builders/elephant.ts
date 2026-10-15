import * as THREE from 'three';
import { Builder, ell, limb, mat, hitbox, eyes, type AnimalModel } from '../rig';

export function buildElephant(): AnimalModel {
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
