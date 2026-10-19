import * as THREE from 'three';
import { LAGOON, LAMPS } from './layout';
import { mergeStatic } from './merge';
import { NO_AO_LAYER } from './post';
import { Rng } from './rng';
import type { WeatherState } from './weather';

/**
 * Sky and wildlife: rain, drifting clouds, bird flocks crossing overhead,
 * gulls circling the lagoon and butterflies at the flower patches. All pure
 * functions of zoo time and the day's weather, so everyone sees the same sky.
 */

const RAIN_DROPS = 1400;
const RAIN_BOX = 90; // rain falls in a box this wide around the camera target
/** Rain only falls this low, so no drop passes right in front of the camera and looks huge. */
const RAIN_TOP = 15;

/** A small bird seen from afar: two swept wings around a body, facing +z. */
function birdGeometry(span: number): THREE.BufferGeometry {
  const s = span / 2;
  const g = new THREE.BufferGeometry();
  g.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [
        // left wing, right wing (triangles), body (thin diamond)
        0, 0, 0.15, -s, 0.05, -0.15, 0, 0, -0.2,
        0, 0, 0.15, 0, 0, -0.2, s, 0.05, -0.15,
        0, 0.03, 0.3, -0.04, 0, -0.3, 0.04, 0, -0.3,
      ],
      3,
    ),
  );
  g.computeVertexNormals();
  return g;
}

/** A butterfly: two pairs of wings, flapping is done by squashing x. */
function butterflyGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [0, 0, 0.05, -0.14, 0.02, 0.1, -0.12, 0, -0.06, 0, 0, 0.05, 0.12, 0, -0.06, 0.14, 0.02, 0.1, 0, 0, -0.02, -0.09, 0, -0.12, 0.09, 0, -0.12],
      3,
    ),
  );
  g.computeVertexNormals();
  return g;
}

interface Flock {
  start: THREE.Vector2;
  dir: THREE.Vector2;
  period: number;
  phase: number;
  height: number;
}

export class Ambient {
  readonly group = new THREE.Group();
  private readonly rain: THREE.InstancedMesh;
  private readonly rainMat: THREE.MeshBasicMaterial;
  private readonly drops: { x: number; z: number; phase: number }[] = [];
  private readonly clouds: THREE.Group[] = [];
  private readonly cloudMat: THREE.MeshStandardMaterial;
  private readonly birds: THREE.InstancedMesh;
  private readonly flocks: Flock[] = [];
  private readonly gulls: THREE.InstancedMesh;
  private readonly butterflies: THREE.InstancedMesh;
  private readonly flutters: { x: number; z: number; phase: number }[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor() {
    const rng = new Rng('tiny-zoo:ambient');

    this.rainMat = new THREE.MeshBasicMaterial({ color: '#cfe0ee', transparent: true, opacity: 0, depthWrite: false });
    this.rain = new THREE.InstancedMesh(new THREE.BoxGeometry(0.025, 0.7, 0.025), this.rainMat, RAIN_DROPS);
    for (let i = 0; i < RAIN_DROPS; i++) {
      this.drops.push({ x: rng.float(-RAIN_BOX / 2, RAIN_BOX / 2), z: rng.float(-RAIN_BOX / 2, RAIN_BOX / 2), phase: rng.next() });
    }
    this.rain.frustumCulled = false;
    this.rain.layers.set(NO_AO_LAYER);
    this.rain.visible = false;
    this.group.add(this.rain);

    // Clouds: puffy clusters high up, drifting east; more of them show on cloudier days.
    this.cloudMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, transparent: true, opacity: 0.92, flatShading: true });
    for (let i = 0; i < 16; i++) {
      const cluster = new THREE.Group();
      const puffs = 4 + rng.int(4);
      for (let j = 0; j < puffs; j++) {
        const r = rng.float(5, 10);
        const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1).scale(1.3, 0.55, 1), this.cloudMat);
        puff.position.set(rng.float(-12, 12), rng.float(-1.5, 2), rng.float(-6, 6));
        // No cloud shadows: huge shapes are expensive to draw into the shadow map.
        cluster.add(puff);
      }
      const merged = mergeStatic(cluster);
      merged.userData = { x: rng.float(-260, 260), z: rng.float(-220, 160), y: rng.float(75, 95), speed: rng.float(1.2, 2.4) };
      merged.traverse((o) => o.layers.set(NO_AO_LAYER));
      this.clouds.push(merged);
      this.group.add(merged);
    }

    // Bird flocks crossing the sky.
    this.birds = new THREE.InstancedMesh(birdGeometry(1.2), new THREE.MeshStandardMaterial({ color: '#2b2d33', side: THREE.DoubleSide }), 4 * 7);
    for (let f = 0; f < 4; f++) {
      const a = rng.float(0, Math.PI * 2);
      this.flocks.push({
        start: new THREE.Vector2(Math.cos(a) * 260, Math.sin(a) * 260 - 15),
        dir: new THREE.Vector2(-Math.cos(a + rng.float(-0.4, 0.4)), -Math.sin(a + rng.float(-0.4, 0.4))),
        period: rng.float(70, 120),
        phase: rng.next(),
        height: rng.float(30, 48),
      });
    }
    this.birds.frustumCulled = false;
    this.birds.layers.set(NO_AO_LAYER);
    this.group.add(this.birds);

    this.gulls = new THREE.InstancedMesh(birdGeometry(1.0), new THREE.MeshStandardMaterial({ color: '#f4f4f2', side: THREE.DoubleSide }), 5);
    this.gulls.frustumCulled = false;
    this.gulls.layers.set(NO_AO_LAYER);
    this.group.add(this.gulls);

    // Butterflies flutter around the lamp posts' flower beds along the paths.
    this.butterflies = new THREE.InstancedMesh(butterflyGeometry(), new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.6 }), 36);
    const colors = ['#ffd23f', '#ff7aa8', '#ffffff', '#ff9a4d', '#9fd3ef', '#c77dff'];
    const c = new THREE.Color();
    for (let i = 0; i < this.butterflies.count; i++) {
      const [lx, lz] = LAMPS[i % LAMPS.length];
      this.flutters.push({ x: lx + rng.float(-3, 3), z: lz + rng.float(-3, 3), phase: rng.float(0, 100) });
      this.butterflies.setColorAt(i, c.set(rng.pick(colors)));
    }
    this.butterflies.frustumCulled = false;
    this.butterflies.layers.set(NO_AO_LAYER);
    this.group.add(this.butterflies);
  }

  /**
   * What's in the sky as of the last update(), for the 2D view: birds and gulls (height, wing
   * flap 0..1), butterflies (with colour) and clouds. Read straight from the instances.
   */
  get sky(): {
    birds: { x: number; z: number; y: number; flap: number }[];
    gulls: { x: number; z: number; y: number; flap: number }[];
    butterflies: { x: number; z: number; y: number; flap: number; color: string }[];
    clouds: { x: number; z: number; seed: number }[];
  } {
    const read = (mesh: THREE.InstancedMesh, flapOf: (e: number[]) => number) => {
      if (!mesh.visible) return [];
      return Array.from({ length: mesh.count }, (_, i) => {
        mesh.getMatrixAt(i, this.m);
        const e = this.m.elements;
        return { x: e[12], z: e[14], y: e[13], flap: flapOf(e) };
      });
    };
    const c = new THREE.Color();
    return {
      birds: read(this.birds, (e) => Math.min(1, (e[5] - 0.35) / 0.9)),
      gulls: read(this.gulls, (e) => Math.min(1, (e[5] - 0.5) / 0.6)),
      butterflies: read(this.butterflies, (e) => Math.min(1, (Math.hypot(e[0], e[2]) - 0.15) / 0.85)).map((b, i) => {
        this.butterflies.getColorAt(i, c);
        return { ...b, color: '#' + c.getHexString(THREE.SRGBColorSpace) };
      }),
      clouds: this.clouds.flatMap((cl, i) => (cl.visible ? [{ x: cl.position.x, z: cl.position.z, seed: i }] : [])),
    };
  }

  /** Zoo time `t` (seconds), zoo hour, the day's weather, and where the camera is looking (rain follows it). */
  update(t: number, hour: number, w: WeatherState, focus: THREE.Vector3): void {
    const day = hour > 6.5 && hour < 19.5;
    this.updateRain(t, w, focus);
    this.updateClouds(t, w);
    this.updateBirds(t, day && w.rain < 0.5, w);
    this.updateButterflies(t, day && w.rain < 0.2 && w.fog < 0.6);
  }

  private updateRain(t: number, w: WeatherState, focus: THREE.Vector3): void {
    this.rain.visible = w.rain > 0.02;
    if (!this.rain.visible) return;
    this.rainMat.opacity = 0.5 * w.rain;
    // Drops fall through a box that follows the camera, snapped so they don't slide with it.
    const cx = Math.round(focus.x / RAIN_BOX) * RAIN_BOX;
    const cz = Math.round(focus.z / RAIN_BOX) * RAIN_BOX;
    this.q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.12);
    this.drops.forEach((d, i) => {
      const y = RAIN_TOP - (((t * 24) / RAIN_TOP + d.phase) % 1) * RAIN_TOP;
      let x = cx + d.x;
      let z = cz + d.z;
      // Wrap into the box around the focus so there's always rain on screen.
      if (x - focus.x > RAIN_BOX / 2) x -= RAIN_BOX;
      if (focus.x - x > RAIN_BOX / 2) x += RAIN_BOX;
      if (z - focus.z > RAIN_BOX / 2) z -= RAIN_BOX;
      if (focus.z - z > RAIN_BOX / 2) z += RAIN_BOX;
      this.m.makeRotationFromQuaternion(this.q).setPosition(x + y * 0.12, y, z);
      this.rain.setMatrixAt(i, this.m);
    });
    this.rain.instanceMatrix.needsUpdate = true;
  }

  private updateClouds(t: number, w: WeatherState): void {
    const shown = Math.round(2 + w.cloud * 14);
    const grey = 1 - 0.45 * Math.max(w.rain, w.cloud * 0.4);
    this.cloudMat.color.setRGB(grey, grey, grey * 1.02);
    this.clouds.forEach((c, i) => {
      const d = c.userData as { x: number; z: number; y: number; speed: number };
      c.visible = i < shown;
      // Drift east and wrap around.
      const x = ((((d.x + t * d.speed + 280) % 560) + 560) % 560) - 280;
      c.position.set(x, d.y, d.z);
    });
  }

  private updateBirds(t: number, flying: boolean, w: WeatherState): void {
    this.birds.visible = flying;
    this.gulls.visible = flying || w.rain < 0.8;
    const s = new THREE.Vector3();
    if (flying) {
      this.flocks.forEach((f, fi) => {
        const u = (t / f.period + f.phase) % 1;
        const cx = f.start.x + f.dir.x * u * 520;
        const cz = f.start.y + f.dir.y * u * 520;
        const yaw = Math.atan2(f.dir.x, f.dir.y);
        for (let b = 0; b < 7; b++) {
          // V formation behind the leader.
          const side = b === 0 ? 0 : (b % 2 ? 1 : -1) * Math.ceil(b / 2);
          const back = Math.ceil(b / 2) * 2.2;
          const ox = side * 2.2;
          const x = cx + ox * Math.cos(yaw) - back * Math.sin(yaw);
          const z = cz - ox * Math.sin(yaw) - back * Math.cos(yaw);
          const flap = 0.35 + Math.abs(Math.sin(t * 7 + b + fi)) * 0.9;
          this.q.setFromAxisAngle(this.up, yaw);
          this.m.compose(new THREE.Vector3(x, f.height + Math.sin(t + b) * 0.4, z), this.q, s.set(1, flap, 1));
          this.birds.setMatrixAt(fi * 7 + b, this.m);
        }
      });
      this.birds.instanceMatrix.needsUpdate = true;
    }
    // Gulls wheeling over the reef lagoon.
    for (let i = 0; i < this.gulls.count; i++) {
      const a = t * (0.18 + i * 0.03) + i * 1.3;
      const r = 9 + i * 1.6;
      const x = LAGOON.x + Math.cos(a) * r;
      const z = LAGOON.z + Math.sin(a) * r;
      const flap = 0.5 + Math.abs(Math.sin(t * 4 + i)) * 0.6;
      this.q.setFromAxisAngle(this.up, Math.atan2(-Math.sin(a), Math.cos(a)));
      this.m.compose(new THREE.Vector3(x, 13 + i * 1.2 + Math.sin(t * 0.7 + i) * 1.5, z), this.q, s.set(1, flap, 1));
      this.gulls.setMatrixAt(i, this.m);
    }
    this.gulls.instanceMatrix.needsUpdate = true;
  }

  private updateButterflies(t: number, out: boolean): void {
    this.butterflies.visible = out;
    if (!out) return;
    const s = new THREE.Vector3();
    this.flutters.forEach((f, i) => {
      const tt = t + f.phase;
      const x = f.x + Math.sin(tt * 0.9) * 1.4 + Math.sin(tt * 2.3) * 0.3;
      const z = f.z + Math.cos(tt * 0.7) * 1.4;
      const y = 0.7 + Math.abs(Math.sin(tt * 1.6)) * 0.8;
      const flap = 0.15 + Math.abs(Math.sin(tt * 18)) * 0.85;
      this.q.setFromAxisAngle(this.up, tt * 0.9);
      this.m.compose(new THREE.Vector3(x, y, z), this.q, s.set(flap, 1, 1));
      this.butterflies.setMatrixAt(i, this.m);
    });
    this.butterflies.instanceMatrix.needsUpdate = true;
  }
}
