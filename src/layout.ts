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

export interface Deck {
  enclosure: string;
  x: number;
  z: number;
  w: number;
  d: number;
  /** Where visitors stand to watch, facing the enclosure. */
  spots: Spot[];
  /** Kept free for the keeper, right in front of the feeder. */
  feedSpot: Spot;
}

const FACE_WEST = -Math.PI / 2;
const FACE_EAST = Math.PI / 2;
const FACE_NORTH = Math.PI;

/** Wooden viewing decks between the paths and the fences. */
export const DECKS: Deck[] = [
  {
    enclosure: 'Zebra Plains',
    x: -7.1,
    z: 0,
    w: 5.6,
    d: 5,
    spots: [-2, -1, 1, 2].map((z) => ({ x: -9.2, z, yaw: FACE_WEST })),
    feedSpot: { x: -9.5, z: 0, yaw: FACE_WEST },
  },
  {
    enclosure: 'Elephant Valley',
    x: 7.3,
    z: 1,
    w: 5.4,
    d: 5,
    spots: [-1, 0, 2, 3].map((z) => ({ x: 9.4, z, yaw: FACE_EAST })),
    feedSpot: { x: 9.7, z: 1, yaw: FACE_EAST },
  },
  {
    enclosure: 'Lion Rock',
    x: 0,
    z: -34.85,
    w: 7,
    d: 3.7,
    spots: [-2.8, -1.6, 1.6, 2.8].map((x) => ({ x, z: -36.1, yaw: FACE_NORTH })),
    feedSpot: { x: 0, z: -36.4, yaw: FACE_NORTH },
  },
];

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
  ...Array.from({ length: 6 }, (_, i): [number, number] => {
    const a = (i / 6) * Math.PI * 2;
    return [PLAZA.x + Math.cos(a) * (PLAZA.r + 0.6), PLAZA.z + Math.sin(a) * (PLAZA.r + 0.6)];
  }),
];

export function isPath(x: number, z: number, margin = 0): boolean {
  for (const [cx, cz, w, d] of PATH_RECTS) {
    if (Math.abs(x - cx) < w / 2 + margin && Math.abs(z - cz) < d / 2 + margin) return true;
  }
  for (const k of [...DECKS, STAFF_HUT]) {
    if (Math.abs(x - k.x) < k.w / 2 + margin && Math.abs(z - k.z) < k.d / 2 + margin) return true;
  }
  return Math.hypot(x - PLAZA.x, z - PLAZA.z) < PLAZA.r + margin;
}
