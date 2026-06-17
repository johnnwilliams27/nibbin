/**
 * Per-beat email dressing: subject, preheader, and which creature greets the
 * reader. Subjects are sentence case, no urgency, no guilt (brand voice).
 * The Grovekeeper fronts most beats — it's the Keeper writing, after all.
 */
import type { BuildOptions } from '@nibbin/creatures';
import type { BeatContent, BeatKey } from '@nibbin/drip';

export interface BeatTemplate {
  subject: string;
  preheader: string;
  creature: BuildOptions;
}

const KEEPER: BuildOptions = { species: 'Keeper', size: 88 };

const TEMPLATES: Record<BeatKey, Omit<BeatTemplate, 'subject'> & { subject: string | null }> = {
  field_notes_1: {
    subject: 'Your first Field Notes are in',
    preheader: 'What your grove got up to today, plus one thing from the scan.',
    creature: KEEPER,
  },
  species: {
    subject: 'Meet the six species',
    preheader: 'Each one is temperamentally good at something different.',
    creature: { species: 'Sprout', stage: 'student', size: 88 },
  },
  training_1: {
    subject: 'Five minutes of training, when you have them',
    preheader: 'Three uncertain drafts, each correction written into the journal.',
    creature: KEEPER,
  },
  journal: {
    subject: 'The journal has its first pages',
    preheader: 'What your Nibbin has learned about how you like things done.',
    creature: { species: 'Longear', stage: 'student', acc: 'quill', size: 88 },
  },
  study_whisper: {
    subject: 'The study is whispering',
    preheader: 'It runs on your desk; what it captures stays on your machine.',
    creature: KEEPER,
  },
  scan_depth: {
    subject: 'Something the scan turned up',
    preheader: 'I went a layer deeper into your connected accounts today.',
    creature: KEEPER,
  },
  half_time: {
    subject: 'Your Half-time Report',
    preheader: 'A week in — the scoreboard, and your diagnosis date.',
    creature: KEEPER,
  },
  training_2: {
    subject: 'Three more drafts could use your eye',
    preheader: 'And a plain word about sending anyone back a grade.',
    creature: KEEPER,
  },
  map_preview: {
    subject: 'Your map is sprouting',
    preheader: 'A first, low-confidence sketch of how your work flows.',
    creature: { species: 'Glim', stage: 'student', size: 88 },
  },
  graduation_eve: {
    subject: 'Someone is close to graduating',
    preheader: 'What graduation changes, and what it never changes.',
    creature: KEEPER,
  },
  diagnosis_reveal: {
    // Subject follows the variant (with/without Observer) — use the title.
    subject: null,
    preheader: 'Fourteen days, grown into one map.',
    creature: KEEPER,
  },
};

export function templateFor(content: BeatContent): BeatTemplate {
  const t = TEMPLATES[content.key];
  return { subject: t.subject ?? content.title, preheader: t.preheader, creature: t.creature };
}

/**
 * Every creature any beat template can show — the source of truth for which
 * email rasters must exist. The raster script bakes a PNG for each; a test
 * asserts coverage so a new beat creature can't ship without its asset.
 */
export const BEAT_CREATURES: readonly BuildOptions[] = Object.values(TEMPLATES).map((t) => t.creature);
