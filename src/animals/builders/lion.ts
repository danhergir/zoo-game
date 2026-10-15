import * as THREE from 'three';
import { Builder, ell, limb, mat, hitbox, eyes, type AnimalModel } from '../rig';

export function buildLion(male: boolean): AnimalModel {
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
  return { root, pose, head, legs, tail, trunk: [], neck: [], flippers: [], ears: [], legLength: L, height: L + 1.15, eatPitch: 0.95 };
}
