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
