import * as THREE from 'three';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { cobbleTexture, plankTexture, repeated } from './materials';
import { mergeStatic } from './merge';
import { BENCHES, DECKS, GATE_Z, LAMPS, PATH_RECTS, PLAZA, STAFF_HUT, isPath } from './layout';
import { NO_AO_LAYER, PostFX } from './post';
import type { WeatherState } from './weather';

const SKY_TOP_DAY = new THREE.Color('#5aa9e6');
const SKY_HORIZON_DAY = new THREE.Color('#cfe9f7');
const SKY_TOP_NIGHT = new THREE.Color('#060b1f');
const SKY_HORIZON_NIGHT = new THREE.Color('#25345e');
const SKY_DUSK = new THREE.Color('#f59a62');
const SUN_DAY = new THREE.Color('#fff2dc');
const OVERCAST_TOP = new THREE.Color('#8d9aa6');
const OVERCAST_HORIZON = new THREE.Color('#c4ccd2');
const WET = new THREE.Color('#8a8f99');
const DRY = new THREE.Color('#ffffff');

/** Path materials, darkened and made glossy when it rains. */
const pathMaterials: THREE.MeshStandardMaterial[] = [];
const SUN_LOW = new THREE.Color('#ffa364');

/** Merges geometries, converting to non-indexed first so mixed types are compatible. */
function merge(...geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  return mergeGeometries(geos.map((g) => (g.index ? g.toNonIndexed() : g)))!;
}

/** Center of the zoo; terrain is flat within FLAT_RADIUS of it. */
const ZOO_CENTER_Z = -15;
/** Radius of the flat ground the zoo is built on; hills rise beyond it. */
const FLAT_RADIUS = 125;

export function terrainHeight(x: number, z: number): number {
  const r = Math.hypot(x, z - ZOO_CENTER_Z);
  const t = THREE.MathUtils.smoothstep(r, FLAT_RADIUS, FLAT_RADIUS + 85);
  if (t === 0) return 0;
  const n = 5 + 4 * Math.sin(x * 0.04) * Math.cos(z * 0.035) + 6 * Math.sin(x * 0.013 + z * 0.017 + 1.3);
  return t * Math.max(0.5, n) * 1.4;
}

/** Renderer, lights, sky, terrain, scenery and the day/night cycle. */
export class World {
  readonly scene = new THREE.Scene();
  readonly renderer: THREE.WebGLRenderer;
  readonly labelRenderer = new CSS2DRenderer();
  readonly sun = new THREE.DirectionalLight(SUN_DAY, 2.6);
  readonly hemi = new THREE.HemisphereLight('#d6ecff', '#6b7a45', 1);
  /** Cool fill light so the zoo stays readable at night. */
  readonly moon = new THREE.DirectionalLight('#9db4ff', 0);
  /** Post-processing on/off (G key, or automatic quality). */
  postEnabled = true;
  /** Render scale for post-processing; automatic quality lowers it on slower machines. */
  postScale = 1.5;

  private readonly fog = new THREE.Fog(SKY_HORIZON_DAY, 230, 560);
  private readonly sky = new SkyDome();
  private readonly lampBulbs = new THREE.MeshStandardMaterial({
    color: '#fff3d0',
    emissive: '#ffc86b',
    emissiveIntensity: 0,
  });
  private readonly lampLights: THREE.PointLight[] = [];
  private post: PostFX | null = null;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // Shadows are redrawn every other frame (see render): halves their cost, and a one-frame lag isn't visible.
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    const labels = this.labelRenderer.domElement;
    labels.style.position = 'absolute';
    labels.style.inset = '0';
    labels.style.pointerEvents = 'none';
    // Own stacking context, so label z-indexes never cover the HUD.
    labels.style.zIndex = '0';
    container.appendChild(labels);

    this.scene.fog = this.fog;
    this.scene.add(this.sky.group);

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    const cam = this.sun.shadow.camera;
    cam.left = cam.bottom = -125;
    cam.right = cam.top = 125;
    cam.near = 1;
    cam.far = 340;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.radius = 3;
    this.sun.target.position.set(0, 0, ZOO_CENTER_Z);
    this.moon.position.set(-60, 120, -40);
    this.scene.add(this.sun, this.sun.target, this.hemi, this.moon);

    this.scene.add(
      createGround(),
      mergeStatic(createPaths()),
      mergeStatic(createGate()),
      mergeStatic(createStaffHut()),
      createForest(),
    );
    this.addLampsAndBenches();
  }

  /**
   * Quality level: 0 = everything, 1 = slightly lower resolution,
   * 2 = no ambient occlusion, 3 = no post-processing ("fast").
   */
  setQuality(level: number): void {
    this.postEnabled = level < 3;
    this.postScale = level === 0 ? 1.5 : 1.2;
    this.post?.setAO(level < 2);
    this.resize();
  }

  /** Must be called once the camera exists; sets up post-processing. */
  attachCamera(camera: THREE.PerspectiveCamera): void {
    camera.layers.enable(NO_AO_LAYER);
    this.post = new PostFX(this.renderer, this.scene, camera);
    this.resize();
  }

  /**
   * Grass, flowers and bushes. `blocked` says where not to put them
   * (paths, fences); `inside` says which spots are inside an enclosure.
   */
  decorate(blocked: (x: number, z: number) => boolean, inside: (x: number, z: number) => boolean): void {
    this.scene.add(createVegetation(blocked, inside));
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    // Post-processing is costly on retina screens; 1.5× is a good balance.
    const ratio = Math.min(window.devicePixelRatio, this.postEnabled ? this.postScale : 2);
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(w, h);
    this.labelRenderer.setSize(w, h);
    this.post?.setSize(w, h, ratio);
  }

  /** hour in [0, 24). Sunrise at 6, sunset at 18. */
  setTimeOfDay(hour: number, weather?: WeatherState): void {
    const cloud = weather?.cloud ?? 0;
    const rain = weather?.rain ?? 0;
    const fog = weather?.fog ?? 0;
    const wet = weather?.wet ?? 0;
    const angle = ((hour - 6) / 12) * Math.PI;
    const elevation = Math.sin(angle);
    const daylight = THREE.MathUtils.smoothstep(elevation, -0.12, 0.3);
    const dusk = Math.exp(-(elevation * elevation) / 0.03) * 0.75;

    const t = this.sun.target.position;
    this.sun.position.set(
      t.x + Math.cos(angle) * 140,
      t.y + Math.max(elevation, 0.18) * 140,
      t.z + 60,
    );
    // Clouds dim and soften the sun.
    this.sun.intensity = 2.8 * daylight * (1 - 0.85 * cloud) * (1 - 0.5 * rain);
    this.sun.color.copy(SUN_LOW).lerp(SUN_DAY, THREE.MathUtils.clamp(elevation * 2, 0, 1));

    this.hemi.intensity = (0.6 + 0.6 * daylight) * (1 - 0.1 * cloud) * (1 - 0.15 * rain);
    this.hemi.color.set('#6f87d6').lerp(new THREE.Color('#d6ecff'), daylight);
    this.moon.intensity = 0.9 * (1 - daylight);

    const top = this.sky.top.copy(SKY_TOP_NIGHT).lerp(SKY_TOP_DAY, daylight);
    const horizon = this.sky.horizon.copy(SKY_HORIZON_NIGHT).lerp(SKY_HORIZON_DAY, daylight).lerp(SKY_DUSK, dusk);
    top.lerp(SKY_DUSK, dusk * 0.25);
    // Overcast: a flat grey sky (only by day; nights stay dark).
    top.lerp(OVERCAST_TOP, cloud * 0.75 * daylight);
    horizon.lerp(OVERCAST_HORIZON, cloud * 0.7 * daylight);
    this.sky.setStars((1 - daylight) * (1 - cloud));
    this.fog.color.copy(horizon);
    // Fog closes in; rain shortens the view a little too.
    this.fog.near = 230 * (1 - 0.85 * fog) - rain * 70;
    this.fog.far = 560 * (1 - 0.72 * fog) - rain * 150;
    for (const m of pathMaterials) {
      m.color.copy(DRY).lerp(WET, wet * 0.55);
      m.roughness = 0.95 - wet * 0.6;
    }

    const night = 1 - THREE.MathUtils.smoothstep(elevation, -0.05, 0.15);
    this.lampBulbs.emissiveIntensity = night * 3;
    for (const l of this.lampLights) l.intensity = night * 40;
  }

  private frameCount = 0;

  render(camera: THREE.Camera): void {
    this.sky.group.position.copy(camera.position);
    if (this.frameCount++ % 2 === 0) this.renderer.shadowMap.needsUpdate = true;
    if (this.post && this.postEnabled) this.post.render();
    else this.renderer.render(this.scene, camera);
    this.labelRenderer.render(this.scene, camera);
  }

  private addLampsAndBenches(): void {
    const furniture = new THREE.Group();
    const postMat = new THREE.MeshStandardMaterial({ color: '#2f3336', roughness: 0.5, metalness: 0.4 });
    const wood = new THREE.MeshStandardMaterial({ color: '#8a5a36', roughness: 0.9 });
    const iron = new THREE.MeshStandardMaterial({ color: '#2d2d2d', roughness: 0.6 });
    LAMPS.forEach(([x, z], i) => {
      const lamp = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 3.6, 8), postMat);
      pole.position.y = 1.8;
      const head = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.12, 0.25, 8), postMat);
      head.position.y = 3.75;
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8), this.lampBulbs);
      bulb.position.y = 3.5;
      pole.castShadow = head.castShadow = true;
      lamp.add(pole, head, bulb);
      lamp.position.set(x, 0, z);
      furniture.add(lamp);
      // A handful of real lights; the rest just glow.
      if (i % 2 === 0 && Math.abs(x) < 12) {
        const light = new THREE.PointLight('#ffc77a', 0, 16, 1.8);
        light.position.set(x, 3.3, z);
        this.lampLights.push(light);
        this.scene.add(light);
      }
    });

    for (const { x, z, side } of BENCHES) {
      const bench = new THREE.Group();
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 1.8), wood);
      seat.position.y = 0.48;
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.45, 1.8), wood);
      back.position.set(side * 0.24, 0.78, 0);
      bench.add(seat, back);
      for (const lz of [-0.75, 0.75]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.48, 0.07), iron);
        leg.position.set(0, 0.24, lz);
        bench.add(leg);
      }
      bench.traverse((o) => (o.castShadow = true));
      bench.position.set(x, 0, z);
      furniture.add(bench);
    }
    this.scene.add(mergeStatic(furniture));
  }
}

/** Gradient sky sphere with stars; follows the camera. */
class SkyDome {
  readonly group = new THREE.Group();
  readonly top = new THREE.Color();
  readonly horizon = new THREE.Color();
  private readonly starMat = new THREE.PointsMaterial({
    color: '#ffffff',
    size: 2,
    sizeAttenuation: false,
    transparent: true,
    opacity: 0,
    fog: false,
    depthWrite: false,
  });

  constructor() {
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(800, 32, 16),
      new THREE.ShaderMaterial({
        uniforms: { top: { value: this.top }, horizon: { value: this.horizon } },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 top;
          uniform vec3 horizon;
          varying vec3 vDir;
          void main() {
            float h = max(vDir.y, 0.0);
            gl_FragColor = vec4(mix(horizon, top, pow(h, 0.55)), 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      }),
    );
    dome.renderOrder = -1;
    dome.frustumCulled = false;

    const positions: number[] = [];
    for (let i = 0; i < 900; i++) {
      const u = Math.random() * Math.PI * 2;
      const v = Math.acos(Math.random() * 0.95);
      positions.push(Math.sin(v) * Math.cos(u) * 700, Math.cos(v) * 700, Math.sin(v) * Math.sin(u) * 700);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const stars = new THREE.Points(starGeo, this.starMat);
    stars.frustumCulled = false;
    this.group.add(dome, stars);
  }

  setStars(level: number): void {
    this.starMat.opacity = level * 0.9;
    this.starMat.visible = level > 0.02;
  }
}

function createGround(): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(640, 640, 160, 160);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors: number[] = [];
  const grass = new THREE.Color('#78a84a');
  const hill = new THREE.Color('#9bb85a');
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = terrainHeight(x, z);
    pos.setY(i, y);
    const n = Math.sin(x * 0.11) * Math.cos(z * 0.13) + Math.sin(x * 0.031 + z * 0.047) * 0.8;
    c.copy(grass).lerp(hill, THREE.MathUtils.clamp(y / 18, 0, 1));
    c.offsetHSL(n * 0.012, 0, n * 0.035 + (Math.random() - 0.5) * 0.025);
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  mesh.receiveShadow = true;
  return mesh;
}

function pathMaterial(map: THREE.Texture): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ map, roughness: 0.95 });
  pathMaterials.push(m);
  return m;
}

function createPaths(): THREE.Group {
  const group = new THREE.Group();
  const tex = cobbleTexture();
  const curbMat = new THREE.MeshStandardMaterial({ color: '#8d8473', roughness: 1 });
  for (const [x, z, w, d] of PATH_RECTS) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, d),
      pathMaterial(repeated(tex, w / 5, d / 5)),
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.012, z);
    m.receiveShadow = true;
    group.add(m);
  }
  const plaza = new THREE.Mesh(
    new THREE.CircleGeometry(PLAZA.r, 48),
    pathMaterial(repeated(tex, 3.6, 3.6)),
  );
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.set(PLAZA.x, 0.016, PLAZA.z);
  plaza.receiveShadow = true;
  // Round planter with a little tree in the middle of the plaza.
  const planter = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.4, 0.6, 24), curbMat);
  planter.position.set(PLAZA.x, 0.3, PLAZA.z);
  const soil = new THREE.Mesh(
    new THREE.CircleGeometry(2.0, 24),
    new THREE.MeshStandardMaterial({ color: '#5b8a3a', roughness: 1 }),
  );
  soil.rotation.x = -Math.PI / 2;
  soil.position.set(PLAZA.x, 0.61, PLAZA.z);
  const tree = roundTree(1.1);
  tree.position.set(PLAZA.x, 0.6, PLAZA.z);
  planter.castShadow = planter.receiveShadow = true;
  group.add(plaza, planter, soil, tree);

  // Wooden viewing decks reaching from the path to each enclosure fence.
  const plankMat = new THREE.MeshStandardMaterial({ map: plankTexture(), roughness: 0.85 });
  const postMat = new THREE.MeshStandardMaterial({ color: '#5e3d22', roughness: 0.9 });
  for (const k of DECKS) {
    const deck = new THREE.Mesh(new THREE.BoxGeometry(k.w, 0.16, k.d), plankMat);
    deck.position.set(k.x, 0.08, k.z);
    deck.castShadow = deck.receiveShadow = true;
    group.add(deck);
    for (const [cx, cz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.5, 6), postMat);
      post.position.set(k.x + cx * (k.w / 2 - 0.15), 0.25, k.z + cz * (k.d / 2 - 0.15));
      post.castShadow = true;
      group.add(post);
    }
  }
  return group;
}

function roundTree(scale: number): THREE.Group {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.28, 2.6, 7),
    new THREE.MeshStandardMaterial({ color: '#6e4b2e', roughness: 1 }),
  );
  trunk.position.y = 1.3;
  const leaves = new THREE.MeshStandardMaterial({ color: '#5c9a3e', flatShading: true, roughness: 0.9 });
  g.add(trunk);
  for (const [x, y, z, r] of [[0, 3.2, 0, 1.4], [0.7, 2.8, 0.3, 1], [-0.6, 2.9, -0.3, 1.05]]) {
    const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), leaves);
    crown.position.set(x, y, z);
    g.add(crown);
  }
  g.scale.setScalar(scale);
  g.traverse((o) => (o.castShadow = true));
  return g;
}

/** Wooden entrance arch with a sign, where the avenue meets the boulevard. */
function createGate(): THREE.Group {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: '#7a4f2c', roughness: 0.9 });
  const roof = new THREE.MeshStandardMaterial({ color: '#3f6e3a', roughness: 0.8, flatShading: true });
  for (const x of [-5.8, 5.8]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.7, 6, 0.7), wood);
    post.position.set(x, 3, 0);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.75, 0.9, 4), roof);
    cap.position.set(x, 6.45, 0);
    cap.rotation.y = Math.PI / 4;
    g.add(post, cap);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(13, 0.5, 0.5), wood);
  beam.position.y = 5.3;

  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#f4e3b5';
  ctx.beginPath();
  ctx.roundRect(4, 4, 504, 120, 24);
  ctx.fill();
  ctx.lineWidth = 8;
  ctx.strokeStyle = '#5a3a1e';
  ctx.stroke();
  ctx.fillStyle = '#4a3016';
  ctx.font = 'bold 76px ui-rounded, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('TINY ZOO', 256, 68);
  const signTex = new THREE.CanvasTexture(canvas);
  signTex.colorSpace = THREE.SRGBColorSpace;
  signTex.anisotropy = 4;
  const sign = new THREE.Mesh(
    new THREE.BoxGeometry(7, 1.75, 0.2),
    [wood, wood, wood, wood, new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.8 }), wood],
  );
  sign.position.set(0, 4.3, 0.2);
  g.add(beam, sign);
  g.traverse((o) => (o.castShadow = true));
  g.position.set(0, 0, GATE_Z);
  return g;
}

/** Small wooden keepers' hut; the door faces the avenue (-x). */
function createStaffHut(): THREE.Group {
  const g = new THREE.Group();
  const { w, d } = STAFF_HUT;
  const walls = new THREE.Mesh(
    new THREE.BoxGeometry(w, 2.4, d),
    new THREE.MeshStandardMaterial({ map: repeated(plankTexture(), 1, 1.5), color: '#c9b08a', roughness: 0.9 }),
  );
  walls.position.y = 1.2;
  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(Math.hypot(w, d) / 2 + 0.4, 1.4, 4),
    new THREE.MeshStandardMaterial({ color: '#3f6e3a', roughness: 0.8, flatShading: true }),
  );
  roof.position.y = 3.1;
  roof.rotation.y = Math.PI / 4;
  roof.scale.set(1, 1, d / w);
  const door = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 1.8, 1),
    new THREE.MeshStandardMaterial({ color: '#5a3a1e', roughness: 0.9 }),
  );
  door.position.set(-w / 2 - 0.03, 0.9, 0);
  const window_ = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, 0.6, 0.8),
    new THREE.MeshStandardMaterial({ color: '#9fd3ea', roughness: 0.2 }),
  );
  window_.position.set(0, 1.5, d / 2 + 0.02);
  window_.rotation.y = Math.PI / 2;
  for (const m of [walls, roof, door, window_]) m.castShadow = m.receiveShadow = true;
  g.add(walls, roof, door, window_);
  g.position.set(STAFF_HUT.x, 0, STAFF_HUT.z);
  return g;
}

/** Instanced pines and round trees on the hills around the zoo. */
function createForest(): THREE.Group {
  const pineGeo = merge(
    new THREE.CylinderGeometry(0.3, 0.45, 2.4, 6).translate(0, 1.2, 0),
    new THREE.ConeGeometry(2.6, 3.6, 8).translate(0, 3.6, 0),
    new THREE.ConeGeometry(2.0, 3.0, 8).translate(0, 5.4, 0),
    new THREE.ConeGeometry(1.3, 2.4, 8).translate(0, 7.0, 0),
  );
  const roundGeo = merge(
    new THREE.CylinderGeometry(0.3, 0.45, 3, 6).translate(0, 1.5, 0),
    new THREE.IcosahedronGeometry(2.3, 1).translate(0, 4.4, 0),
    new THREE.IcosahedronGeometry(1.6, 1).translate(1.3, 3.8, 0.4),
  );
  // Color the trunk part brown and the rest green, via vertex colors by height.
  for (const geo of [pineGeo, roundGeo]) {
    const pos = geo.attributes.position;
    const colors: number[] = [];
    for (let i = 0; i < pos.count; i++) {
      const trunk = pos.getY(i) < 1.9 && Math.hypot(pos.getX(i), pos.getZ(i)) < 0.5;
      colors.push(...(trunk ? [0.42, 0.27, 0.16] : [1, 1, 1]));
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  }
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 });
  const count = 320;
  const pines = new THREE.InstancedMesh(pineGeo, mat, count);
  const rounds = new THREE.InstancedMesh(roundGeo, mat, count);
  // The forest stands outside the shadow area and adds little to ambient occlusion: skip both.
  pines.receiveShadow = rounds.receiveShadow = true;
  pines.layers.set(NO_AO_LAYER);
  rounds.layers.set(NO_AO_LAYER);

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const c = new THREE.Color();
  let ip = 0;
  let ir = 0;
  for (let i = 0; i < count * 2; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = FLAT_RADIUS + 10 + Math.pow(Math.random(), 0.7) * 190;
    const x = Math.cos(a) * r;
    const z = ZOO_CENTER_Z + Math.sin(a) * r;
    if (isPath(x, z, 4)) continue;
    p.set(x, terrainHeight(x, z) - 0.2, z);
    q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, Math.random() * Math.PI * 2);
    s.setScalar(0.75 + Math.random() * 0.8);
    m.compose(p, q, s);
    const pine = Math.random() < 0.55;
    if (pine && ip < count) {
      pines.setMatrixAt(ip, m);
      pines.setColorAt(ip++, c.set('#3d7a45').offsetHSL((Math.random() - 0.5) * 0.04, 0, (Math.random() - 0.5) * 0.1));
    } else if (!pine && ir < count) {
      rounds.setMatrixAt(ir, m);
      rounds.setColorAt(ir++, c.set('#62a043').offsetHSL((Math.random() - 0.5) * 0.06, 0, (Math.random() - 0.5) * 0.12));
    }
  }
  pines.count = ip;
  rounds.count = ir;
  const group = new THREE.Group();
  group.add(pines, rounds);
  return group;
}

/** Grass tufts, flowers and bushes around the paths and inside enclosures. */
function createVegetation(
  blocked: (x: number, z: number) => boolean,
  inside: (x: number, z: number) => boolean,
): THREE.Group {
  const group = new THREE.Group();
  const blade = (angle: number, tilt: number) =>
    new THREE.ConeGeometry(0.06, 0.55, 3, 1, true).translate(0, 0.27, 0).rotateZ(tilt).rotateY(angle);
  const tuftGeo = merge(blade(0, 0.25), blade(2.1, 0.3), blade(4.2, 0.2), blade(1, 0));
  const tuftMat = new THREE.MeshStandardMaterial({ roughness: 1 });

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const c = new THREE.Color();
  const random = (radius: number) => {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * radius;
    return [Math.cos(a) * r, ZOO_CENTER_Z + Math.sin(a) * r];
  };

  const tufts = new THREE.InstancedMesh(tuftGeo, tuftMat, 14000);
  let n = 0;
  for (let i = 0; i < 50000 && n < tufts.count; i++) {
    const [x, z] = random(FLAT_RADIUS + 5);
    if (blocked(x, z)) continue;
    const dry = inside(x, z);
    if (dry && Math.random() < 0.6) continue;
    p.set(x, terrainHeight(x, z), z);
    q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, Math.random() * Math.PI * 2);
    s.set(1, (dry ? 1.3 : 0.8) + Math.random() * 0.7, 1);
    m.compose(p, q, s);
    tufts.setMatrixAt(n, m);
    if (dry) c.set('#b5a75c').offsetHSL((Math.random() - 0.5) * 0.04, 0, (Math.random() - 0.5) * 0.12);
    else c.set('#6f9f40').offsetHSL((Math.random() - 0.5) * 0.05, 0, (Math.random() - 0.5) * 0.12);
    tufts.setColorAt(n++, c);
  }
  tufts.count = n;
  tufts.receiveShadow = true;
  // Thousands of tiny blades add nothing to ambient occlusion but cost a lot to draw there.
  tufts.layers.set(NO_AO_LAYER);

  const flowers = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(0.12, 0).translate(0, 0.3, 0),
    new THREE.MeshStandardMaterial({ roughness: 0.7 }),
    1200,
  );
  const petals = ['#ffffff', '#ffd84d', '#ff8fb1', '#c18bff', '#ff7a59'];
  n = 0;
  for (let i = 0; i < 6000 && n < flowers.count; i++) {
    const [x, z] = random(FLAT_RADIUS);
    if (blocked(x, z) || inside(x, z)) continue;
    // Flowers grow in patches near the paths.
    if (!isPath(x, z, 10) && Math.random() < 0.85) continue;
    p.set(x, 0, z);
    s.setScalar(0.7 + Math.random() * 0.6);
    m.compose(p, q.identity(), s);
    flowers.setMatrixAt(n, m);
    flowers.setColorAt(n++, c.set(petals[Math.floor(Math.random() * petals.length)]));
  }
  flowers.count = n;
  flowers.layers.set(NO_AO_LAYER);

  const bushes = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(1, 1),
    new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.9 }),
    260,
  );
  n = 0;
  for (let i = 0; i < 6000 && n < bushes.count; i++) {
    const [x, z] = random(FLAT_RADIUS);
    if (blocked(x, z) || inside(x, z)) continue;
    // Bushes line the paths and fences.
    if (!isPath(x, z, 3.5) && Math.random() < 0.985) continue;
    const r = 0.6 + Math.random() * 0.8;
    p.set(x, r * 0.45, z);
    q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, Math.random() * Math.PI);
    s.set(r * (1 + Math.random() * 0.4), r * 0.8, r);
    m.compose(p, q, s);
    bushes.setMatrixAt(n, m);
    bushes.setColorAt(n++, c.set('#4f8a37').offsetHSL((Math.random() - 0.5) * 0.05, 0, (Math.random() - 0.5) * 0.12));
  }
  bushes.count = n;
  bushes.castShadow = bushes.receiveShadow = true;
  bushes.layers.set(NO_AO_LAYER);

  group.add(tufts, flowers, bushes);
  return group;
}
