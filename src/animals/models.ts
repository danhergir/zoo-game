import { mergeRig } from '../merge';
import { buildElephant } from './builders/elephant';
import { buildLion } from './builders/lion';
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
};

export function buildModel(species: SpeciesId, male: boolean): AnimalModel {
  const model = BUILDERS[species](male);
  // Merge the rigid parts of each joint so an animal costs a few draw calls, not dozens.
  mergeRig(model.root);
  return model;
}
