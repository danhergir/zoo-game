import * as THREE from 'three';
import { Builder, ell, eyes, hitbox, mat, type AnimalModel } from '../rig';

/**
 * King penguin: upright black-and-white body, orange ear patches, short legs
 * with big feet, and flippers that hang at the sides (and stroke when swimming).
 */
export function buildPenguin(): AnimalModel {
  const b = new Builder(0.022);
  const root = new THREE.Group();
  const pose = new THREE.Group();
  root.add(pose);
  const black = mat('#1e2328', 0.6);
  const white = mat('#f4f3ee', 0.7);
  const orange = mat('#f3a12b', 0.6);
  const upper = 0.07,
    lower = 0.06,
    foot = 0.04;
  const L = upper + lower + foot;

  pose.add(
    b.mesh(ell(0.27, 0.42, 0.25), black, [0, L + 0.38, -0.02]),
    b.mesh(ell(0.23, 0.37, 0.18), white, [0, L + 0.35, 0.08]),
    b.mesh(new THREE.ConeGeometry(0.1, 0.16, 8), black, [0, L + 0.06, -0.2], [-2.3, 0, 0]),
  );

  const head = b.group(
    [0, L + 0.74, 0.02],
    b.mesh(ell(0.16, 0.16, 0.16), black, [0, 0.08, 0]),
    b.mesh(ell(0.05, 0.08, 0.04, 10), orange, [0.13, 0.04, 0.03], [0, 0, 0], false),
    b.mesh(ell(0.05, 0.08, 0.04, 10), orange, [-0.13, 0.04, 0.03], [0, 0, 0], false),
    b.mesh(new THREE.ConeGeometry(0.035, 0.2, 8).rotateX(Math.PI / 2), black, [0, 0.06, 0.22]),
    b.mesh(ell(0.02, 0.012, 0.07, 8), orange, [0, 0.04, 0.2], [0, 0, 0], false),
    ...eyes(b, 0.08, 0.12, 0.12, 0.022),
  );
  pose.add(head);

  // Flippers: pivots at the shoulders, hanging down the sides.
  const flippers = [1, -1].map((side) => {
    const pivot = b.group([side * 0.24, L + 0.58, 0], b.mesh(ell(0.035, 0.24, 0.09, 10), black, [0, -0.22, 0]));
    pivot.rotation.z = side * 0.18;
    pose.add(pivot);
    return pivot;
  });

  const legs = [
    [0.09, 0.02, true],
    [-0.09, 0.02, true],
  ].map(([x, z, front]) =>
    b.leg(pose, x as number, z as number, {
      upper,
      lower,
      rUpper: 0.04,
      rLower: 0.035,
      skin: orange,
      hipY: L,
      foot: b.mesh(ell(0.06, 0.02, 0.09, 8), orange, [0, 0, 0.04]),
      footHeight: foot,
      front: front as boolean,
    }),
  );

  root.add(hitbox(0.7, 1.1, 0.7, 0.55));
  return {
    root,
    pose,
    head,
    legs,
    tail: null,
    trunk: [],
    neck: [],
    flippers,
    waddle: true,
    ears: [],
    legLength: L,
    height: L + 0.95,
    eatPitch: 0.7,
  };
}
