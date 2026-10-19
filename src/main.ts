import * as THREE from 'three';
import './style.css';
import { Animal } from './animals/Animal';
import { SPECIES } from './animals/species';
import { CameraRig } from './camera';
import { DAY_SECONDS, HOUR_SECONDS, RESET_HOUR, lastReset, zooTime } from './clock';
import { Ambient } from './ambient';
import { Amenities } from './amenities';
import { fastForward } from './fastforward';
import { Flamingos } from './flamingos';
import { Lagoon } from './lagoon';
import { Enclosure } from './enclosure';
import { Feeder } from './feeder';
import { HABITATS } from './habitats';
import { DECKS, FLAMINGO_POND, LAGOON, isPath } from './layout';
import { Picker } from './picking';
import { PixelView } from './pixel/view';
import { ReverseZoo } from './reverse';
import { Rng, withSeededRandom } from './rng';
import { World } from './scene';
import { Train } from './train';
import { weatherAt, weatherNow } from './weather';
import { Hud, type GameState } from './ui/hud';
import { Inspector } from './ui/inspector';
import { Crowd } from './visitors/Crowd';
import { Keepers } from './visitors/Keepers';

const OPEN_HOUR = 9;
const CLOSE_HOUR = 18;
/** Fixed simulation step. Fixed (not per-frame) so every browser computes exactly the same zoo. */
const SIM_STEP = 1 / 60;

const app = document.getElementById('app')!;
// Scenery is procedural; seed it so everyone sees the same zoo.
const world = withSeededRandom('tiny-zoo:world', () => new World(app));
const rig = new CameraRig(world.renderer.domElement);
world.attachCamera(rig.camera);
const state: GameState = zooTime(Date.now());
/** Dev-only fast-forward on top of the real clock (see __zoo.advance). */
let clockOffsetMs = 0;
const hud = new Hud(app, state);

/** Everything that moves in the real zoo; hidden while the reverse zoo is showing. */
const live = new THREE.Group();
world.scene.add(live);
const enclosures: Enclosure[] = [];
const feeders: Feeder[] = [];
const animals: Animal[] = [];
const babies: Animal[] = [];

// Fixed seeds: same rocks, trees, names and animal sizes for everyone.
const worldRng = new Rng('tiny-zoo:animals');
for (const h of HABITATS) {
  const enclosure = withSeededRandom(
    `tiny-zoo:enclosure-textures:${h.enclosure.name}`,
    () => new Enclosure(h.enclosure, new Rng(`tiny-zoo:enclosure:${h.enclosure.name}`)),
  );
  const feeder = withSeededRandom(`tiny-zoo:feeder:${h.enclosure.name}`, () => new Feeder({ ...h.feeder, name: h.enclosure.name }));
  world.scene.add(enclosure.group, feeder.root);
  enclosures.push(enclosure);
  feeders.push(feeder);

  const species = SPECIES[h.species];
  const names = [...species.names];
  for (let i = names.length - 1; i > 0; i--) {
    const j = worldRng.int(i + 1);
    [names[i], names[j]] = [names[j], names[i]];
  }
  const adults: Animal[] = [];
  for (let i = 0; i < h.count; i++) {
    const animal = new Animal(species, names[i % names.length], i < h.males, enclosure, feeder, worldRng.fork('animal'));
    live.add(animal.root);
    adults.push(animal);
  }
  babies.push(
    ...Array.from({ length: h.babies ?? 0 }, (_, b) => {
      const mom = adults[h.males + worldRng.int(h.count - h.males)];
      const baby = new Animal(species, names[(h.count + b) % names.length], worldRng.chance(0.5), enclosure, feeder, worldRng.fork('baby'), mom);
      live.add(baby.root);
      return baby;
    }),
  );
  animals.push(...adults);
}
// Babies go last so their mothers are placed first at each reset; siblings play together.
for (const b of babies) b.siblings = babies.filter((x) => x !== b && x.enclosure === b.enclosure);
animals.push(...babies);

const lagoon = new Lagoon(LAGOON.x, LAGOON.z);
const flamingos = new Flamingos(FLAMINGO_POND.x, FLAMINGO_POND.z, FLAMINGO_POND.r, FLAMINGO_POND.fence);
const amenities = withSeededRandom('tiny-zoo:amenities', () => new Amenities());
const train = new Train();
const ambient = new Ambient();
world.scene.add(lagoon.group, flamingos.group, amenities.group, train.group, ambient.group);

withSeededRandom('tiny-zoo:plants', () =>
  world.decorate(
    // No plants on paths, along fences, or on rocks and ponds inside enclosures.
    (x, z) =>
      isPath(x, z, 0.8) ||
      enclosures.some((e) => (e.contains(x, z) ? e.icy || !e.walkable(x, z, 1) : e.occupies(x, z, 1.2))),
    (x, z) => enclosures.some((e) => e.contains(x, z)),
  ),
);

// Selection ring that follows the inspected animal.
const ring = new THREE.Mesh(
  new THREE.RingGeometry(0.85, 1, 40),
  new THREE.MeshBasicMaterial({ color: '#ffe066', transparent: true, opacity: 0.9, depthWrite: false }),
);
ring.rotation.x = -Math.PI / 2;
ring.visible = false;
world.scene.add(ring);

const inspector = new Inspector(app, {
  onClose: () => select(null),
  onFollow: (a) => rig.setFollow(rig.following === a.root ? null : a.root),
});

function select(animal: Animal | null): void {
  if (animal) {
    inspector.show(animal);
    ring.visible = true;
    ring.scale.setScalar(animal.radius * 1.4);
  } else {
    inspector.hide();
    ring.visible = false;
    rig.setFollow(null);
  }
}

new Picker(
  world.renderer.domElement,
  rig.camera,
  // Only animals are clickable: inspecting is local, while anything that changed the zoo would desync it.
  () => (reverse.active ? [] : animals.map((a) => a.root)),
  (pick) => select(pick?.kind === 'animal' ? pick.animal : null),
);

const keepers = new Keepers(
  live,
  feeders.map((feeder, i) => ({ feeder, enclosure: HABITATS[i].enclosure.name })),
);
const crowd = new Crowd(live, { animals, feedingAt: (name) => keepers.feedingAt(name) !== null });
for (const e of enclosures) e.animalSpots = DECKS.find((d) => d.enclosure === e.name)?.animalSpots ?? [];
const reverse = new ReverseZoo(world.scene, enclosures);

// 2D pixel-art view of the same simulation (P switches between it and 3D).
const pixel = new PixelView(app, {
  animals,
  crowd,
  keepers,
  enclosures,
  feeders,
  flamingos,
  lagoon,
  train,
  state,
  weather: weatherNow,
  following: () => rig.following,
  stopFollow: () => rig.setFollow(null),
  selected: () => inspector.selected,
  onPick: (animal) => select(animal),
});
const VIEW_KEY = 'tiny-zoo:view';
let pixelMode = true;
try {
  pixelMode = localStorage.getItem(VIEW_KEY) !== '3d';
} catch {
  // Storage blocked: keep the default.
}
function applyView(): void {
  world.renderer.domElement.style.display = pixelMode ? 'none' : '';
  world.labelRenderer.domElement.style.display = pixelMode ? 'none' : '';
  pixel.setVisible(pixelMode);
}
applyView();

/**
 * Reverse zoo: hovering the bottom-right corner flips the zoo (people in the
 * fences, animals visiting) behind a circular wipe; leaving the corner flips back.
 */
const CORNER = 90;
const iris = document.createElement('div');
iris.className = 'iris';
const cornerHint = document.createElement('div');
cornerHint.className = 'corner-hint';
cornerHint.textContent = '🐾';
app.append(iris, cornerHint);
let wantReverse = false;
let flipping = false;

/** Wipe durations; must match .iris.closing / .iris.opening in style.css. */
const WIPE_CLOSE_MS = 320;
const WIPE_OPEN_MS = 380;

function flip(): void {
  if (flipping || reverse.active === wantReverse) return;
  flipping = true;
  iris.className = 'iris closing';
  // Timers rather than animationend, which never fires if CSS animations are paused or disabled.
  setTimeout(() => {
    reverse.active = wantReverse;
    live.visible = !wantReverse;
    if (wantReverse) select(null);
    iris.className = 'iris opening';
    setTimeout(() => {
      iris.className = 'iris';
      flipping = false;
      flip(); // the pointer may have moved again meanwhile
    }, WIPE_OPEN_MS);
  }, WIPE_CLOSE_MS);
}

window.addEventListener('pointermove', (e) => {
  const inCorner = e.clientX > window.innerWidth - CORNER && e.clientY > window.innerHeight - CORNER;
  cornerHint.classList.toggle('active', inCorner);
  if (inCorner !== wantReverse) {
    wantReverse = inCorner;
    flip();
  }
});
document.documentElement.addEventListener('pointerleave', () => {
  wantReverse = false;
  cornerHint.classList.remove('active');
  flip();
});

/** Keep animals from standing inside each other. */
function separate(): void {
  for (let i = 0; i < animals.length; i++) {
    for (let j = i + 1; j < animals.length; j++) {
      const a = animals[i];
      const b = animals[j];
      if (a.enclosure !== b.enclosure || a.offGround || b.offGround) continue;
      const dx = b.position.x - a.position.x;
      const dz = b.position.z - a.position.z;
      const d = Math.hypot(dx, dz);
      const min = (a.radius + b.radius) * 0.8;
      if (d >= min || d < 1e-4) continue;
      const push = min - d;
      const nx = dx / d;
      const nz = dz / d;
      // Sleeping animals stay put; the awake one moves around them.
      const wa = a.state === 'sleep' ? 0 : b.state === 'sleep' ? 1 : 0.5;
      const wb = 1 - wa;
      a.nudge(-nx * push * wa, -nz * push * wa);
      b.nudge(nx * push * wb, nz * push * wb);
    }
  }
}

const isOpen = (hour: number) => hour >= OPEN_HOUR && hour < CLOSE_HOUR;

/**
 * Shared simulation. Each night at RESET_HOUR the zoo returns to a state
 * every browser agrees on (seeded by the reset number), then runs in fixed
 * steps. A browser opening the page fast-forwards from the last reset to now,
 * so everyone sees the same animals and visitors doing the same things.
 */
let simReset = Number.NaN;
let simSteps = 0;

/** Zoo hour at the current simulation step. */
const simHour = () => (RESET_HOUR + (simSteps * SIM_STEP) / HOUR_SECONDS) % 24;

function resetSimulation(index: number): void {
  const seed = (name: string) => new Rng(`tiny-zoo:reset ${index}:${name}`);
  for (const e of enclosures) {
    e.takenSpots.clear();
    e.baskTaken.clear();
    e.gym?.occupants.fill(0);
  }
  animals.forEach((a, i) => a.reset(seed(`animal ${i}`)));
  for (const f of feeders) f.refill();
  crowd.reset(seed('crowd'));
  keepers.reset(seed('keepers'));
  simReset = index;
  simSteps = 0;
}

/** Bring the simulation up to real time `nowMs`, resetting first if a 4:00 reset has passed. */
function catchUp(nowMs: number): void {
  const { index, startMs } = lastReset(nowMs);
  const target = Math.floor((nowMs - startMs) / 1000 / SIM_STEP);
  if (index !== simReset || target < simSteps) resetSimulation(index);
  // Far behind (page just opened, or the tab was in the background): skip visual work until nearly caught up.
  while (simSteps < target) {
    fastForward.on = target - simSteps > 30;
    step(SIM_STEP, simHour());
    simSteps++;
  }
  fastForward.on = false;
  const hour = simHour();
  if (isOpen(hour) !== isOpen(state.hour)) {
    hud.toast(isOpen(hour) ? 'The zoo is open! 🎟️' : 'The zoo is closed for the night', isOpen(hour) ? 'good' : 'info');
  }
  state.hour = hour;
  state.day = zooTime(nowMs).day;
}

function step(dt: number, hour: number): void {
  weatherAt(zooDay(), hour);
  for (const e of enclosures) e.feedingNow = keepers.feedingAt(e.name) !== null;
  for (const a of animals) a.update(dt, hour);
  crowd.update(dt, hour);
  keepers.update(dt);
  reverse.update(dt);
  separate();
}

/**
 * Automatic quality: if the real frame rate stays low, step the graphics down
 * (resolution, then ambient occlusion, then post-processing); step back up
 * after a good while of smooth frames. Pressing G takes manual control.
 */
let quality = 0;
let autoQuality = true;
let fpsWindow = 0;
let fpsFrames = 0;
let goodWindows = 0;
function watchFrameRate(realDt: number): void {
  if (!autoQuality || document.hidden || realDt > 0.25) return; // ignore background tabs and hiccups
  fpsWindow += realDt;
  fpsFrames++;
  if (fpsWindow < 3) return;
  const fps = fpsFrames / fpsWindow;
  fpsWindow = 0;
  fpsFrames = 0;
  if (fps < 45 && quality < 3) {
    world.setQuality(++quality);
    goodWindows = 0;
  } else if (fps > 57 && quality > 0 && ++goodWindows >= 4) {
    world.setQuality(--quality);
    goodWindows = 0;
  }
}

window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyP') {
    pixelMode = !pixelMode;
    try {
      localStorage.setItem(VIEW_KEY, pixelMode ? '2d' : '3d');
    } catch {
      // Storage blocked: the choice lasts until reload.
    }
    applyView();
    hud.toast(pixelMode ? '2D view' : '3D view');
    return;
  }
  if (e.code !== 'KeyG') return;
  autoQuality = false;
  quality = quality === 3 ? 0 : 3;
  world.setQuality(quality);
  hud.toast(quality === 0 ? 'Graphics: high' : 'Graphics: fast');
});

window.addEventListener('resize', () => {
  world.resize();
  rig.resize();
});

hud.toast('Welcome! Click an animal to see how it’s doing.', 'good');

/** The zoo day the simulation is on (the day of its last 4:00 reset, plus one after midnight). */
const zooDay = () => simReset + (simHour() < RESET_HOUR ? 1 : 0);

/** Shared zoo time in seconds, continuous across days (drives the lagoon's fish and other ambient life). */
const zooSeconds = () => ((simReset % 1000) + 1000) % 1000 * DAY_SECONDS + simSteps * SIM_STEP;

function frame(dt: number): void {
  for (const f of feeders) f.syncVisuals();
  lagoon.update(zooSeconds());
  flamingos.update(zooSeconds(), state.hour);
  amenities.update(crowd.swingRiders(), zooSeconds());
  train.update(zooSeconds(), state.hour);
  ambient.update(zooSeconds(), state.hour, weatherNow, rig.focus);
  const selected = inspector.selected;
  if (selected) {
    ring.position.set(selected.position.x, 0.05, selected.position.z);
    inspector.update(rig.following === selected.root);
  }
  hud.update();

  if (pixelMode) {
    pixel.render(dt);
    return;
  }
  world.setTimeOfDay(state.hour, weatherNow);
  rig.update(dt);
  world.render(rig.camera);
}

const timer = new THREE.Timer();
world.renderer.setAnimationLoop((time) => {
  timer.update(time);
  const realDt = timer.getDelta();
  const dt = Math.min(realDt, 0.1);
  watchFrameRate(realDt);
  // Usually one step per frame; after a backgrounded tab, a fast-forward to now.
  catchUp(Date.now() + clockOffsetMs);
  frame(dt);
});

// Dev-only console hook: __zoo.advance(60) fast-forwards 60 seconds (clock included) and draws one frame.
if (import.meta.env.DEV) {
  Object.assign(window, {
    __zoo: {
      state,
      animals,
      feeders,
      crowd,
      keepers,
      reverse,
      world,
      pixel,
      rig,
      isPath,
      weatherAt,
      weatherNow,
      focus(name: string) {
        const a = animals.find((x) => x.name === name);
        if (a) {
          select(a);
          rig.setFollow(a.root);
        }
      },
      advance(seconds: number) {
        clockOffsetMs += seconds * 1000;
        catchUp(Date.now() + clockOffsetMs);
        frame(SIM_STEP);
      },
      /** Where the shared simulation is: reset number and step count since it. */
      get sim() {
        return { reset: simReset, steps: simSteps, hour: simHour() };
      },
      /** A hash of everything that should match across browsers. */
      fingerprint(): string {
        const parts: number[] = [simReset, simSteps];
        for (const a of animals) parts.push(a.position.x, a.position.z, a.hunger, a.energy, a.happiness);
        for (const f of feeders) parts.push(f.stock);
        for (const v of [...crowd.visitors, ...keepers.active]) parts.push(v.position.x, v.position.z);
        const text = parts.join(',') + animals.map((a) => a.state).join(',');
        let h = 2166136261;
        for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
        return `${(h >>> 0).toString(16)} (${crowd.visitors.length} guests, ${keepers.active.length} keepers)`;
      },
      /** Jump the dev clock to `steps` after reset `index`; the live loop carries on from there. */
      goto(index: number, steps: number): void {
        const start = lastReset(Date.now()).startMs + (index - lastReset(Date.now()).index) * DAY_SECONDS * 1000;
        clockOffsetMs = start + steps * SIM_STEP * 1000 - Date.now();
        catchUp(Date.now() + clockOffsetMs);
        frame(SIM_STEP);
      },
      /** Run `count` more simulation steps from the current state (no reset). */
      steps(count: number): void {
        for (let i = 0; i < count; i++) {
          step(SIM_STEP, simHour());
          simSteps++;
        }
      },
      /** Re-run reset `index` for `steps` steps from scratch and return the fingerprint. */
      replay(index: number, steps: number, fast = true): string {
        resetSimulation(index);
        while (simSteps < steps) {
          fastForward.on = fast && steps - simSteps > 30;
          step(SIM_STEP, simHour());
          simSteps++;
        }
        fastForward.on = false;
        return this.fingerprint();
      },
    },
  });
}
