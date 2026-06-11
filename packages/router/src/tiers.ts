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
  training_feedback: 't1',
  map_labeling: 't1',
  diagnosis_synthesis: 't2',
  custom_spec_draft: 't2',
  complex_plan: 't2',
};

/**
 * Default model pool. Tuned per ENVIRONMENT ("primary + fallback configured
 * per routing tier"); override via createRouter config or reconfigure().
 */
export const DEFAULT_MODELS: Record<Tier, string> = {
  t0: 'claude-haiku-4-5-20251001',
  t1: 'claude-sonnet-4-6',
  t2: 'claude-opus-4-8',
};

/** Default T2-from-chat grants per user per day. */
export const DEFAULT_DAILY_FRONTIER_BUDGET = 5;

/**
 * §6.3 degradation phrasing — shown to the user whenever a chat request that
 * classified T2 is served at T1 because the day's frontier budget is spent.
 * Degradation is transparent by construction; this string is the transparency.
 */
export const DEGRADATION_NOTICE = "Doing this the simple way today — it'll still be right.";
