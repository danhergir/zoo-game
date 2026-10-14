import type { FoodType } from '../feeder';

export type SpeciesId = 'zebra' | 'elephant' | 'lion';

export interface SpeciesDef {
  id: SpeciesId;
  label: string;
  food: FoodType;
  /** Walking speed in world units per second. */
  speed: number;
  /** Body radius used for spacing and feeder approach. */
  radius: number;
  /** Fullness lost per second (fullness runs 0..1). */
  hungerRate: number;
  /** Fullness gained per second while eating. */
  eatRate: number;
  /** Feeder units consumed per 1.0 of fullness. */
  portion: number;
  /** Energy lost per second while awake. */
  tireRate: number;
  /** Below this fullness the animal heads to the feeder. */
  hungryAt: number;
  /** Chance to idle instead of wandering when it has nothing to do. */
  idleChance: number;
  /** Income per game hour at full happiness, while the zoo is open. */
  appeal: number;
  names: string[];
}

export const SPECIES: Record<SpeciesId, SpeciesDef> = {
  zebra: {
    id: 'zebra',
    label: 'Zebra',
    food: 'hay',
    speed: 2.4,
    radius: 1.1,
    hungerRate: 0.009,
    eatRate: 0.12,
    portion: 25,
    tireRate: 0.004,
    hungryAt: 0.45,
    idleChance: 0.4,
    appeal: 3,
    names: ['Ziggy', 'Marty', 'Stripe', 'Zuri', 'Domino', 'Pepper', 'Ozzy', 'Nala'],
  },
  elephant: {
    id: 'elephant',
    label: 'Elephant',
    food: 'hay',
    speed: 1.5,
    radius: 2.1,
    hungerRate: 0.007,
    eatRate: 0.08,
    portion: 50,
    tireRate: 0.003,
    hungryAt: 0.5,
    idleChance: 0.45,
    appeal: 8,
    names: ['Dumbo', 'Tembo', 'Ellie', 'Babar', 'Kibo', 'Mosi'],
  },
  lion: {
    id: 'lion',
    label: 'Lion',
    food: 'meat',
    speed: 2.0,
    radius: 1.0,
    hungerRate: 0.006,
    eatRate: 0.15,
    portion: 30,
    tireRate: 0.006,
    hungryAt: 0.4,
    idleChance: 0.7,
    appeal: 7,
    names: ['Simba', 'Leo', 'Kiara', 'Sarabi', 'Aslan', 'Zira', 'Kovu'],
  },
};
