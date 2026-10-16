import { skinRig } from '../skin';
import { buildElephant } from './builders/elephant';
import { buildGiraffe } from './builders/giraffe';
import { buildLion } from './builders/lion';
import { buildMonkey } from './builders/monkey';
import { buildPenguin } from './builders/penguin';
import { buildZebra } from './builders/zebra';
import type { AnimalModel } from './rig';
import type { SpeciesId } from './species';

/**
 * Procedural stylized animal rigs. Everything faces +Z with feet at y = 0.
 * Each species has its own builder in ./builders; Animal only relies on AnimalModel.
 */
export { poseLegs, type AnimalModel, type Leg } from './rig';

const BUILDERS: Record<SpeciesId, (male: boolean) => AnimalModel> = {
  zebra: () => buildZebra(),
  elephant: () => buildElephant(),
  lion: (male) => buildLion(male),
  giraffe: () => buildGiraffe(),
  penguin: () => buildPenguin(),
  monkey: () => buildMonkey(),
};

export function buildModel(species: SpeciesId, male: boolean): AnimalModel {
  const m = BUILDERS[species](male);
  // One skinned mesh per material: an animal costs a few draw calls, not dozens. Joints become bones.
  const bone = skinRig(m.root);
  return {
    ...m,
    pose: bone(m.pose),
    head: bone(m.head),
    legs: m.legs.map((l) => ({ hip: bone(l.hip), knee: bone(l.knee), front: l.front })),
    tail: m.tail && bone(m.tail),
    trunk: m.trunk.map(bone),
    neck: m.neck.map(bone),
    flippers: m.flippers.map(bone),
    ears: m.ears.map((e) => ({ pivot: bone(e.pivot), rest: e.rest })),
  };
}
