'use server';

import { revalidatePath } from 'next/cache';
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
