import type { RoutedTask, Tier } from './types';

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
  diagnosis_synthesis: 't2',
  custom_spec_draft: 't2',
  nibbin_note: 't2',
  complex_plan: 't2',
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

/** Default T2-from-chat grants per user per day. */
export const DEFAULT_DAILY_FRONTIER_BUDGET = 5;

/**
 * §6.3 degradation phrasing — shown to the user whenever a chat request that
 * classified T2 is served at T1 because the day's frontier budget is spent.
 * Degradation is transparent by construction; this string is the transparency.
 */
export const DEGRADATION_NOTICE = "Doing this the simple way today — it'll still be right.";
