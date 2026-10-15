import * as THREE from 'three';
import { Builder, ell, eyes, hitbox, limb, mat, type AnimalModel } from '../rig';

/**
 * Monkey: small quadruped with long arms (the front legs), a pale face mask
 * and a long curling tail. Animal poses it for climbing, perching and swinging.
 */
export function buildMonkey(): AnimalModel {
  const b = new Builder(0.022);
  const root = new THREE.Group();
  const pose = new THREE.Group();
  root.add(pose);
  const fur = mat('#7a5232');
  const face = mat('#e3c39b');
  const back = 0.47; // hip height
  const front = 0.6; // shoulder height (arms are longer)

  pose.add(b.mesh(ell(0.22, 0.25, 0.36), fur, [0, 0.62, 0], [-0.18, 0, 0]));

  const head = b.group(
    [0, 0.8, 0.34],
    b.mesh(ell(0.17, 0.16, 0.16), fur, [0, 0.06, 0.04]),
    b.mesh(ell(0.12, 0.11, 0.06), face, [0, 0.04, 0.16]),
    b.mesh(ell(0.06, 0.045, 0.05, 8), face, [0, -0.02, 0.21]),
    b.mesh(ell(0.06, 0.06, 0.02, 8), face, [0.17, 0.09, 0.02], [0, 0.4, 0]),
    b.mesh(ell(0.06, 0.06, 0.02, 8), face, [-0.17, 0.09, 0.02], [0, -0.4, 0]),
    ...eyes(b, 0.05, 0.08, 0.2, 0.022),
  );
  pose.add(head);

  // Tail: a chain of segments that curls up at the end.
  let parent: THREE.Object3D = pose;
  let tail: THREE.Group | null = null;
  for (let i = 0; i < 3; i++) {
    const seg = b.group(i === 0 ? [0, 0.6, -0.34] : [0, -0.32, 0], b.mesh(limb(0.04 - i * 0.008, 0.032 - i * 0.008, 0.32), fur));
    seg.rotation.x = i === 0 ? 2.4 : -0.5;
    parent.add(seg);
    if (!tail) tail = seg;
    parent = seg;
  }

  const legs = [
    [0.16, 0.24, true],
    [-0.16, 0.24, true],
    [0.15, -0.26, false],
    [-0.15, -0.26, false],
  ].map(([x, z, isFront]) => {
    const arm = isFront as boolean;
    const hipY = arm ? front : back;
    return b.leg(pose, x as number, z as number, {
      upper: arm ? 0.3 : 0.22,
      lower: arm ? 0.27 : 0.2,
      rUpper: 0.06,
      rLower: 0.045,
      skin: fur,
      hipY,
      foot: b.mesh(ell(0.05, 0.03, 0.07, 8), face, [0, 0, 0.02]),
      footHeight: arm ? 0.03 : 0.05,
      front: arm,
    });
  });

  root.add(hitbox(0.7, 1.0, 1.0, 0.5));
  return {
    root,
    pose,
    head,
    legs,
    tail,
    trunk: [],
    neck: [],
    flippers: [],
    ears: [],
    legLength: back,
    height: 1.15,
    eatPitch: 0.6,
  };
}
