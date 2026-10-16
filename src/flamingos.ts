import * as THREE from 'three';
import { Builder, ell, limb, mat, stem } from './animals/rig';
import { mergeStatic } from './merge';
import { skinRig } from './skin';
import { Rng } from './rng';

/**
 * A flock of flamingos in a shallow pond. Like the lagoon's fish, each bird's
 * pose is a pure function of shared zoo time: a cycle of standing on one leg,
 * preening, wading out, feeding with the head in the water and wading back.
 * They sleep at night, one leg up and heads tucked.
 */

interface Bird {
  root: THREE.Group;
  /** Neck segments, base first; the head hangs off the last one. */
  neck: THREE.Object3D[];
  head: THREE.Object3D;
  /** Hip pivots (left, right) and knee pivots. */
  hips: THREE.Object3D[];
  knees: THREE.Object3D[];
  home: { x: number; z: number };
  away: { x: number; z: number };
  period: number;
  phase: number;
  facing: number;
}

const LEG = 0.55; // thigh and shin length
const HIP_Y = LEG * 2 + 0.04;

function buildBird(): Omit<Bird, 'home' | 'away' | 'period' | 'phase' | 'facing'> {
  const b = new Builder(0.015);
  const pink = mat('#f58fa4', 0.7);
  const deep = mat('#e2617f', 0.7);
  const legMat = mat('#e98aa0', 0.6);
  const black = mat('#1d1b1b', 0.5);
  const root = new THREE.Group();
  root.add(
    b.mesh(ell(0.2, 0.19, 0.36), pink, [0, HIP_Y + 0.12, 0]),
    b.mesh(ell(0.15, 0.08, 0.26), deep, [0, HIP_Y + 0.2, -0.08]),
    b.mesh(new THREE.ConeGeometry(0.08, 0.22, 6).rotateX(-Math.PI / 2 - 0.4), deep, [0, HIP_Y + 0.16, -0.38]),
  );

  // S-shaped neck: three segments rising from the front of the body.
  const neck: THREE.Group[] = [];
  let parent: THREE.Object3D = root;
  for (let i = 0; i < 3; i++) {
    const seg = b.group(i === 0 ? [0, HIP_Y + 0.22, 0.28] : [0, 0.3, 0], b.mesh(stem(0.045, 0.038, 0.3), pink));
    parent.add(seg);
    neck.push(seg);
    parent = seg;
  }
  const head = b.group(
    [0, 0.3, 0],
    b.mesh(ell(0.07, 0.07, 0.09), pink, [0, 0.03, 0.03]),
    b.mesh(new THREE.ConeGeometry(0.035, 0.15, 6).rotateX(Math.PI / 2 + 0.9), mat('#f2c9cf', 0.6), [0, -0.01, 0.12]),
    b.mesh(new THREE.ConeGeometry(0.022, 0.07, 6).rotateX(Math.PI / 2 + 1.6), black, [0, -0.07, 0.16], [0, 0, 0], false),
  );
  neck[2].add(head);

  const hips: THREE.Group[] = [];
  const knees: THREE.Group[] = [];
  for (const side of [1, -1]) {
    const knee = b.group([0, -LEG, 0], b.mesh(limb(0.022, 0.02, LEG), legMat), b.mesh(ell(0.06, 0.015, 0.09, 8), legMat, [0, -LEG, 0.03]));
    const hip = b.group([side * 0.07, HIP_Y, 0], b.mesh(limb(0.026, 0.022, LEG), legMat), knee);
    root.add(hip);
    hips.push(hip);
    knees.push(knee);
  }
  const bone = skinRig(root);
  return { root, neck: neck.map(bone), head: bone(head), hips: hips.map(bone), knees: knees.map(bone) };
}

const lerp = THREE.MathUtils.lerp;
const smooth = (u: number) => u * u * (3 - 2 * u);

export class Flamingos {
  readonly group = new THREE.Group();
  private readonly birds: Bird[] = [];

  constructor(cx: number, cz: number, pondR: number, fenceR: number) {
    const rng = new Rng('tiny-zoo:flamingos');
    this.group.add(mergeStatic(this.buildPond(cx, cz, pondR, fenceR, rng)));
    for (let i = 0; i < 14; i++) {
      const a = rng.float(0, Math.PI * 2);
      const r = Math.sqrt(rng.next()) * (pondR - 1.2);
      const home = { x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r };
      const b = rng.float(0, Math.PI * 2);
      const d = rng.float(1.5, 2.8);
      let away = { x: home.x + Math.cos(b) * d, z: home.z + Math.sin(b) * d };
      if (Math.hypot(away.x - cx, away.z - cz) > pondR - 0.8) away = { x: home.x - Math.cos(b) * d, z: home.z - Math.sin(b) * d };
      const bird: Bird = {
        ...buildBird(),
        home,
        away,
        period: rng.float(36, 64),
        phase: rng.next(),
        facing: rng.float(0, Math.PI * 2),
      };
      bird.root.scale.setScalar(rng.float(0.9, 1.08));
      this.group.add(bird.root);
      this.birds.push(bird);
    }
  }

  /** Pose every bird for zoo time `t` (seconds) at zoo hour `hour`. */
  update(t: number, hour: number): void {
    const night = hour < 6.3 || hour > 20.2;
    for (const b of this.birds) {
      const u = (t / b.period + b.phase) % 1;
      let x = b.home.x;
      let z = b.home.z;
      let yaw = b.facing + Math.sin(t * 0.3 + b.phase * 9) * 0.4;
      let neck = [0.5, -1.2, 1.0]; // relaxed S
      let headPitch = 0.6;
      let oneLeg = true;
      let walk = 0;
      if (night) {
        neck = [-0.9, 2.4, 0.4]; // folded back, head resting on the back
        headPitch = 1.2;
      } else if (u < 0.3) {
        if (u > 0.12 && u < 0.2) neck = [-0.6, 2.1, 0.9]; // preening a wing
      } else if (u < 0.45 || (u >= 0.75 && u < 0.9)) {
        // Wading out (or back), legs taking slow high steps.
        const out = u < 0.45;
        const k = smooth(out ? (u - 0.3) / 0.15 : (u - 0.75) / 0.15);
        const from = out ? b.home : b.away;
        const to = out ? b.away : b.home;
        x = lerp(from.x, to.x, k);
        z = lerp(from.z, to.z, k);
        yaw = Math.atan2(to.x - from.x, to.z - from.z);
        oneLeg = false;
        walk = t * 3.2 + b.phase * 10;
      } else if (u < 0.75) {
        // Feeding at the far spot: head down in the water, sweeping side to side.
        x = b.away.x;
        z = b.away.z;
        neck = [1.35, 0.9, 0.2];
        headPitch = 1.4 + Math.sin(t * 2 + b.phase) * 0.15;
        yaw = b.facing + Math.sin(t * 0.9 + b.phase * 7) * 0.35;
        oneLeg = false;
      } else {
        oneLeg = false;
      }
      b.root.position.set(x, 0, z);
      b.root.rotation.y = yaw;
      b.neck.forEach((seg, i) => (seg.rotation.x = neck[i]));
      b.head.rotation.x = headPitch;
      // One leg tucked up under the body, or both down (stepping when wading).
      const step = walk ? Math.sin(walk) : 0;
      b.hips[0].rotation.x = oneLeg ? -0.5 : step * 0.45;
      b.knees[0].rotation.x = oneLeg ? 2.5 : Math.max(0, -Math.cos(walk)) * 1.0;
      b.hips[1].rotation.x = oneLeg ? 0 : -step * 0.45;
      b.knees[1].rotation.x = oneLeg ? 0 : Math.max(0, Math.cos(walk)) * 1.0;
    }
  }

  /** Shallow pond with a muddy shore, reeds, and a knee-high rail fence. */
  private buildPond(cx: number, cz: number, pondR: number, fenceR: number, rng: Rng): THREE.Group {
    const g = new THREE.Group();
    const shore = new THREE.Mesh(
      new THREE.CircleGeometry(pondR + 1.2, 40).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: '#9a8a62', roughness: 1 }),
    );
    shore.position.set(cx, 0.03, cz);
    const water = new THREE.Mesh(
      new THREE.CircleGeometry(pondR, 40).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: '#5fb3c9', roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.85 }),
    );
    water.position.set(cx, 0.06, cz);
    shore.receiveShadow = water.receiveShadow = true;
    g.add(shore, water);

    const reed = new THREE.MeshStandardMaterial({ color: '#5b8a3a', roughness: 1 });
    for (let i = 0; i < 40; i++) {
      const a = rng.float(0, Math.PI * 2);
      const r = pondR + rng.float(0.1, 1.1);
      const h = rng.float(0.6, 1.3);
      const m = new THREE.Mesh(new THREE.ConeGeometry(0.05, h, 4), reed);
      m.position.set(cx + Math.cos(a) * r, h / 2, cz + Math.sin(a) * r);
      g.add(m);
    }

    const wood = new THREE.MeshStandardMaterial({ color: '#8a5f3a', roughness: 0.9 });
    const posts = 36;
    for (let i = 0; i < posts; i++) {
      const a = (i / posts) * Math.PI * 2;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.8, 6), wood);
      post.position.set(cx + Math.cos(a) * fenceR, 0.4, cz + Math.sin(a) * fenceR);
      post.castShadow = true;
      g.add(post);
    }
    for (const h of [0.35, 0.7]) {
      const rail = new THREE.Mesh(new THREE.TorusGeometry(fenceR, 0.04, 5, 72).rotateX(Math.PI / 2), wood);
      rail.position.set(cx, h, cz);
      rail.castShadow = true;
      g.add(rail);
    }
    return g;
  }
}
