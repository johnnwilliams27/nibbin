'use server';

import { revalidatePath } from 'next/cache';
import { MIN_WINDOW_MS, MAX_WINDOW_MS, MAX_TRAINING_RUNS } from '@nibbin/runtime';
import { appSession } from '../../../lib/auth/app-session';
import { serviceClient } from '../../../lib/supabase/service';
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
  if (error) return { ok: false, error: error.message };

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
  if (error) return { ok: false, error: error.message };

  revalidatePath('/app/nibbins');
  return { ok: true };
}

export interface DemoteResult {
  ok: boolean;
  error?: string;
}

/** CE5: the user puts a Nibbin back to drafts. One click, dignified. Calls the
 *  member-checked nibbin_demote RPC with the caller's session (so the SQL's
 *  is_account_member/auth.uid() path applies), then drops the calm demotion leaf
 *  (and the in-grove ack rides the Beat-3 pending path). */
export async function demoteNibbinAction(nibbinId: string): Promise<DemoteResult> {
  const id = nibbinId?.trim();
  if (!id) return { ok: false, error: 'missing nibbin' };

  let supabase;
  let accountId: string;
  try {
    ({ supabase, accountId } = await appSession());
  } catch {
    return { ok: false, error: 'You need to be signed in.' };
  }

  // session client — auth.uid() drives the RPC's member check
  const { data: newStage, error } = await supabase.rpc('nibbin_demote', { p_nibbin: id });
  if (error) return { ok: false, error: error.message };

  // Calm demotion leaf (best-effort). Service client = controlled insert path.
  try {
    const svc = serviceClient();
    const { data: n } = await svc
      .from('nibbins')
      .select('name, species, palette, accessory, marking, stage_changed_at')
      .eq('id', id)
      .eq('account_id', accountId)
      .single();
    if (n) {
      await svc.rpc('insert_system_notification', {
        p_account: accountId,
        p_kind: 'demotion',
        p_source_id: `demotion:${id}:${n.stage_changed_at}`,
        p_title: `${n.name} is back to drafts`,
        p_body:
          `Good instinct catching that — nothing's lost. ${n.name} keeps what she learned and re-earns the step the same way. You're back in the loop on everything she sends.`,
        p_payload: {
          ctaPath: '/app/nibbins',
          ctaLabel: `See ${n.name}`,
          nibbinId: id,
          species: n.species,
          stage: newStage as string,
          palette: n.palette ?? null,
          accessory: n.accessory ?? 'none',
          marking: n.marking ?? 'none',
        },
      });
    }
  } catch {
    // leaf is best-effort; the demotion itself already succeeded
  }
  revalidatePath('/app/nibbins');
  revalidatePath('/app');
  return { ok: true };
}
