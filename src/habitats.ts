import type { SpeciesId } from './animals/species';
import type { EnclosureDef } from './enclosure';
import { FACE_EAST, FACE_NORTH, FACE_WEST } from './facing';
import type { FeederDef } from './feeder';
import type { Spot } from './layout';

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
  treat: 'carrot' | 'apple' | null;
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
    },
    feeder: { food: 'meat', position: [0, -38.6], capacity: 100, radius: 1.2 },
    species: 'lion',
    count: 3,
    males: 1,
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
];

/** Viewing decks, one per habitat. */
export const DECKS: Deck[] = HABITATS.map((h) => ({ enclosure: h.enclosure.name, ...h.deck }));
