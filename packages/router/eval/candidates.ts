/**
 * Candidate matrix (config — adjustable) — the COMPREHENSIVE (maximal) envelope
 * per docs/superpowers/specs/2026-06-19-routing-eval-comprehensive-design.md.
 * The (task → incumbent, challenger) pairs the harness evaluates, spanning every
 * task with a real routing lever and the splurges stress-tested as REPORT-ONLY.
 *
 *  - T1 tasks (incumbent `claude-haiku-4-5-20251001`) — challenged by
 *    `claude-sonnet-4-6` (quality headroom). Quality challenge (Sonnet is not
 *    cheaper than Haiku), so it clears only at ≥ incumbent.
 *  - T2 non-splurge tasks (incumbent `claude-sonnet-4-6`) — challenged by
 *    `claude-haiku-4-5-20251001` (cost win) and `claude-opus-4-8` (quality
 *    headroom + a pre-vetted premium fallback).
 *  - T2 SPLURGE tasks (incumbent `claude-opus-4-8`) — diagnosis_synthesis and
 *    nibbin_note — challenged by `claude-sonnet-4-6` for INSIGHT ONLY: is a
 *    cheaper model adequate for the belief-earning moments? These carry
 *    `reportOnly: true`: the report surfaces their scores, but `clearedEntries`
 *    / `--write` NEVER arm them, regardless of clearance (§6.3 "never
 *    cost-optimize the moment that earns belief").
 *
 * FABLE 5 EXCLUDED: `claude-fable-5` requires special access ("fable-mythos")
 * that this account/prod key does NOT have — the API rejects it ("Claude Fable 5
 * is not available"). Since prod itself cannot call Fable, it is not a viable
 * routing candidate here. Re-add it (and a pricing entry) once access is granted;
 * the harness already handles it (it just isn't callable today).
 *
 * T0 EXCLUDED — no lever: Haiku is already the cheapest API class and T0 tasks
 * are scripted/templated wherever possible, so there is neither a cost nor a
 * quality challenger worth a run.
 *
 * The pinned model ids match tiers.ts (DEFAULT_MODELS / DEFAULT_TASK_MODELS).
 * Adjust this list to widen/narrow what a run evaluates.
 */
import type { CandidatePair } from './types';

const HAIKU = 'claude-haiku-4-5-20251001';
const SONNET = 'claude-sonnet-4-6';
const OPUS = 'claude-opus-4-8';

/** The eight T1 tasks (Haiku incumbent), each challenged by Sonnet (quality). */
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

const t1Pairs: CandidatePair[] = T1_TASKS.map((task) => ({
  task,
  tier: 't1',
  incumbent: HAIKU,
  challenger: SONNET,
  kind: 'quality',
}));

/** The three T2 non-splurge tasks (Sonnet incumbent): Haiku cost + Opus quality. */
const T2_TASKS: CandidatePair['task'][] = [
  'custom_spec_draft',
  'complex_plan',
  'plan_synthesis',
];

const t2Pairs: CandidatePair[] = T2_TASKS.flatMap((task) => [
  { task, tier: 't2', incumbent: SONNET, challenger: HAIKU, kind: 'cost' },
  { task, tier: 't2', incumbent: SONNET, challenger: OPUS, kind: 'quality' },
]);

/**
 * The two T2 SPLURGE tasks (Opus incumbent) — REPORT-ONLY. Scored against
 * cheaper Sonnet for insight; NEVER armed (`reportOnly: true`).
 */
const T2_SPLURGE_TASKS: CandidatePair['task'][] = [
  'diagnosis_synthesis',
  'nibbin_note',
];

const splurgePairs: CandidatePair[] = T2_SPLURGE_TASKS.map((task) => ({
  // Sonnet IS cheaper than the Opus incumbent — but reportOnly means the kind is
  // informational only (we never arm it). Kept 'cost' so the report's clearance
  // line reflects "is the cheaper model adequate?" honestly.
  task,
  tier: 't2' as const,
  incumbent: OPUS,
  challenger: SONNET,
  kind: 'cost' as const,
  reportOnly: true,
}));

export const CANDIDATE_MATRIX: CandidatePair[] = [
  ...t1Pairs,
  ...t2Pairs,
  ...splurgePairs,
];
