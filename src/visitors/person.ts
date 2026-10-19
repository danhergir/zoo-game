import * as THREE from 'three';
import { skinRig } from '../skin';
import type { Rng } from '../rng';

/** A small stylized person. Faces +Z with feet at y = 0 (before scaling). */
export interface PersonLook {
  skin: string;
  shirt: string;
  pants: string;
  hair: string | null;
  hat: string | null;
}

export interface PersonModel {
  root: THREE.Group;
  /** Moved as a whole for bobbing and sitting. */
  pose: THREE.Object3D;
  /** Hip pivots (left, right); rotation.x < 0 swings the leg forward. */
  hips: THREE.Object3D[];
  /** Knee pivots (left, right); rotation.x > 0 bends the shin back. */
  knees: THREE.Object3D[];
  /** Shoulder pivots (left, right). */
  shoulders: THREE.Object3D[];
  head: THREE.Object3D;
  /** Empty anchor in front of the chest for carried items (added after merging). */
  carry: THREE.Group;
  /** Height of the hip joint. */
  hipHeight: number;
  /** The colours picked for this person (the 2D view dresses its sprite the same way). */
  look: PersonLook;
  height: number;
}

const SKIN = ['#f3d2b3', '#e0b18a', '#c68b5e', '#8d5a3b', '#5e3b26'];
const HAIR = ['#2b1d14', '#5a3a22', '#a8743a', '#e3c27a', '#1a1a1a', '#8b3a1e', '#b8b8b8'];
const SHIRTS = ['#e85d5d', '#4f8fdc', '#f2c14e', '#6cc28a', '#b07ad9', '#ff9f5a', '#f5f5f0', '#3a3f58', '#e979a8'];
const PANTS = ['#2f3d5c', '#4a4a4a', '#6b5a45', '#c9b48a', '#2d5a4a', '#1f2430'];
const HATS = ['#d9c08a', '#e85d5d', '#3a3f58', '#f5f5f0', '#4f8fdc'];

/** One material for everyone; each part carries its color as vertex colors, so a joint merges into one mesh. */
const personMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });


// Shared geometries: every visitor reuses the same buffers.
const geo = {
  thigh: new THREE.CapsuleGeometry(0.085, 0.3, 3, 8).translate(0, -0.19, 0),
  shin: new THREE.CapsuleGeometry(0.075, 0.3, 3, 8).translate(0, -0.19, 0),
  shoe: new THREE.BoxGeometry(0.14, 0.08, 0.24).translate(0, -0.4, 0.04),
  torso: new THREE.CapsuleGeometry(0.2, 0.3, 4, 12).scale(1, 1, 0.72),
  arm: new THREE.CapsuleGeometry(0.055, 0.36, 3, 8).translate(0, -0.22, 0),
  hand: new THREE.SphereGeometry(0.06, 8, 6).translate(0, -0.45, 0),
  head: new THREE.SphereGeometry(0.17, 16, 12),
  hair: new THREE.SphereGeometry(0.18, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
  brim: new THREE.CylinderGeometry(0.27, 0.27, 0.03, 16),
  crown: new THREE.CylinderGeometry(0.15, 0.17, 0.14, 16),
  backpack: new THREE.BoxGeometry(0.28, 0.32, 0.14),
};

const tint = new THREE.Color();
function part(g: THREE.BufferGeometry, color: string, x = 0, y = 0, z = 0): THREE.Mesh {
  const geo = g.clone();
  tint.set(color);
  const count = geo.attributes.position.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) colors.set([tint.r, tint.g, tint.b], i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const m = new THREE.Mesh(geo, personMat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

/** Zookeeper uniform: olive shirt, khaki trousers, wide-brim hat. */
const KEEPER = { shirt: '#5d7a3a', pants: '#8a7550', hat: '#c9a86a' };

export function buildPerson(child: boolean, keeper: boolean, rng: Rng): PersonModel {
  const pick = <T,>(list: T[]): T => rng.pick(list);
  const root = new THREE.Group();
  const pose = new THREE.Group();
  root.add(pose);

  const skin = pick(SKIN);
  const shirt = keeper ? KEEPER.shirt : pick(SHIRTS);
  const pants = keeper ? KEEPER.pants : pick(PANTS);
  const hipHeight = 0.8;

  const hips: THREE.Group[] = [];
  const knees: THREE.Group[] = [];
  for (const side of [1, -1]) {
    const knee = new THREE.Group();
    knee.position.y = -0.38;
    knee.add(part(geo.shin, pants), part(geo.shoe, '#2a2420'));
    const hip = new THREE.Group();
    hip.position.set(side * 0.1, hipHeight, 0);
    hip.add(part(geo.thigh, pants), knee);
    pose.add(hip);
    hips.push(hip);
    knees.push(knee);
  }

  pose.add(part(geo.torso, shirt, 0, 1.12, 0));
  if (!child && !keeper && rng.next() < 0.25) pose.add(part(geo.backpack, pick(HATS), 0, 1.15, -0.2));

  const shoulders: THREE.Group[] = [];
  for (const side of [1, -1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.25, 1.36, 0);
    shoulder.rotation.z = side * 0.08;
    shoulder.add(part(geo.arm, shirt), part(geo.hand, skin));
    pose.add(shoulder);
    shoulders.push(shoulder);
  }

  const head = new THREE.Group();
  head.position.y = 1.5;
  head.add(part(geo.head, skin, 0, 0.14, 0));
  const hat = keeper ? 0 : rng.next();
  // Recorded for the 2D view; the picks below happen in exactly the same order as before.
  const look: PersonLook = { skin, shirt, pants, hair: null, hat: null };
  if (hat < 0.25) {
    const color = keeper ? KEEPER.hat : pick(HATS);
    look.hat = color;
    head.add(part(geo.brim, color, 0, 0.26, 0), part(geo.crown, keeper ? KEEPER.hat : pick(HATS), 0, 0.33, 0));
  } else {
    look.hair = pick(HAIR);
    const hair = part(geo.hair, look.hair, 0, 0.16, -0.01);
    hair.rotation.x = -0.25;
    head.add(hair);
  }
  pose.add(head);

  const scale = child ? rng.float(0.58, 0.7) : rng.float(0.92, 1.06);
  root.scale.setScalar(scale);
  // One skinned mesh per person; the joints become bones.
  const bone = skinRig(root);
  const carry = new THREE.Group();
  carry.position.set(0, 1.0, 0.34);
  bone(pose).add(carry);
  return {
    root,
    pose: bone(pose),
    hips: hips.map(bone),
    knees: knees.map(bone),
    shoulders: shoulders.map(bone),
    head: bone(head),
    carry,
    hipHeight,
    look,
    height: 1.75,
  };
}
