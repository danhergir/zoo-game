import { DECKS } from './habitats';
import { FACE_EAST, FACE_WEST } from './facing';

/**
 * Where the walkable parts of the zoo are. Shared by the scenery (which draws
 * them) and the visitors (who walk them).
 */

export interface Spot {
  x: number;
  z: number;
  /** Facing direction (rotation.y). */
  yaw: number;
}

/** Path rectangles as [x, z, width, depth]. */
export const PATH_RECTS: [number, number, number, number][] = [
  [0, 4, 9, 66], // main avenue
  [0, 34, 110, 8], // entrance boulevard
  [7.4, 26, 5.8, 1.6], // staff path from the keeper hut to the avenue
  [-48.5, -29.5, 79, 6], // west wing
  [48.5, -29.5, 79, 6], // east wing
];

/** Keepers' hut beside the gate; they come and go through its door. */
export const STAFF_HUT = { x: 12.6, z: 26, w: 4, d: 3.2 };
export const STAFF_DOOR: Spot = { x: 10.2, z: 26, yaw: Math.PI / 2 };

export const PLAZA = { x: 0, z: -26, r: 9 };

/** The entrance arch over the avenue. */
export const GATE_Z = 28.5;

/** Boulevard centerline and where visitors appear / disappear. */
export const BOULEVARD_Z = 34;
export const EXIT_X = 24;

export { DECKS, type Deck } from './habitats';

/** Benches along the avenue. `side` is +1 for the east side, -1 for west; they face the path. */
export const BENCHES = [-10, 14, 24].flatMap((z) => [1, -1].map((side) => ({ x: side * 5.3, z, side })));

/** Two seats per bench. */
export const SEATS: Spot[] = BENCHES.flatMap((b) =>
  [-0.45, 0.45].map((dz) => ({ x: b.side * 5.2, z: b.z + dz, yaw: b.side > 0 ? FACE_WEST : FACE_EAST })),
);

/** Lamp posts along the avenue and around the plaza. */
export const LAMPS: [number, number][] = [
  ...[-16, -4, 8, 20].flatMap((z): [number, number][] => [
    [5.4, z],
    [-5.4, z],
  ]),
  // Along the wings, alternating sides.
  ...[-80, -64, -48, -32, -18, 18, 32, 48, 64, 80].map((x, i): [number, number] => [x, i % 2 ? -26.1 : -32.9]),
  ...Array.from({ length: 6 }, (_, i): [number, number] => {
    const a = (i / 6) * Math.PI * 2;
    return [PLAZA.x + Math.cos(a) * (PLAZA.r + 0.6), PLAZA.z + Math.sin(a) * (PLAZA.r + 0.6)];
  }),
];

/**
 * The walkable network as a graph: junction nodes joined by straight edges
 * that stay on paths. People route along it with a per-person lane offset so
 * crowds spread across the path instead of walking single file.
 */
const PLAZA_RING = 5.5; // ring of nodes around the plaza's planter
const ring = (k: number): [number, number] => [
  PLAZA.x + PLAZA_RING * Math.cos((k * Math.PI) / 4),
  PLAZA.z + PLAZA_RING * Math.sin((k * Math.PI) / 4),
];

/** Wings run west and east from the plaza to the newer exhibits. */
export const WING_Z = -29.5;
export const WING_END_X = 88;

const NODES: [number, number][] = [
  [-55, BOULEVARD_Z], // 0 boulevard west end
  [0, BOULEVARD_Z], // 1 boulevard / avenue junction
  [55, BOULEVARD_Z], // 2 boulevard east end
  [0, 26], // 3 avenue / staff path junction
  [STAFF_DOOR.x, STAFF_DOOR.z], // 4 staff hut door
  [0, -17.5], // 5 avenue meets the plaza
  ...Array.from({ length: 8 }, (_, k) => ring(k)), // 6..13 plaza ring (E, SE, S, SW, W, NW, N, NE)
  [-9, WING_Z], // 14 west wing start
  [-WING_END_X, WING_Z], // 15 west wing end
  [9, WING_Z], // 16 east wing start
  [WING_END_X, WING_Z], // 17 east wing end
];

/** [a, b, path width]. */
const EDGES: [number, number, number][] = [
  [0, 1, 8],
  [1, 2, 8],
  [1, 3, 9],
  [3, 4, 1.6],
  [3, 5, 9],
  [5, 8, 6], // avenue into the plaza ring (south node)
  ...Array.from({ length: 8 }, (_, k): [number, number, number] => [6 + k, 6 + ((k + 1) % 8), 4]),
  [10, 14, 5], // ring west -> west wing
  [14, 15, 6],
  [6, 16, 5], // ring east -> east wing
  [16, 17, 6],
];

const laneScale = (width: number) => Math.min(1, Math.max(0, (width / 2 - 0.7) / 2.6));

/** Closest point on the network to (x, z): which edge, and where along it. */
function project(x: number, z: number): { edge: number; t: number; px: number; pz: number } {
  let best = { edge: 0, t: 0, px: 0, pz: 0 };
  let bestD = Infinity;
  EDGES.forEach(([a, b], edge) => {
    const [ax, az] = NODES[a];
    const [bx, bz] = NODES[b];
    const dx = bx - ax;
    const dz = bz - az;
    const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    const px = ax + dx * t;
    const pz = az + dz * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < bestD) {
      bestD = d;
      best = { edge, t, px, pz };
    }
  });
  return best;
}

/** Node indices along the shortest path between two network points (Dijkstra; the graph is tiny). */
function shortest(from: ReturnType<typeof project>, to: ReturnType<typeof project>): number[] {
  const n = NODES.length;
  const S = n; // virtual start
  const T = n + 1; // virtual target
  const adj: [number, number][][] = Array.from({ length: n + 2 }, () => []);
  const link = (a: number, b: number, w: number) => {
    adj[a].push([b, w]);
    adj[b].push([a, w]);
  };
  const dist = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  for (const [a, b] of EDGES) link(a, b, dist(NODES[a], NODES[b]));
  for (const [v, p] of [[S, from], [T, to]] as const) {
    const [a, b] = EDGES[p.edge];
    link(v, a, dist(NODES[a], [p.px, p.pz]));
    link(v, b, dist(NODES[b], [p.px, p.pz]));
  }
  const best = new Array<number>(n + 2).fill(Infinity);
  const prev = new Array<number>(n + 2).fill(-1);
  const done = new Array<boolean>(n + 2).fill(false);
  best[S] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < n + 2; i++) if (!done[i] && best[i] < Infinity && (u < 0 || best[i] < best[u])) u = i;
    if (u < 0 || u === T) break;
    done[u] = true;
    for (const [v, w] of adj[u]) {
      if (best[u] + w < best[v]) {
        best[v] = best[u] + w;
        prev[v] = u;
      }
    }
  }
  const nodes: number[] = [];
  for (let v = prev[T]; v !== S && v >= 0; v = prev[v]) nodes.unshift(v);
  return nodes;
}

/**
 * Waypoints from `from` to `to` along the paths: step onto the nearest path,
 * follow the shortest route through the junctions, step off at the end.
 * `lane` (about -2.6..2.6) is a sideways offset scaled to each path's width.
 */
export function routeOnPaths(from: { x: number; z: number }, to: { x: number; z: number }, lane: number): [number, number][] {
  const a = project(from.x, from.z);
  const b = project(to.x, to.z);
  const line: { p: [number, number]; width: number }[] = [{ p: [a.px, a.pz], width: EDGES[a.edge][2] }];
  if (a.edge !== b.edge) {
    for (const node of shortest(a, b)) {
      // A junction is as narrow as the narrowest path meeting it.
      const widths = EDGES.filter(([x, y]) => x === node || y === node).map((e) => e[2]);
      line.push({ p: NODES[node], width: Math.min(...widths) });
    }
  }
  line.push({ p: [b.px, b.pz], width: EDGES[b.edge][2] });

  const out: [number, number][] = line.map(({ p, width }, i) => {
    const prev = line[Math.max(0, i - 1)].p;
    const next = line[Math.min(line.length - 1, i + 1)].p;
    let dx = next[0] - prev[0];
    let dz = next[1] - prev[1];
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    const o = lane * laneScale(width);
    return [p[0] - dz * o, p[1] + dx * o];
  });
  out.push([to.x, to.z]);
  return out;
}

export function isPath(x: number, z: number, margin = 0): boolean {
  for (const [cx, cz, w, d] of PATH_RECTS) {
    if (Math.abs(x - cx) < w / 2 + margin && Math.abs(z - cz) < d / 2 + margin) return true;
  }
  for (const k of [...DECKS, STAFF_HUT]) {
    if (Math.abs(x - k.x) < k.w / 2 + margin && Math.abs(z - k.z) < k.d / 2 + margin) return true;
  }
  return Math.hypot(x - PLAZA.x, z - PLAZA.z) < PLAZA.r + margin;
}
