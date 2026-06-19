/**
 * Candidate matrix (config — adjustable) — the COMPREHENSIVE (maximal) envelope
 * per docs/superpowers/specs/2026-06-19-routing-eval-comprehensive-design.md.
 * The (task → incumbent, challenger) pairs the harness evaluates, spanning every
 * task with a real routing lever, every Anthropic candidate (incl. Fable 5), and
 * the splurges stress-tested as REPORT-ONLY.
 *
 *  - T1 tasks (incumbent `claude-haiku-4-5-20251001`) — challenged by
 *    `claude-sonnet-4-6` (quality headroom) and `claude-fable-5` (peer). These
 *    are quality challenges (Sonnet/Fable are not cheaper than Haiku), so they
 *    clear only at ≥ incumbent.
 *  - T2 non-splurge tasks (incumbent `claude-sonnet-4-6`) — challenged by
 *    `claude-haiku-4-5-20251001` (cost win), `claude-opus-4-8` (quality
 *    headroom + a pre-vetted premium fallback), and `claude-fable-5` (peer).
 *  - T2 SPLURGE tasks (incumbent `claude-opus-4-8`) — diagnosis_synthesis and
 *    nibbin_note — challenged by `claude-sonnet-4-6` and `claude-fable-5` for
 *    INSIGHT ONLY: is a cheaper model adequate for the belief-earning moments?
 *    These carry `reportOnly: true`: the report surfaces their scores, but
 *    `clearedEntries` / `--write` NEVER arm them, regardless of clearance
 *    (§6.3 "never cost-optimize the moment that earns belief").
 *
 * T0 EXCLUDED — no lever: Haiku is already the cheapest API class and T0 tasks
 * are scripted/templated wherever possible, so there is neither a cost nor a
 * quality challenger worth a run. (Can be added later if a specific T0 quality
 * complaint arises — see the design doc.)
 *
 * Fable 5 is a 'quality'/peer challenger everywhere: no Fable pricing is pinned
 * (cost-delta renders N/A), so we cannot assert it is cheaper than any incumbent
 * — treat it as a peer that must clear at ≥ incumbent (the conservative bar). If
 * Fable pricing is later pinned showing it is cheaper than a given incumbent,
 * that specific pair can be re-kinded 'cost'.
 *
 * The pinned model ids match tiers.ts (DEFAULT_MODELS / DEFAULT_TASK_MODELS).
 * Adjust this list to widen/narrow what a run evaluates.
 */
import type { CandidatePair } from './types';

const HAIKU = 'claude-haiku-4-5-20251001';
const SONNET = 'claude-sonnet-4-6';
const OPUS = 'claude-opus-4-8';
const FABLE = 'claude-fable-5';

/** The eight T1 tasks (Haiku incumbent), each challenged by Sonnet + Fable. */
const T1_TASKS: CandidatePair['task'][] = [
  'specialist_draft',
  'scan_synthesis',
  'onboarding_understanding',
  'training_feedback',
  'map_labeling',
  'sweep_pass1',
  'sweep_pass2',
  'memory_extract',
];

const t1Pairs: CandidatePair[] = T1_TASKS.flatMap((task) => [
  { task, tier: 't1', incumbent: HAIKU, challenger: SONNET, kind: 'quality' },
  { task, tier: 't1', incumbent: HAIKU, challenger: FABLE, kind: 'quality' },
]);

/** The three T2 non-splurge tasks (Sonnet incumbent): Haiku cost + Opus + Fable. */
const T2_TASKS: CandidatePair['task'][] = [
  'custom_spec_draft',
  'complex_plan',
  'plan_synthesis',
];

const t2Pairs: CandidatePair[] = T2_TASKS.flatMap((task) => [
  { task, tier: 't2', incumbent: SONNET, challenger: HAIKU, kind: 'cost' },
  { task, tier: 't2', incumbent: SONNET, challenger: OPUS, kind: 'quality' },
  { task, tier: 't2', incumbent: SONNET, challenger: FABLE, kind: 'quality' },
]);

/**
 * The two T2 SPLURGE tasks (Opus incumbent) — REPORT-ONLY. Scored against
 * cheaper Sonnet + peer Fable for insight; NEVER armed (`reportOnly: true`).
 */
const T2_SPLURGE_TASKS: CandidatePair['task'][] = [
  'diagnosis_synthesis',
  'nibbin_note',
];

const splurgePairs: CandidatePair[] = T2_SPLURGE_TASKS.flatMap((task) => [
  // Sonnet IS cheaper than the Opus incumbent — but reportOnly means the kind is
  // informational only (we never arm it). Kept 'cost' so the report's clearance
  // line reflects "is the cheaper model adequate?" honestly.
  { task, tier: 't2', incumbent: OPUS, challenger: SONNET, kind: 'cost', reportOnly: true },
  { task, tier: 't2', incumbent: OPUS, challenger: FABLE, kind: 'quality', reportOnly: true },
]);

export const CANDIDATE_MATRIX: CandidatePair[] = [
  ...t1Pairs,
  ...t2Pairs,
  ...splurgePairs,
];
