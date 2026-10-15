import * as THREE from 'three';
import './style.css';
import { Animal } from './animals/Animal';
import { SPECIES, type SpeciesId } from './animals/species';
import { CameraRig } from './camera';
import { zooTime } from './clock';
import { Enclosure, type EnclosureDef } from './enclosure';
import { Feeder, type FeederDef } from './feeder';
import { DECKS, isPath } from './layout';
import { Picker } from './picking';
import { ReverseZoo } from './reverse';
import { World } from './scene';
import { Hud, type GameState } from './ui/hud';
import { Inspector } from './ui/inspector';
import { Crowd } from './visitors/Crowd';
import { Keepers } from './visitors/Keepers';

const OPEN_HOUR = 9;
const CLOSE_HOUR = 18;
const SIM_STEP = 1 / 30;

interface HabitatDef {
  enclosure: EnclosureDef;
  feeder: Omit<FeederDef, 'name'>;
  species: SpeciesId;
  count: number;
  males: number;
}

const HABITATS: HabitatDef[] = [
  {
    enclosure: {
      name: 'Zebra Plains',
      points: [[-46, -18], [-13, -22], [-9, 10], [-20, 25], [-48, 16]],
      groundColor: '#c9b77a',
      rocks: 3,
      trees: 2,
      keepClear: [[-12, 0, 3]],
      pond: [-32, 4, 4],
    },
    feeder: { food: 'hay', position: [-12, 0], capacity: 120, radius: 1.3 },
    species: 'zebra',
    count: 4,
    males: 2,
  },
  {
    enclosure: {
      name: 'Elephant Valley',
      points: [[11, -22], [45, -20], [49, 14], [31, 26], [10, 18]],
      groundColor: '#b59a6a',
      rocks: 4,
      trees: 2,
      keepClear: [[12.6, 1, 4]],
      pond: [33, -6, 5.5],
    },
    feeder: { food: 'hay', position: [12.6, 1], capacity: 150, radius: 1.8 },
    species: 'elephant',
    count: 2,
    males: 1,
  },
  {
    enclosure: {
      name: 'Lion Rock',
      points: [[-17, -37], [17, -37], [21, -60], [0, -69], [-21, -58]],
      groundColor: '#d0a865',
      rocks: 6,
      trees: 1,
      keepClear: [[0, -38.6, 3]],
      pond: [-9, -55, 3],
    },
    feeder: { food: 'meat', position: [0, -38.6], capacity: 100, radius: 1.2 },
    species: 'lion',
    count: 3,
    males: 1,
  },
];

const app = document.getElementById('app')!;
const world = new World(app);
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

for (const h of HABITATS) {
  const enclosure = new Enclosure(h.enclosure);
  const feeder = new Feeder({ ...h.feeder, name: h.enclosure.name });
  world.scene.add(enclosure.group, feeder.root);
  enclosures.push(enclosure);
  feeders.push(feeder);

  const species = SPECIES[h.species];
  const names = [...species.names].sort(() => Math.random() - 0.5);
  for (let i = 0; i < h.count; i++) {
    const animal = new Animal(species, names[i % names.length], i < h.males, enclosure, feeder);
    live.add(animal.root);
    animals.push(animal);
  }
}

world.decorate(
  // No plants on paths, along fences, or on rocks and ponds inside enclosures.
  (x, z) =>
    isPath(x, z, 0.8) ||
    enclosures.some((e) => (e.contains(x, z) ? !e.walkable(x, z, 1) : e.occupies(x, z, 1.2))),
  (x, z) => enclosures.some((e) => e.contains(x, z)),
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
  () => (reverse.active ? [] : [...animals.map((a) => a.root), ...feeders.map((f) => f.root)]),
  (pick) => {
    if (!pick) return select(null);
    if (pick.kind === 'animal') return select(pick.animal);
    const f = pick.feeder;
    if (f.fraction > 0.97) return hud.toast(`The ${f.name} feeder is full`);
    if (keepers.dispatch(f)) hud.toast(`A keeper is on the way to ${f.name}`, 'good');
    else hud.toast(`A keeper is already on the way to ${f.name}`);
  },
);

const keepers = new Keepers(
  live,
  feeders.map((feeder, i) => ({ feeder, enclosure: HABITATS[i].enclosure.name })),
);
const crowd = new Crowd(live, { animals, feedingAt: (name) => keepers.feedingAt(name) !== null });
for (const e of enclosures) e.animalSpots = DECKS.find((d) => d.enclosure === e.name)?.animalSpots ?? [];
const reverse = new ReverseZoo(world.scene, enclosures);

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
      if (a.enclosure !== b.enclosure) continue;
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

/** Read the shared real-time clock and announce new days and opening/closing. */
function syncClock(): void {
  const { day, hour } = zooTime(Date.now() + clockOffsetMs);
  if (isOpen(hour) !== isOpen(state.hour)) {
    hud.toast(isOpen(hour) ? 'The zoo is open! 🎟️' : 'The zoo is closed for the night', isOpen(hour) ? 'good' : 'info');
  }
  state.day = day;
  state.hour = hour;
}

function step(dt: number): void {
  for (const a of animals) a.update(dt, state.hour);
  crowd.update(dt, state.hour);
  keepers.update(dt);
  reverse.update(dt);
  separate();
}

window.addEventListener('keydown', (e) => {
  if (e.code !== 'KeyG') return;
  world.postEnabled = !world.postEnabled;
  world.resize();
  hud.toast(world.postEnabled ? 'Graphics: high' : 'Graphics: fast');
});

window.addEventListener('resize', () => {
  world.resize();
  rig.resize();
});

hud.toast('Welcome! Click an animal to inspect it, or a feeder to refill it.', 'good');

function frame(dt: number): void {
  for (const f of feeders) f.syncVisuals();
  const selected = inspector.selected;
  if (selected) {
    ring.position.set(selected.position.x, 0.05, selected.position.z);
    inspector.update(rig.following === selected.root);
  }
  hud.update();

  world.setTimeOfDay(state.hour);
  rig.update(dt);
  world.render(rig.camera);
}

const timer = new THREE.Timer();
world.renderer.setAnimationLoop((time) => {
  timer.update(time);
  // After a backgrounded tab the clock simply jumps ahead; the animals carry on from where they were.
  const dt = Math.min(timer.getDelta(), 0.1);
  syncClock();
  // Simulate every frame (in chunks of at most SIM_STEP) so motion matches the display's refresh rate.
  for (let left = dt; left > 1e-6; left -= SIM_STEP) step(Math.min(left, SIM_STEP));
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
      rig,
      focus(name: string) {
        const a = animals.find((x) => x.name === name);
        if (a) {
          select(a);
          rig.setFollow(a.root);
        }
      },
      advance(seconds: number) {
        for (let t = 0; t < seconds; t += SIM_STEP) {
          clockOffsetMs += SIM_STEP * 1000;
          syncClock();
          step(SIM_STEP);
        }
        frame(SIM_STEP);
      },
    },
  });
}
