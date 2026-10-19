import * as THREE from 'three';
import { TRAIN_TRACK } from './layout';
import { mergeStatic } from './merge';

/**
 * The zoo train: an engine and three open carriages circling the zoo on an
 * oval track. Its position is a pure function of the zoo clock: one lap per
 * opening day (9:00 to 18:00), waiting at the station the rest of the time.
 */

const OPEN = 9;
const CLOSE = 18;
const SAMPLES = 160;
const CAR_GAP = 3.9; // distance between car centers along the track

const mats = new Map<string, THREE.MeshStandardMaterial>();
function mat(color: string, roughness = 0.7, metalness = 0): THREE.MeshStandardMaterial {
  const key = `${color}-${roughness}-${metalness}`;
  let m = mats.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness, metalness });
    mats.set(key, m);
  }
  return m;
}

function box(g: THREE.Object3D, w: number, h: number, d: number, color: string, x: number, y: number, z: number): void {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  m.position.set(x, y, z);
  m.castShadow = true;
  g.add(m);
}

function wheels(g: THREE.Object3D, zs: number[], r: number): void {
  const geo = new THREE.CylinderGeometry(r, r, 0.14, 14).rotateZ(Math.PI / 2);
  for (const z of zs) {
    for (const x of [-0.62, 0.62]) {
      const w = new THREE.Mesh(geo, mat('#2c2f33', 0.5, 0.6));
      w.position.set(x, r, z);
      w.castShadow = true;
      g.add(w);
    }
  }
}

/** Steam engine facing +z: boiler, cab, chimney, cowcatcher. */
function engine(): THREE.Group {
  const g = new THREE.Group();
  box(g, 1.4, 0.35, 3.2, '#2c2f33', 0, 0.55, 0);
  const boiler = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 2.0, 16).rotateX(Math.PI / 2), mat('#c0392b', 0.45, 0.2));
  boiler.position.set(0, 1.25, 0.45);
  boiler.castShadow = true;
  g.add(boiler);
  const chimney = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.15, 0.8, 10), mat('#2c2f33'));
  chimney.position.set(0, 2.05, 1.05);
  g.add(chimney);
  box(g, 1.4, 1.5, 1.1, '#c0392b', 0, 1.45, -1.0); // cab
  box(g, 1.6, 0.12, 1.4, '#2c2f33', 0, 2.25, -1.0); // cab roof
  box(g, 1.0, 0.5, 0.06, '#9fd3ef', 0, 1.7, -0.44); // cab window
  const catcher = new THREE.Mesh(new THREE.ConeGeometry(0.75, 0.6, 4).rotateX(Math.PI / 2).rotateZ(Math.PI / 4), mat('#ffd23f'));
  catcher.position.set(0, 0.5, 1.75);
  g.add(catcher);
  wheels(g, [-1.0, 0.1, 1.1], 0.38);
  return mergeStatic(g);
}

/** Open carriage with two benches of passengers. */
function carriage(color: string, seed: number): THREE.Group {
  const g = new THREE.Group();
  box(g, 1.5, 0.3, 3.0, '#2c2f33', 0, 0.5, 0);
  box(g, 1.5, 0.5, 0.08, color, 0, 0.9, 1.46);
  box(g, 1.5, 0.5, 0.08, color, 0, 0.9, -1.46);
  box(g, 0.08, 0.5, 3.0, color, 0.73, 0.9, 0);
  box(g, 0.08, 0.5, 3.0, color, -0.73, 0.9, 0);
  const shirts = ['#e85d5d', '#4f8fdc', '#f2c14e', '#6cc28a', '#b07ad9', '#ff9f5a', '#f5f5f0'];
  const skins = ['#f3d2b3', '#e0b18a', '#c68b5e', '#8d5a3b'];
  let k = seed;
  for (const z of [-0.7, 0.7]) {
    for (const x of [-0.35, 0.35]) {
      k = (k * 9301 + 49297) % 233280;
      const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.3, 3, 8), mat(shirts[k % shirts.length]));
      torso.position.set(x, 1.1, z);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), mat(skins[k % skins.length]));
      head.position.set(x, 1.55, z);
      torso.castShadow = head.castShadow = true;
      g.add(torso, head);
    }
  }
  wheels(g, [-0.95, 0.95], 0.3);
  return mergeStatic(g);
}

export class Train {
  readonly group = new THREE.Group();
  private readonly curve: THREE.CatmullRomCurve3;
  private readonly length: number;
  private readonly cars: THREE.Group[];
  private readonly smoke: THREE.InstancedMesh;
  private readonly tmp = new THREE.Vector3();
  private readonly tan = new THREE.Vector3();

  constructor() {
    const { x, z, rx, rz } = TRAIN_TRACK;
    // Start (and the station) on the west side.
    const pts = Array.from({ length: SAMPLES }, (_, i) => {
      const a = Math.PI + (i / SAMPLES) * Math.PI * 2;
      return new THREE.Vector3(x + Math.cos(a) * rx, 0, z + Math.sin(a) * rz);
    });
    this.curve = new THREE.CatmullRomCurve3(pts, true);
    this.length = this.curve.getLength();
    this.group.add(mergeStatic(this.buildTrack()));
    this.cars = [engine(), carriage('#2f6f8f', 7), carriage('#6cc28a', 19), carriage('#ffd23f', 31)];
    this.group.add(...this.cars);

    this.smoke = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(0.3, 1),
      new THREE.MeshStandardMaterial({ color: '#f2f2f2', roughness: 1, transparent: true, opacity: 0.7, depthWrite: false }),
      8,
    );
    this.smoke.frustumCulled = false;
    this.group.add(this.smoke);
  }

  /** Engine first, then carriages: where each is and its heading, as of the last update() (for the 2D view). */
  get carPoses(): { x: number; z: number; yaw: number }[] {
    return this.cars.map((c) => ({ x: c.position.x, z: c.position.z, yaw: c.rotation.y }));
  }

  /** Place the train for zoo time `t` (seconds) and zoo hour `hour`. */
  update(t: number, hour: number): void {
    const running = hour >= OPEN && hour < CLOSE;
    // One lap over the opening hours, ending back at the station.
    const u = running ? (hour - OPEN) / (CLOSE - OPEN) : 0;
    this.cars.forEach((car, i) => {
      const ui = (((u - (i * CAR_GAP) / this.length) % 1) + 1) % 1;
      this.curve.getPointAt(ui, this.tmp);
      this.curve.getTangentAt(ui, this.tan);
      car.position.copy(this.tmp).setY(0.25);
      car.rotation.y = Math.atan2(this.tan.x, this.tan.z);
    });

    // Puffs from the chimney while running, drifting up and back.
    const head = this.cars[0];
    this.smoke.visible = running;
    if (!running) return;
    const m = new THREE.Matrix4();
    const back = new THREE.Vector3(-Math.sin(head.rotation.y), 0, -Math.cos(head.rotation.y));
    for (let j = 0; j < this.smoke.count; j++) {
      const age = (t * 0.9 + j / this.smoke.count) % 1;
      const s = 0.5 + age * 1.6;
      m.makeScale(s, s, s).setPosition(
        head.position.x + Math.sin(head.rotation.y) * 1.05 + back.x * age * 2.5,
        2.6 + age * 2.2,
        head.position.z + Math.cos(head.rotation.y) * 1.05 + back.z * age * 2.5,
      );
      this.smoke.setMatrixAt(j, m);
    }
    this.smoke.instanceMatrix.needsUpdate = true;
  }

  /** Gravel bed, sleepers, two rails, and a little station with a roof. */
  private buildTrack(): THREE.Group {
    const g = new THREE.Group();
    const n = SAMPLES * 2;
    const left: THREE.Vector3[] = [];
    const right: THREE.Vector3[] = [];
    const railL: THREE.Vector3[] = [];
    const railR: THREE.Vector3[] = [];
    const p = new THREE.Vector3();
    const tng = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      this.curve.getPointAt(i / n, p);
      this.curve.getTangentAt(i / n, tng);
      const nx = -tng.z;
      const nz = tng.x;
      left.push(new THREE.Vector3(p.x + nx * 1.3, 0.04, p.z + nz * 1.3));
      right.push(new THREE.Vector3(p.x - nx * 1.3, 0.04, p.z - nz * 1.3));
      railL.push(new THREE.Vector3(p.x + nx * 0.62, 0.2, p.z + nz * 0.62));
      railR.push(new THREE.Vector3(p.x - nx * 0.62, 0.2, p.z - nz * 0.62));
    }
    // Gravel ribbon.
    const pos: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = left[i];
      const b = right[i];
      const c = left[(i + 1) % n];
      const d = right[(i + 1) % n];
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, c.x, c.y, c.z, b.x, b.y, b.z, d.x, d.y, d.z);
    }
    const ribbon = new THREE.BufferGeometry();
    ribbon.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    ribbon.computeVertexNormals();
    const bed = new THREE.Mesh(ribbon, new THREE.MeshStandardMaterial({ color: '#8f8a80', roughness: 1, side: THREE.DoubleSide }));
    bed.receiveShadow = true;
    g.add(bed);
    for (const rail of [railL, railR]) {
      const tube = new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rail, true), n, 0.06, 5, true),
        mat('#7d858c', 0.35, 0.7),
      );
      g.add(tube);
    }
    // Sleepers every ~1.2 units.
    const count = Math.floor(this.length / 1.2);
    const sleepers = new THREE.InstancedMesh(new THREE.BoxGeometry(1.9, 0.1, 0.32), mat('#6b4a2f', 0.9), count);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    for (let i = 0; i < count; i++) {
      this.curve.getPointAt(i / count, p);
      this.curve.getTangentAt(i / count, tng);
      q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, Math.atan2(tng.x, tng.z));
      m.compose(new THREE.Vector3(p.x, 0.1, p.z), q, new THREE.Vector3(1, 1, 1));
      sleepers.setMatrixAt(i, m);
    }
    sleepers.receiveShadow = true;
    this.group.add(sleepers);

    // Station platform and roof on the outside of the track, where the train waits overnight.
    const start = this.curve.getPointAt(0, new THREE.Vector3());
    const station = new THREE.Group();
    box(station, 3, 0.5, 14, '#c9b48a', -2.9, 0.25, 0);
    for (const zz of [-5.5, 0, 5.5]) box(station, 0.2, 2.6, 0.2, '#7a4f2c', -3.9, 1.6, zz);
    box(station, 3.4, 0.2, 14.4, '#3f6e3a', -3.0, 2.95, 0);
    station.position.copy(start);
    g.add(station);
    return g;
  }
}
