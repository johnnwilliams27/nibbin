export { buildCreature } from './build';
export { creatureCss } from './css';
export { PALETTES, shade } from './color';
export { SPECIES, SPECIES_NAMES, USER_SPECIES } from './species';
export type {
  Accessory,
  Anchors,
  BodyParts,
  BuildOptions,
  Marking,
  Palette,
  SpeciesName,
  Stage,
} from './types';

export const STAGES: readonly ['egg', 'student', 'senior', 'grad'] = ['egg', 'student', 'senior', 'grad'];

export const STAGE_LABEL: Record<'egg' | 'student' | 'senior' | 'grad', string> = {
  egg: 'Egg',
  student: 'Student',
  senior: 'Senior',
  grad: 'Graduate',
};

export const ACCS: readonly ['none', 'glasses', 'bow', 'pencil', 'broom', 'quill', 'coin'] = [
  'none', 'glasses', 'bow', 'pencil', 'broom', 'quill', 'coin',
];

export const MARKS: readonly ['none', 'spots', 'stripe', 'star'] = ['none', 'spots', 'stripe', 'star'];
