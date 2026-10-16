import type { SpeciesId } from './animals/species';
import type { EnclosureDef } from './enclosure';
import { FACE_EAST, FACE_NORTH, FACE_SOUTH, FACE_WEST } from './facing';
import type { FeederDef } from './feeder';
import type { Spot } from './layout';
import type { Treat } from './visitors/Visitor';

/**
 * Every exhibit in the zoo: its fenced enclosure, feeder, residents and the
 * viewing deck in front of it. Add a species by adding an entry here.
 */

export interface DeckDef {
  x: number;
  z: number;
  w: number;
  d: number;
  /** Where visitors stand to watch, facing the enclosure. */
  spots: Spot[];
  /** Kept free for the keeper, right in front of the feeder. */
  feedSpot: Spot;
  /** Just inside the fence, facing the deck: where curious animals come to say hello. */
  animalSpots: Spot[];
  /** Treats visitors can hand over here, or null if animals here aren't fed by hand. */
  treat: Treat | null;
}

export interface Deck extends DeckDef {
  enclosure: string;
}

export interface HabitatDef {
  enclosure: EnclosureDef;
  feeder: Omit<FeederDef, 'name'>;
  species: SpeciesId;
  count: number;
  males: number;
  /** Young that follow a mother around. */
  babies?: number;
  /** The viewing deck in front of this enclosure. */
  deck: DeckDef;
}

export const HABITATS: HabitatDef[] = [
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
    babies: 1,
    deck: {
      x: -7.1,
      z: 0,
      w: 5.6,
      d: 5,
      spots: [-2, -1, 1, 2].map((z) => ({ x: -9.2, z, yaw: FACE_WEST })),
      feedSpot: { x: -9.5, z: 0, yaw: FACE_WEST },
      animalSpots: [-3.2, 3.2].map((z) => ({ x: -11.6, z, yaw: FACE_EAST })),
      treat: 'carrot',
    },
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
    babies: 1,
    deck: {
      x: 7.3,
      z: 1,
      w: 5.4,
      d: 5,
      spots: [-1, 0, 2, 3].map((z) => ({ x: 9.4, z, yaw: FACE_EAST })),
      feedSpot: { x: 9.7, z: 1, yaw: FACE_EAST },
      animalSpots: [-3, 5].map((z) => ({ x: 12.2, z, yaw: FACE_WEST })),
      treat: 'apple',
    },
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
      warmRock: [8, -50],
    },
    feeder: { food: 'meat', position: [0, -38.6], capacity: 100, radius: 1.2 },
    species: 'lion',
    count: 3,
    males: 1,
    babies: 2,
    deck: {
      x: 0,
      z: -34.85,
      w: 7,
      d: 3.7,
      spots: [-2.8, -1.6, 1.6, 2.8].map((x) => ({ x, z: -36.1, yaw: FACE_NORTH })),
      feedSpot: { x: 0, z: -36.4, yaw: FACE_NORTH },
      animalSpots: [-3.4, 3.4].map((x) => ({ x, z: -38.4, yaw: 0 })),
      treat: null,
    },
  },
  {
    // North-west of the west wing: tall acacias to browse and a raised hay rack.
    enclosure: {
      name: 'Giraffe Heights',
      points: [[-27, -36.5], [-70, -36.5], [-84, -58], [-64, -86], [-30, -80]],
      groundColor: '#c8b27a',
      rocks: 3,
      trees: 5,
      tallTrees: true,
      keepClear: [[-48, -39, 3.5]],
      pond: [-62, -64, 4],
    },
    feeder: { food: 'hay', position: [-48, -39], capacity: 130, radius: 1.2, elevation: 2.3 },
    species: 'giraffe',
    count: 3,
    males: 1,
    deck: {
      x: -48,
      z: -34.25,
      w: 8,
      d: 3.5,
      spots: [-51, -49.6, -46.4, -45].map((x) => ({ x, z: -35.5, yaw: FACE_NORTH })),
      feedSpot: { x: -48, z: -35.7, yaw: FACE_NORTH },
      animalSpots: [-51.8, -44.2].map((x) => ({ x, z: -39.6, yaw: FACE_SOUTH })),
      treat: 'leaves',
    },
  },
  {
    // North-east of the east wing: an icy shore around a big pool, behind glass.
    enclosure: {
      name: 'Penguin Point',
      points: [[27, -36.5], [70, -36.5], [84, -58], [64, -86], [30, -80]],
      groundColor: '#d9e3e8',
      rocks: 7,
      trees: 0,
      keepClear: [[48, -39, 3]],
      pond: [56, -62, 11],
      glass: true,
      icy: true,
      huddle: [37, -52],
    },
    feeder: { food: 'fish', position: [48, -39], capacity: 90, radius: 1.0 },
    species: 'penguin',
    count: 8,
    males: 4,
    deck: {
      x: 48,
      z: -34.25,
      w: 8,
      d: 3.5,
      spots: [44.6, 46, 50, 51.4].map((x) => ({ x, z: -35.5, yaw: FACE_NORTH })),
      feedSpot: { x: 48, z: -35.7, yaw: FACE_NORTH },
      // Penguins are small: four of them fit along the glass.
      animalSpots: [44.6, 46, 50, 51.4].map((x) => ({ x, z: -37.4, yaw: FACE_SOUTH })),
      treat: null,
    },
  },
  {
    // West end of the west wing: a climbing frame with rope bridges, behind glass.
    enclosure: {
      name: 'Monkey Grove',
      points: [[-62, -23], [-100, -23], [-108, 0], [-90, 20], [-60, 12]],
      groundColor: '#8f8452',
      rocks: 3,
      trees: 3,
      keepClear: [[-78, -20.4, 3]],
      pond: [-70, 7, 3.5],
      glass: true,
      jungleGym: [-86, -2],
    },
    feeder: { food: 'fruit', position: [-78, -20.4], capacity: 80, radius: 1.0 },
    species: 'monkey',
    count: 6,
    males: 3,
    deck: {
      x: -78,
      z: -24.85,
      w: 8,
      d: 3.3,
      spots: [-81.4, -80, -76, -74.6].map((x) => ({ x, z: -23.6, yaw: FACE_SOUTH })),
      feedSpot: { x: -78, z: -23.5, yaw: FACE_SOUTH },
      animalSpots: [-82.6, -81.2, -74.8, -73.4].map((x) => ({ x, z: -21.6, yaw: FACE_NORTH })),
      treat: null,
    },
  },
];

/** Viewing decks, one per habitat. */
export const DECKS: Deck[] = HABITATS.map((h) => ({ enclosure: h.enclosure.name, ...h.deck }));
