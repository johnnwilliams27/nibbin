import type { ReinforcementParams, RoutedTask, Tier } from './types';

/**
 * The §6.3 tier table, verbatim. `chat` is the single dynamic entry — its
 * tier comes from the complexity classifier, with T0 as the stated default.
 */
export const TIER_FOR_TASK: Record<Exclude<RoutedTask, 'chat'>, Tier> = {
  smalltalk: 't0',
  intent_classification: 't0',
  routing: 't0',
  formatting: 't0',
  field_notes_copy: 't0',
  journal_phrasing: 't0',
  specialist_draft: 't1',
  scan_synthesis: 't1',
  onboarding_understanding: 't1',
  training_feedback: 't1',
  map_labeling: 't1',
  sweep_pass1: 't1',
  sweep_pass2: 't1',
  memory_extract: 't1',
  style_extraction: 't0',
  diagnosis_synthesis: 't2',
  custom_spec_draft: 't2',
  nibbin_note: 't2',
  complex_plan: 't2',
  // The Planner's plan-synthesis call (Slice 3a) — frontier/T2-class. It is an
  // INTERACTIVE, user-initiated call routed `origin:'chat'`, so it is NOT in
  // UNBUDGETED_T2_TASKS: it draws the per-user daily frontier budget (the same
  // bound the Composer's draft call takes, per the 2a P1 fix).
  plan_synthesis: 't2',
  // Document ingestion (P2): field-extraction LLM call (T1, Haiku-class —
  // structured extraction over a capped 50k-char chunk; no complexity classifier).
  doc_extract: 't1',
  // Vision extraction for scanned PDFs / images (T1 — Haiku handles vision
  // adequately for doc-text extraction; gated only on the scanned-PDF path).
  doc_vision_extract: 't1',
  // Company-brain synthesis (P5 §6b): answers user questions from the source
  // corpus + memory. T1 (mid-tier) — a frequent, interactive retrieval call
  // that should not draw the frontier budget.
  synthesis: 't1',
  // C2 follow-up: semantic contradiction judging (collate pass). T1 — a short,
  // structured yes/no classification over already-derived field values; a
  // background pipeline call that must never draw the frontier budget.
  contradiction_judge: 't1',
};

/**
 * Default model pool — founder decision 2026-06-12 (docs/tasks/
 * M6.5-model-bringup.md): T1 = Haiku-class (the ~80% workhorse), T2 =
 * Sonnet-class, with the diagnosis alone pinned to Opus via
 * DEFAULT_TASK_MODELS. T0 tasks are scripted/templated wherever possible;
 * when one does dispatch, it uses the cheapest API class. Tuned per
 * ENVIRONMENT; override via createRouter config or reconfigure() — any model
 * change gates on the eval suite (SPEC §9 decision log).
 */
export const DEFAULT_MODELS: Record<Tier, string> = {
  t0: 'claude-haiku-4-5-20251001',
  t1: 'claude-haiku-4-5-20251001',
  t2: 'claude-sonnet-4-6',
};

/**
 * Per-task model pins that override the tier default. The day-14 diagnosis
 * is the one deliberate splurge (§6.3: "never cost-optimize the moment that
 * earns belief") — it alone rides Opus.
 */
export const DEFAULT_TASK_MODELS: Partial<Record<RoutedTask, string>> = {
  diagnosis_synthesis: 'claude-opus-4-8',
  // The roster's "what {name} has learned about you" note rides Opus too — it's
  // a small, infrequent, grounded line the keeper writes about the relationship,
  // generated off the render path and gated by run history + a staleness check,
  // so its cost is bounded by the same caller-side controls as the diagnosis.
  nibbin_note: 'claude-opus-4-8',
};

/**
 * The ONLY T2 tasks that may run unbudgeted, and only from pipeline origin:
 * §6.3 names diagnosis synthesis and custom-spec drafting as the deliberate
 * splurges with their own caller-side controls. Everything else that wants
 * T2 — any chat-origin request, and complex_plan from anywhere — draws the
 * per-user daily frontier budget (gate condition on #24: budget all T2
 * except an explicit whitelist; origin is caller-claimed and must not be a
 * bypass).
 */
export const UNBUDGETED_T2_TASKS: ReadonlySet<RoutedTask> = new Set<RoutedTask>([
  'diagnosis_synthesis',
  'custom_spec_draft',
  // nibbin_note is a pipeline-origin background refresh, throttled by the
  // roster's staleness gate (only regenerated when run history materially
  // grows) rather than the per-user chat frontier budget.
  'nibbin_note',
]);

/**
 * Per-task ORDERED candidate sets — the eval-cleared allowlist (Slice B,
 * §4B/§7 "thin owned reinforcement"). Each entry is the set of models the
 * reinforcement policy may shift traffic AMONG for that task; the FIRST entry
 * is the safe default (the model route() returns absent data). Reinforcement
 * NEVER introduces a model outside this set — the candidate set IS the
 * allowlist, and adding a candidate is itself an eval-gated act (M6.5 §9
 * "swaps gated by the eval suite").
 *
 * A task with NO explicit set here resolves to its single configured model
 * (task pin if present, else the tier default) — its sole candidate. Two sets
 * were eval-cleared + armed 2026-06-19 (below; see docs/eval/routing-2026-06-19.md).
 * Even for an armed task, route() is byte-for-byte unchanged UNTIL
 * `NIBBIN_REINFORCEMENT` is on (the incumbent is listed FIRST, so the
 * no-perf-source path returns it) AND ≥ MIN_DECIDED_CALLS of decided data has
 * accrued. Add a candidate only after it clears the eval suite (M6.5 §9).
 */
export const DEFAULT_TASK_CANDIDATES: Partial<Record<RoutedTask, readonly string[]>> = {
  // Eval-cleared 2026-06-19 — see docs/eval/routing-*.md
  specialist_draft: ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6'],
  // Eval-cleared 2026-06-19 — see docs/eval/routing-*.md
  scan_synthesis: ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6'],
  // Eval-cleared 2026-06-19 — see docs/eval/routing-*.md
  onboarding_understanding: ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6'],
  // Eval-cleared 2026-06-19 — see docs/eval/routing-*.md
  training_feedback: ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6'],
  // Eval-cleared 2026-06-19 — see docs/eval/routing-*.md
  map_labeling: ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6'],
  // Eval-cleared 2026-06-19 — see docs/eval/routing-*.md
  sweep_pass1: ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6'],
  // Eval-cleared 2026-06-19 — see docs/eval/routing-*.md
  sweep_pass2: ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6'],
  // Eval-cleared 2026-06-19 — see docs/eval/routing-*.md
  memory_extract: ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6'],
  // Eval-cleared 2026-06-19 — see docs/eval/routing-*.md
  custom_spec_draft: ['claude-sonnet-4-6', 'claude-haiku-4-5-20251001', 'claude-opus-4-8'],
  // Eval-cleared 2026-06-19 — see docs/eval/routing-*.md
  complex_plan: ['claude-sonnet-4-6', 'claude-opus-4-8'],
  // Eval-cleared 2026-06-19 — see docs/eval/routing-*.md
  plan_synthesis: ['claude-sonnet-4-6', 'claude-opus-4-8'],
};

/**
 * Reinforcement weighting parameters (§4B "quality-within-budget"). Thin and
 * deterministic — NOT ML.
 * - `minDecidedCalls`: the min-volume floor. A candidate with fewer than this
 *   many *decided* (human-rated) calls in the window is statistically too thin
 *   to act on; if the leading candidate lacks the floor we don't reweight at
 *   all and fall back to the configured default. Prevents one lucky early
 *   approval from swinging traffic.
 * - `qualityBar`: a candidate must clear this approved-unedited rate to be
 *   eligible on quality grounds at all (a model the humans reject most of the
 *   time is never "cheapest-acceptable").
 * - `qualityTolerance`: P8 cost-aware tie-break band. Among eligible
 *   candidates, any whose approved-unedited rate is within this tolerance of
 *   the BEST eligible rate is "as good"; among those we pick the CHEAPEST
 *   (avg cost). So we never pay more for a quality difference inside the noise.
 * - `maxRefusalErrorRate`: a hard exclusion. A candidate refusing/erroring
 *   more than this fraction of calls is dropped regardless of approval rate
 *   (a model silently degrading must not keep winning on a stale quality read).
 */
export const DEFAULT_REINFORCEMENT: ReinforcementParams = {
  minDecidedCalls: 30,
  qualityBar: 0.4,
  qualityTolerance: 0.03,
  maxRefusalErrorRate: 0.2,
};

/**
 * Default per-user/day T2 (frontier) grant. This is the shared T2 cap consulted
 * by EVERY budgeted T2 path that reaches the frontier branch (chat is the
 * dominant one; budgeted non-chat T2 draws it too). Raised 5→15 (2026-06-21): 5
 * dropped a chatty user to "the simple way" fast; at ~$0.01/Sonnet turn, 15/day
 * is ~$0.15/user/day worst case across surfaces — cost-safe (gate cost-auditor).
 * The all-tier web ceiling (#230) is the outer runaway backstop; this is the
 * frontier-tier sub-limit within it.
 */
export const DEFAULT_DAILY_FRONTIER_BUDGET = 15;

/**
 * §6.3 degradation phrasing — shown to the user whenever a chat request that
 * classified T2 is served at T1 because the day's frontier budget is spent.
 * Degradation is transparent by construction; this string is the transparency.
 */
export const DEGRADATION_NOTICE = "Doing this the simple way today — it'll still be right.";

/**
 * Shown when the per-user daily chat ceiling (#230) is reached — chat pauses
 * for the rest of the UTC day. Calm and non-punitive: nothing is lost, the
 * user's Nibbins keep working, and it resets automatically.
 */
export const CHAT_CEILING_NOTICE =
  "We've talked a lot today — let's pick this up tomorrow. Your Nibbins keep working in the meantime, and chat resets after midnight (UTC).";
