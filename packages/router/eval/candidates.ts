/**
 * Candidate matrix (config — adjustable). The (task → incumbent, challenger)
 * pairs the harness evaluates, seeded with the highest-value, P8-aligned set:
 *
 *  - T2 tasks (incumbent `claude-sonnet-4-6`) challenged by the CHEAPER
 *    `claude-haiku-4-5-20251001` — the clearest cost win where Haiku is
 *    adequate. These clear within `qualityTolerance` (kind: 'cost').
 *  - quality-sensitive T1 tasks (incumbent `claude-haiku-4-5-20251001`)
 *    challenged by `claude-sonnet-4-6` for headroom — these only clear at
 *    ≥ incumbent (kind: 'quality').
 *
 * `diagnosis_synthesis` and `nibbin_note` are the deliberate Opus splurges
 * (§6.3 "never cost-optimize the moment that earns belief") — NOT challenged.
 *
 * The pinned model ids match tiers.ts (DEFAULT_MODELS / DEFAULT_TASK_MODELS).
 * Adjust this list to widen/narrow what a run evaluates.
 */
import type { CandidatePair } from './types';

const HAIKU = 'claude-haiku-4-5-20251001';
const SONNET = 'claude-sonnet-4-6';

export const CANDIDATE_MATRIX: CandidatePair[] = [
  // ── T2 (Sonnet incumbent) challenged by the cheaper Haiku (cost win) ───────
  {
    task: 'custom_spec_draft',
    tier: 't2',
    incumbent: SONNET,
    challenger: HAIKU,
    kind: 'cost',
  },
  {
    task: 'complex_plan',
    tier: 't2',
    incumbent: SONNET,
    challenger: HAIKU,
    kind: 'cost',
  },
  {
    task: 'plan_synthesis',
    tier: 't2',
    incumbent: SONNET,
    challenger: HAIKU,
    kind: 'cost',
  },
  // ── quality-sensitive T1 (Haiku incumbent) challenged by Sonnet (headroom) ─
  {
    task: 'specialist_draft',
    tier: 't1',
    incumbent: HAIKU,
    challenger: SONNET,
    kind: 'quality',
  },
  {
    task: 'map_labeling',
    tier: 't1',
    incumbent: HAIKU,
    challenger: SONNET,
    kind: 'quality',
  },
];
