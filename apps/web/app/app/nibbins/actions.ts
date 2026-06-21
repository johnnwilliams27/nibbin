'use server';

import { revalidatePath } from 'next/cache';
import { MIN_WINDOW_MS, MAX_WINDOW_MS, MAX_TRAINING_RUNS } from '@nibbin/runtime';
import { appSession } from '../../../lib/auth/app-session';
import { refreshLearnedNote } from '../../../lib/nibbins/learned-note';

/**
 * Background refresh of a Nibbin's "what {name} has learned about you" note.
 * Fired fire-and-forget by the roster's NoteRefresher client island for stale
 * rows — never on the render path. Resolves the caller's own session/account so
 * the refresh is account-scoped (refreshLearnedNote re-checks ownership), then
 * regenerates the cached note and revalidates the roster so it appears next
 * load. Best-effort: refreshLearnedNote never throws.
 */
export async function refreshNibbinNote(nibbinId: string): Promise<void> {
  const id = nibbinId?.trim();
  if (!id) return;

  let accountId: string;
  try {
    ({ accountId } = await appSession());
  } catch {
    return; // not signed in — nothing to refresh
  }

  await refreshLearnedNote(accountId, id);
  revalidatePath('/app/nibbins');
}

export interface NibbinAppearance {
  name: string;
  species: string;
  palette: string;
  accessory: string;
  marking: string;
}

export interface UpdateResult {
  ok: boolean;
  error?: string;
}

/**
 * Rename + restyle one of the account's own nibbins. Calls the
 * update_nibbin_appearance security-definer RPC under the caller's RLS session
 * (authenticated has execute; the function re-checks account membership and
 * refuses the canonical Grovekeeper). Validation is enforced in SQL against the
 * creatures engine's accepted inputs; we surface its message on failure.
 */
export async function updateNibbinAppearance(
  nibbinId: string,
  appearance: NibbinAppearance,
): Promise<UpdateResult> {
  const id = nibbinId?.trim();
  if (!id) return { ok: false, error: 'Missing nibbin.' };

  let supabase;
  try {
    ({ supabase } = await appSession());
  } catch {
    return { ok: false, error: 'You need to be signed in.' };
  }

  const { error } = await supabase.rpc('update_nibbin_appearance', {
    p_nibbin: id,
    p_name: appearance.name,
    p_species: appearance.species,
    p_palette: appearance.palette,
    p_accessory: appearance.accessory,
    p_marking: appearance.marking,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath('/app/nibbins');
  revalidatePath('/app');
  return { ok: true };
}

export interface TrainingResult {
  ok: boolean;
  error?: string;
}

/**
 * Map a raw training RPC error to short, human-actionable copy. The RPCs raise
 * raw Postgres strings (e.g. "training open-window limit reached…", "unknown
 * nibbin …", or a membership refusal); surfacing those verbatim leaks PG
 * internals to the UI. We translate the known cases and otherwise fall back to a
 * generic line — never the raw message. (Repo error-design stance.)
 */
function trainingErrorCopy(message: string | undefined, generic: string): string {
  const m = (message ?? '').toLowerCase();
  if (m.includes('limit reached')) {
    return 'You already have a few agents in training. Finish or stop one before starting another.';
  }
  if (m.includes('unknown nibbin') || m.includes('not a member') || m.includes('is_account_member')) {
    return "We couldn't find that agent on your account.";
  }
  if (m.includes('not authenticated')) {
    return 'You need to be signed in.';
  }
  return generic;
}

/**
 * Opt an agent into Training Mode (§18.1) — a time-boxed, budget-bounded window
 * during which the scheduler MAY sample more triggers so the agent surfaces more
 * drafts-for-approval and accumulates School's promotion signal faster. STRICTLY
 * ADDITIVE: it grants no autonomy and changes no gate — every produced draft
 * still rides the unchanged School gate, and promotion still requires the full
 * threshold. Calls the membership-checked training_open RPC under the caller's
 * session; the SQL clamps the bounds (we also clamp here for an honest UI).
 */
export async function openTrainingAction(
  nibbinId: string,
  opts?: { durationMs?: number; maxRuns?: number; novelty?: boolean },
): Promise<TrainingResult> {
  const id = nibbinId?.trim();
  if (!id) return { ok: false, error: 'Missing nibbin.' };

  let supabase;
  try {
    ({ supabase } = await appSession());
  } catch {
    return { ok: false, error: 'You need to be signed in.' };
  }

  // Conservative defaults: a 7-day window, 50 extra runs (clamped to bounds).
  const durationMs = Math.min(Math.max(opts?.durationMs ?? 7 * 24 * 60 * 60 * 1000, MIN_WINDOW_MS), MAX_WINDOW_MS);
  const maxRuns = Math.min(Math.max(Math.floor(opts?.maxRuns ?? 50), 1), MAX_TRAINING_RUNS);

  const { error } = await supabase.rpc('training_open', {
    p_nibbin: id,
    p_duration_secs: Math.round(durationMs / 1000),
    p_max_runs: maxRuns,
    p_novelty: opts?.novelty ?? false,
  });
  if (error) return { ok: false, error: trainingErrorCopy(error.message, "We couldn't start training just now. Please try again.") };

  revalidatePath('/app/nibbins');
  return { ok: true };
}

/** Opt an agent out of Training Mode — one click, immediate. Member-checked
 *  training_close RPC under the caller's session. */
export async function closeTrainingAction(nibbinId: string): Promise<TrainingResult> {
  const id = nibbinId?.trim();
  if (!id) return { ok: false, error: 'Missing nibbin.' };

  let supabase;
  try {
    ({ supabase } = await appSession());
  } catch {
    return { ok: false, error: 'You need to be signed in.' };
  }

  const { error } = await supabase.rpc('training_close', { p_nibbin: id, p_reason: 'user' });
  if (error) return { ok: false, error: trainingErrorCopy(error.message, "We couldn't stop training just now. Please try again.") };

  revalidatePath('/app/nibbins');
  return { ok: true };
}

export interface PauseResumeResult {
  ok: boolean;
  error?: string;
}

/** Pause an active nibbin at the user's request. Calls the member-checked
 *  nibbin_pause RPC under the caller's session. */
export async function pauseNibbinAction(nibbinId: string): Promise<PauseResumeResult> {
  const id = nibbinId?.trim();
  if (!id) return { ok: false, error: 'Missing nibbin.' };

  let supabase;
  try {
    ({ supabase } = await appSession());
  } catch {
    return { ok: false, error: 'You need to be signed in.' };
  }

  const { error } = await supabase.rpc('nibbin_pause', { p_nibbin: id });
  if (error) return { ok: false, error: error.message };

  revalidatePath('/app/nibbins');
  return { ok: true };
}

/** Resume a user-paused nibbin. Calls the member-checked nibbin_resume RPC
 *  under the caller's session. System pauses (anomaly/cap/connection) are
 *  refused by the RPC — only reason='user' is accepted. */
export async function resumeNibbinAction(nibbinId: string): Promise<PauseResumeResult> {
  const id = nibbinId?.trim();
  if (!id) return { ok: false, error: 'Missing nibbin.' };

  let supabase;
  try {
    ({ supabase } = await appSession());
  } catch {
    return { ok: false, error: 'You need to be signed in.' };
  }

  const { error } = await supabase.rpc('nibbin_resume', { p_nibbin: id });
  if (error) return { ok: false, error: error.message };

  revalidatePath('/app/nibbins');
  return { ok: true };
}

/** Archive ("soft-delete") a nibbin: sets status to sleeping and kills any
 *  in-flight runs. The nibbin is never hard-deleted. Calls the member-checked
 *  nibbin_sleep RPC under the caller's session. */
export async function sleepNibbinAction(nibbinId: string): Promise<PauseResumeResult> {
  const id = nibbinId?.trim();
  if (!id) return { ok: false, error: 'Missing nibbin.' };

  let supabase;
  try {
    ({ supabase } = await appSession());
  } catch {
    return { ok: false, error: 'You need to be signed in.' };
  }

  const { error } = await supabase.rpc('nibbin_sleep', { p_nibbin: id });
  if (error) return { ok: false, error: error.message };

  revalidatePath('/app/nibbins');
  revalidatePath('/app');
  return { ok: true };
}

