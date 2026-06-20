import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Persists the new calendarSyncToken into connection.webhookState via the
 * jsonb_merge_connection_state RPC — the calendar analog of advanceGmailCursor.
 * Only called when the poll cycle completed without hitting the fan-out ceiling
 * (mirrors the Gmail cursor-advance contract).
 */
export async function advanceCalendarCursor(
  svc: SupabaseClient,
  connectionId: string,
  newSyncToken: string,
): Promise<void> {
  const { error } = await svc.rpc('jsonb_merge_connection_state', {
    p_connection: connectionId,
    p_patch: { calendarSyncToken: newSyncToken },
  });
  if (error) throw new Error(`calendar cursor advance failed: ${error.message}`);
}
