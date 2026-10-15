import * as THREE from 'three';
import { Builder, ell, limb, mat, hitbox, eyes, type AnimalModel } from '../rig';
import { stripeMaterial } from '../../materials';

let zebraMats: { body: THREE.Material; limb: THREE.Material; neck: THREE.Material } | null = null;

export function buildZebra(): AnimalModel {
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
