import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { cobbleTexture, dirtTexture, repeated } from './materials';
import { mergeStatic } from './merge';
import { NO_AO_LAYER } from './post';
import { Rng } from './rng';

/**
 * The reef lagoon: a round, waist-high glass tank of clear tropical water.
 *
 * Everything that moves in here (fish schools, rays, the turtle, the shark,
 * swaying seaweed, light ripples) is a pure function of shared zoo time, so
 * every browser shows the same fish in the same places at no simulation cost.
 */

const WALL = 1.7; // glass height
const SURFACE = 1.5; // water level
const R = 13; // tank radius
const SWIM_R = 11.2; // fish stay inside this radius

/** Uniform shared by every shader here: zoo time in seconds. */
const time = { value: 0 };

/** Sunlight ripples (caustics) on anything below the surface, by world position. */
const CAUSTIC_GLSL = /* glsl */ `
  uniform float uTime;
  varying vec3 vCausticPos;
  float caustic(vec2 p, float t) {
    vec2 q = p * 0.85;
    float c = 0.0;
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      q += vec2(sin(q.y * 1.7 + t * 0.9 + fi), cos(q.x * 1.3 - t * 0.7 + fi * 1.7));
      c += abs(sin(q.x + q.y));
    }
    return pow(1.0 - c / 3.0, 3.0);
  }`;

function withCaustics(material: THREE.MeshStandardMaterial, strength: number, key: string): THREE.MeshStandardMaterial {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCausticPos;')
      .replace(
        '#include <project_vertex>',
        '#include <project_vertex>\nvCausticPos = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${CAUSTIC_GLSL}`)
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += vec3(0.45, 0.75, 0.8) * caustic(vCausticPos.xz, uTime) * ${strength.toFixed(2)};`,
      );
  };
  material.customProgramCacheKey = () => `caustics-${key}`;
  return material;
}

/** Closed-form swimming: a looping path and its heading at time t. */
interface Path {
  rx: number;
  rz: number;
  wx: number;
  wz: number;
  px: number;
  pz: number;
  y: number;
  ya: number;
}

function pathAt(p: Path, t: number, out: THREE.Vector3): number {
  out.set(Math.sin(p.wx * t + p.px) * p.rx, p.y + Math.sin(t * 0.37 + p.px) * p.ya, Math.sin(p.wz * t + p.pz) * p.rz);
  const dx = p.rx * p.wx * Math.cos(p.wx * t + p.px);
  const dz = p.rz * p.wz * Math.cos(p.wz * t + p.pz);
  return Math.atan2(dx, dz);
}

function randomPath(rng: Rng, reach: number, y: number, speed: number): Path {
  return {
    rx: rng.float(reach * 0.55, reach),
    rz: rng.float(reach * 0.55, reach),
    wx: rng.float(0.6, 1.1) * speed,
    wz: rng.float(0.6, 1.1) * speed,
    px: rng.float(0, Math.PI * 2),
    pz: rng.float(0, Math.PI * 2),
    y,
    ya: 0.15,
  };
}

interface School {
  mesh: THREE.InstancedMesh;
  path: Path;
  /** Per-fish offset from the school center (in school space), lag and wiggle phase. */
  fish: { ox: number; oy: number; oz: number; lag: number; phase: number }[];
  colors: string[];
}

export type LagoonCreature = { kind: 'fish' | 'ray' | 'turtle' | 'shark'; x: number; z: number; yaw: number; color: string };

/** A small fish: side-flattened body plus a forked tail, facing +z. */
function fishGeometry(length: number): THREE.BufferGeometry {
  const body = new THREE.SphereGeometry(1, 10, 6).scale(0.28 * length, 0.42 * length, length).toNonIndexed();
  const tail = new THREE.ConeGeometry(0.32 * length, 0.55 * length, 4)
    .scale(0.3, 1, 1)
    .rotateX(Math.PI / 2)
    .translate(0, 0, -1.15 * length)
    .toNonIndexed();
  return mergeGeometries([body, tail])!;
}

export class Lagoon {
  readonly group = new THREE.Group();
  private readonly schools: School[] = [];
  private readonly rays: { root: THREE.Group; wings: THREE.Group[]; path: Path; phase: number }[] = [];
  private turtle!: { root: THREE.Group; flippers: THREE.Group[]; path: Path };
  private shark!: { root: THREE.Group; tail: THREE.Group };
  private readonly tmp = new THREE.Vector3();
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();

  private readonly center: { x: number; z: number };

  constructor(cx: number, cz: number) {
    this.center = { x: cx, z: cz };
    const rng = new Rng('tiny-zoo:lagoon');
    const statics = new THREE.Group();
    this.buildTank(statics);
    this.buildReef(statics, rng);
    const merged = mergeStatic(statics);
    merged.position.set(cx, 0, cz);
    this.group.add(merged);

    const life = new THREE.Group();
    life.position.set(cx, 0, cz);
    this.group.add(life);
    this.buildSeaweed(life, rng);
    this.buildSchools(life, rng);
    this.buildRays(life, rng);
    this.buildTurtle(life, rng);
    this.buildShark(life);
    // The water surface goes last so the fish show through it.
    this.buildWater(life);
  }

  /** Everything swimming, in world coordinates, as of the last update() (for the 2D view). */
  get creatures(): LagoonCreature[] {
    const { x: cx, z: cz } = this.center;
    const out: LagoonCreature[] = [];
    for (const school of this.schools) {
      for (let i = 0; i < school.fish.length; i++) {
        school.mesh.getMatrixAt(i, this.m);
        const e = this.m.elements;
        out.push({ kind: 'fish', x: cx + e[12], z: cz + e[14], yaw: Math.atan2(e[8], e[10]), color: school.colors[i % school.colors.length] });
      }
    }
    for (const r of this.rays) out.push({ kind: 'ray', x: cx + r.root.position.x, z: cz + r.root.position.z, yaw: r.root.rotation.y, color: '#5a6470' });
    const t = this.turtle.root;
    out.push({ kind: 'turtle', x: cx + t.position.x, z: cz + t.position.z, yaw: t.rotation.y, color: '#4a7a3a' });
    const sh = this.shark.root;
    out.push({ kind: 'shark', x: cx + sh.position.x, z: cz + sh.position.z, yaw: sh.rotation.y, color: '#7d8a94' });
    return out;
  }

  /** Move everything to zoo time `t` (seconds). */
  update(t: number): void {
    time.value = t;
    const p = this.tmp;

    for (const school of this.schools) {
      school.fish.forEach((f, i) => {
        const yaw = pathAt(school.path, t - f.lag, p);
        const c = Math.cos(yaw);
        const sn = Math.sin(yaw);
        let x = p.x + f.ox * c + f.oz * sn;
        let z = p.z - f.ox * sn + f.oz * c;
        const d = Math.hypot(x, z);
        if (d > SWIM_R) {
          x *= SWIM_R / d;
          z *= SWIM_R / d;
        }
        const y = THREE.MathUtils.clamp(p.y + f.oy, 0.25, SURFACE - 0.15);
        this.q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw + Math.sin(t * 9 + f.phase) * 0.18);
        this.m.makeRotationFromQuaternion(this.q).setPosition(x, y, z);
        school.mesh.setMatrixAt(i, this.m);
      });
      school.mesh.instanceMatrix.needsUpdate = true;
    }

    for (const ray of this.rays) {
      const yaw = pathAt(ray.path, t, p);
      ray.root.position.copy(p);
      ray.root.rotation.y = yaw;
      ray.root.rotation.z = Math.sin(t * 0.8 + ray.phase) * 0.12;
      const flap = Math.sin(t * 2.2 + ray.phase) * 0.35;
      ray.wings[0].rotation.z = flap;
      ray.wings[1].rotation.z = -flap;
    }

    const turtleYaw = pathAt(this.turtle.path, t, p);
    this.turtle.root.position.copy(p);
    this.turtle.root.rotation.y = turtleYaw;
    const paddle = Math.sin(t * 1.6);
    this.turtle.flippers.forEach((f, i) => {
      const front = i < 2;
      const side = i % 2 === 0 ? 1 : -1;
      f.rotation.y = side * (front ? paddle * 0.6 : -paddle * 0.3);
    });

    // The shark circles slowly, its body and tail swaying.
    const a = t * 0.11;
    const sr = 8.4 + Math.sin(t * 0.07) * 1.2;
    this.shark.root.position.set(Math.cos(a) * sr, 0.75 + Math.sin(t * 0.3) * 0.15, Math.sin(a) * sr);
    // Heading along the circle (direction of travel), with a gentle sway.
    this.shark.root.rotation.y = Math.atan2(-Math.sin(a), Math.cos(a)) + Math.sin(t * 1.4) * 0.08;
    this.shark.tail.rotation.y = Math.sin(t * 2.8) * 0.45;
  }

  private buildTank(g: THREE.Group): void {
    // Sandy floor with sunlight ripples.
    const sand = withCaustics(
      // Pale sand seen through clear water: tinted turquoise directly, so it reads as depth.
      new THREE.MeshStandardMaterial({ color: '#8fd9d2', map: repeated(dirtTexture(), 1 / 10, 1 / 10), roughness: 1 }),
      0.45,
      'sand',
    );
    const floor = new THREE.Mesh(new THREE.CircleGeometry(R, 48).rotateX(-Math.PI / 2), sand);
    floor.position.y = 0.04;
    floor.receiveShadow = true;

    // Glass wall with a steel rim, on a low stone plinth.
    const glass = new THREE.MeshStandardMaterial({
      color: '#bfe9ef',
      roughness: 0.05,
      metalness: 0.1,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(R, R, WALL - 0.25, 64, 1, true), glass);
    wall.position.y = 0.25 + (WALL - 0.25) / 2;
    const plinth = new THREE.Mesh(
      new THREE.CylinderGeometry(R + 0.15, R + 0.2, 0.25, 64, 1, true),
      new THREE.MeshStandardMaterial({ color: '#8f9aa1', roughness: 0.8, side: THREE.DoubleSide }),
    );
    plinth.position.y = 0.125;
    const steel = new THREE.MeshStandardMaterial({ color: '#a7b1b8', roughness: 0.3, metalness: 0.75 });
    const rim = new THREE.Mesh(new THREE.TorusGeometry(R, 0.07, 6, 96).rotateX(Math.PI / 2), steel);
    rim.position.y = WALL;
    rim.castShadow = true;

    // Walkway ring around the tank.
    const walk = new THREE.Mesh(
      new THREE.RingGeometry(R + 0.2, R + 3.6, 64, 1).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: repeated(cobbleTexture(), 6, 6), roughness: 0.95 }),
    );
    walk.position.y = 0.014;
    walk.receiveShadow = true;
    g.add(floor, wall, plinth, rim, walk);
  }

  /** Coral clusters, brain corals, sponges and rocks scattered over the floor. */
  private buildReef(g: THREE.Group, rng: Rng): void {
    const colors = ['#ff6f91', '#ff9a4d', '#c77dff', '#ffd23f', '#4ecdc4', '#ef476f'];
    const mats = new Map<string, THREE.MeshStandardMaterial>();
    const mat = (c: string) => {
      let m = mats.get(c);
      if (!m) {
        m = withCaustics(new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, flatShading: true }), 0.45, `coral-${c}`);
        mats.set(c, m);
      }
      return m;
    };
    const rockMat = withCaustics(
      new THREE.MeshStandardMaterial({ color: '#9a958c', roughness: 0.95, flatShading: true }),
      0.45,
      'rock',
    );
    for (let i = 0; i < 34; i++) {
      const a = rng.float(0, Math.PI * 2);
      const r = Math.sqrt(rng.next()) * (R - 1.5);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const kind = rng.int(4);
      const color = rng.pick(colors);
      if (kind === 0) {
        // Branching coral: a fan of thin stems.
        for (let b = 0; b < 6; b++) {
          const h = rng.float(0.35, 0.8);
          const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.05, h, 5).translate(0, h / 2, 0), mat(color));
          stem.position.set(x, 0.04, z);
          stem.rotation.set(rng.float(-0.6, 0.6), rng.float(0, Math.PI), rng.float(-0.6, 0.6));
          g.add(stem);
        }
      } else if (kind === 1) {
        const r0 = rng.float(0.25, 0.5);
        const brain = new THREE.Mesh(new THREE.IcosahedronGeometry(r0, 2).scale(1, 0.6, 1), mat(color));
        brain.position.set(x, 0.04 + r0 * 0.2, z);
        g.add(brain);
      } else if (kind === 2) {
        // Tube sponges.
        for (let b = 0; b < 3; b++) {
          const h = rng.float(0.3, 0.7);
          const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.07, h, 8, 1, true).translate(0, h / 2, 0), mat(color));
          tube.position.set(x + rng.float(-0.2, 0.2), 0.04, z + rng.float(-0.2, 0.2));
          g.add(tube);
        }
      } else {
        const r0 = rng.float(0.3, 0.7);
        const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(r0, 0).scale(1, 0.6, 1), rockMat);
        rock.position.set(x, 0.1, z);
        rock.rotation.y = rng.float(0, Math.PI);
        g.add(rock);
      }
    }
  }

  /** Instanced seaweed ribbons that sway with the current (in the vertex shader). */
  private buildSeaweed(g: THREE.Group, rng: Rng): void {
    const geo = new THREE.PlaneGeometry(0.14, 1.1, 1, 8).translate(0, 0.55, 0);
    const material = new THREE.MeshStandardMaterial({ color: '#3f9a4a', roughness: 0.8, side: THREE.DoubleSide });
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = time;
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;').replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
        float phase = instanceMatrix[3].x * 1.7 + instanceMatrix[3].z * 2.3;
        float bend = pow(position.y / 1.1, 2.0);
        transformed.x += sin(uTime * 1.3 + phase) * 0.22 * bend;
        transformed.z += cos(uTime * 1.1 + phase) * 0.12 * bend;`,
      );
    };
    material.customProgramCacheKey = () => 'seaweed';
    const count = 140;
    const mesh = new THREE.InstancedMesh(geo, material, count);
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      // Clumps near the edge of the tank.
      const a = rng.float(0, Math.PI * 2);
      const r = rng.float(R * 0.55, R - 0.6);
      this.m.compose(
        this.s.set(Math.cos(a) * r, 0.04, Math.sin(a) * r),
        this.q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rng.float(0, Math.PI)),
        new THREE.Vector3(1, rng.float(0.6, 1.25), 1),
      );
      mesh.setMatrixAt(i, this.m);
      mesh.setColorAt(i, c.set('#3f9a4a').offsetHSL(rng.float(-0.04, 0.04), 0, rng.float(-0.1, 0.08)));
    }
    mesh.layers.set(NO_AO_LAYER);
    g.add(mesh);
  }

  private buildSchools(g: THREE.Group, rng: Rng): void {
    const specs = [
      { count: 14, length: 0.13, colors: ['#ff7b25', '#ff8c3a'], reach: 7, y: 0.6, speed: 0.13, spread: 0.9 }, // clownfish
      { count: 16, length: 0.17, colors: ['#2f6fe0', '#3a82f0'], reach: 9, y: 0.9, speed: 0.1, spread: 1.2 }, // blue tang
      { count: 16, length: 0.15, colors: ['#ffd43b', '#ffe066'], reach: 8.5, y: 0.75, speed: 0.12, spread: 1.0 }, // yellow tang
      { count: 44, length: 0.1, colors: ['#c9d6df', '#e3edf2'], reach: 9.5, y: 1.05, speed: 0.16, spread: 0.7 }, // sardines
    ];
    for (const spec of specs) {
      const material = new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.15 });
      const mesh = new THREE.InstancedMesh(fishGeometry(spec.length), material, spec.count);
      const c = new THREE.Color();
      const fish = Array.from({ length: spec.count }, (_, i) => {
        mesh.setColorAt(i, c.set(spec.colors[i % spec.colors.length]));
        return {
          ox: rng.float(-spec.spread, spec.spread),
          oy: rng.float(-0.25, 0.25),
          oz: rng.float(-spec.spread, spec.spread) * 1.6,
          lag: rng.float(0, 0.8),
          phase: rng.float(0, Math.PI * 2),
        };
      });
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      g.add(mesh);
      this.schools.push({ mesh, fish, colors: spec.colors, path: randomPath(rng, spec.reach, spec.y, spec.speed) });
    }
  }

  /** Manta-style rays gliding low over the sand: two triangular wings flapping from the center line. */
  private buildRays(g: THREE.Group, rng: Rng): void {
    const top = new THREE.MeshStandardMaterial({ color: '#3f4a55', roughness: 0.6, side: THREE.DoubleSide });
    const belly = new THREE.MeshStandardMaterial({ color: '#dfe5e8', roughness: 0.7 });
    // One wing in the XZ plane: nose, wingtip, back of the body (mirrored for the other side).
    const wingShape = (side: number) => {
      const shape = new THREE.Shape();
      shape.moveTo(0, 0.5);
      shape.quadraticCurveTo(side * 0.45, 0.35, side * 0.95, -0.05);
      shape.quadraticCurveTo(side * 0.45, -0.12, 0, -0.38);
      shape.lineTo(0, 0.5);
      // ShapeGeometry is in XY; lay it flat with the nose toward +z.
      return new THREE.ShapeGeometry(shape, 6).rotateX(-Math.PI / 2).scale(1, 1, -1);
    };
    for (let i = 0; i < 3; i++) {
      const root = new THREE.Group();
      // Dark on top; the pale belly only shows from below.
      const body = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8).scale(0.2, 0.07, 0.42), top);
      const under = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8).scale(0.18, 0.05, 0.38), belly);
      under.position.y = -0.03;
      const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.02, 0.8, 4).rotateX(Math.PI / 2).translate(0, 0, -0.75), top);
      const wings = [1, -1].map((side) => {
        const pivot = new THREE.Group();
        pivot.add(new THREE.Mesh(wingShape(side), top));
        root.add(pivot);
        return pivot;
      });
      root.add(body, under, tail);
      root.scale.setScalar(rng.float(0.9, 1.3));
      root.traverse((o) => (o.castShadow = true));
      g.add(root);
      // Spread out: each ray gets its own depth band and pace.
      this.rays.push({ root, wings, path: { ...randomPath(rng, 8.5, 0.3 + i * 0.12, 0.05 + i * 0.015), ya: 0.06 }, phase: rng.float(0, 6) });
    }
  }

  private buildTurtle(g: THREE.Group, rng: Rng): void {
    const shellMat = new THREE.MeshStandardMaterial({ color: '#6b7d3a', roughness: 0.7, flatShading: true });
    const skin = new THREE.MeshStandardMaterial({ color: '#a7a06a', roughness: 0.8 });
    const root = new THREE.Group();
    const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(0.4, 1).scale(1, 0.4, 1.25), shellMat);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8).scale(1, 0.9, 1.3), skin);
    head.position.set(0, 0.02, 0.58);
    root.add(shell, head);
    const flippers = [
      [0.36, 0.25, 0.42],
      [-0.36, 0.25, 0.42],
      [0.28, -0.32, 0.22],
      [-0.28, -0.32, 0.22],
    ].map(([x, z, len]) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, -0.02, z);
      const flipper = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6).scale(len, 0.03, len * 0.35), skin);
      flipper.position.x = Math.sign(x) * len * 0.8;
      pivot.add(flipper);
      root.add(pivot);
      return pivot;
    });
    root.traverse((o) => (o.castShadow = true));
    g.add(root);
    this.turtle = { root, flippers, path: { ...randomPath(rng, 8, 0.65, 0.05), ya: 0.25 } };
  }

  /** A small reef shark: grey back, pale belly, dorsal fin and a swaying tail. */
  private buildShark(g: THREE.Group): void {
    const grey = new THREE.MeshStandardMaterial({ color: '#7d8a94', roughness: 0.5 });
    const belly = new THREE.MeshStandardMaterial({ color: '#e4e8ea', roughness: 0.6 });
    const root = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10).scale(0.2, 0.22, 0.95), grey);
    const under = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8).scale(0.17, 0.12, 0.8), belly);
    under.position.y = -0.08;
    const dorsal = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.32, 4).scale(0.25, 1, 1), grey);
    dorsal.position.set(0, 0.26, 0.05);
    dorsal.rotation.x = -0.35;
    const fins = [1, -1].map((side) => {
      const fin = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6).scale(0.28, 0.025, 0.12), grey);
      fin.position.set(side * 0.24, -0.08, 0.25);
      fin.rotation.z = side * -0.35;
      return fin;
    });
    const tail = new THREE.Group();
    tail.position.z = -0.85;
    const upper = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.42, 4).scale(0.25, 1, 1), grey);
    upper.position.set(0, 0.18, -0.12);
    upper.rotation.x = -0.9;
    const lower = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.28, 4).scale(0.25, 1, 1), grey);
    lower.position.set(0, -0.12, -0.08);
    lower.rotation.x = -2.3;
    tail.add(upper, lower);
    root.add(body, under, dorsal, ...fins, tail);
    root.traverse((o) => (o.castShadow = true));
    g.add(root);
    this.shark = { root, tail };
  }

  /** Clear, slightly teal water with faint ripples, drawn after everything inside. */
  private buildWater(g: THREE.Group): void {
    const material = withCaustics(
      new THREE.MeshStandardMaterial({
        color: '#1fb5cf',
        roughness: 0.35,
        metalness: 0,
        transparent: true,
        opacity: 0.18,
        depthWrite: false,
      }),
      0.04,
      'water',
    );
    const water = new THREE.Mesh(new THREE.CircleGeometry(R - 0.05, 64).rotateX(-Math.PI / 2), material);
    water.position.y = SURFACE;
    water.renderOrder = 2;
    water.raycast = () => {};
    g.add(water);
  }
}
