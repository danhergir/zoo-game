import * as THREE from 'three';
import { spotMaterial } from '../../materials';
import { Builder, ell, eyes, hitbox, limb, mat, stem, type AnimalModel } from '../rig';

let coat: THREE.Material | null = null;

/**
 * Giraffe: long legs, a sloping back and a four-segment neck that can stretch
 * up into the trees or bend down to visitors at the fence.
 */
export function buildGiraffe(): AnimalModel {
  const b = new Builder(0.035);
  const root = new THREE.Group();
  const pose = new THREE.Group();
  root.add(pose);
  coat ??= spotMaterial(3.2);
  const dark = mat('#3d2a1c', 0.7);
  const horn = mat('#5a3d27', 0.8);
  const upper = 0.95,
    lower = 0.9,
    hoof = 0.12;
  const L = upper + lower + hoof;

  // Body slopes down toward the rump.
  const body = b.mesh(ell(0.46, 0.5, 0.95), coat, [0, L + 0.38, 0], [-0.12, 0, 0]);
  pose.add(body, b.mesh(ell(0.42, 0.5, 0.45), coat, [0, L + 0.48, 0.55]), b.mesh(ell(0.4, 0.44, 0.42), coat, [0, L + 0.28, -0.6]));

  // Neck: a chain of segments, each a short tapering stem with a joint ball.
  const neck: THREE.Group[] = [];
  const segs = 4;
  const segLen = 0.6;
  let parent: THREE.Object3D = pose;
  for (let i = 0; i < segs; i++) {
    const r0 = 0.24 - i * 0.035;
    const seg = b.group(
      i === 0 ? [0, L + 0.7, 0.7] : [0, segLen, 0],
      b.mesh(stem(r0, r0 - 0.03, segLen), coat),
      b.mesh(new THREE.BoxGeometry(0.06, segLen, 0.12), dark, [0, segLen / 2, -r0 + 0.02], [0, 0, 0], false),
    );
    // The neck leans forward at the base and straightens toward the head.
    seg.rotation.x = i === 0 ? 0.4 : -0.05;
    parent.add(seg);
    neck.push(seg);
    parent = seg;
  }

  // Head at the top of the neck; rotation.x > 0 tips it down.
  const head = b.group(
    [0, segLen, 0],
    b.mesh(ell(0.15, 0.16, 0.36), coat, [0, 0.08, 0.22], [0.25, 0, 0]),
    b.mesh(ell(0.12, 0.11, 0.14), mat('#c9a77a'), [0, -0.02, 0.5]),
    b.mesh(stem(0.035, 0.03, 0.2), horn, [0.07, 0.2, 0.04], [-0.2, 0, -0.15]),
    b.mesh(stem(0.035, 0.03, 0.2), horn, [-0.07, 0.2, 0.04], [-0.2, 0, 0.15]),
    b.mesh(ell(0.05, 0.05, 0.05, 8), dark, [0.1, 0.39, 0.0], [0, 0, 0], false),
    b.mesh(ell(0.05, 0.05, 0.05, 8), dark, [-0.1, 0.39, 0.0], [0, 0, 0], false),
    b.mesh(new THREE.ConeGeometry(0.05, 0.18, 8), coat, [0.16, 0.16, -0.02], [0, 0, -1.1]),
    b.mesh(new THREE.ConeGeometry(0.05, 0.18, 8), coat, [-0.16, 0.16, -0.02], [0, 0, 1.1]),
    ...eyes(b, 0.13, 0.15, 0.3, 0.03),
  );
  head.rotation.x = 0.35;
  neck[segs - 1].add(head);

  const tail = b.group(
    [0, L + 0.38, -0.95],
    b.mesh(limb(0.035, 0.025, 0.8), coat),
    b.mesh(ell(0.06, 0.16, 0.06, 8), dark, [0, -0.86, 0]),
  );
  tail.rotation.x = 0.25;
  pose.add(tail);

  const legs = [
    [0.24, 0.62, true],
    [-0.24, 0.62, true],
    [0.24, -0.6, false],
    [-0.24, -0.6, false],
  ].map(([x, z, front]) =>
    b.leg(pose, x as number, z as number, {
      upper,
      lower,
      rUpper: 0.13,
      rLower: 0.075,
      skin: coat!,
      hipY: L,
      foot: b.mesh(new THREE.CylinderGeometry(0.08, 0.095, hoof, 10), dark),
      footHeight: hoof,
      front: front as boolean,
    }),
  );

  root.add(hitbox(1.3, 5.4, 2.4, 2.7));
  // Head height at rest: about L + 0.7 + 4 * 0.6, leaning forward.
  return { root, pose, head, legs, tail, trunk: [], neck, ears: [], legLength: L, height: L + 3.4, eatPitch: 0.55 };
}
