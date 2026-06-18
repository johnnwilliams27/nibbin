import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ConnectorEvent } from './dispatch';

export interface GmailDeltaDeps {
  /** Calls history.list; returns messages and the new cursor. */
  historyList: (
    startHistoryId: string,
    signal?: AbortSignal,
  ) => Promise<{ messages: Array<{ id: string; threadId: string }>; historyId: string }>;
  /** Returns the current historyId when no cursor exists. */
  getProfileHistoryId: () => Promise<string>;
  /** Calls history.list for overdue-thread detection; same cursor but different historyTypes. */
  checkOverdueThreads?: (signal?: AbortSignal) => Promise<Array<{ threadId: string }>>;
}

/** True when an error from history.list signals an expired/unknown historyId (HTTP 404). */
function isNotFound(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { status?: unknown; code?: unknown; response?: { status?: unknown } };
  return e.status === 404 || e.code === 404 || e.response?.status === 404;
}

export async function fetchGmailDelta(
  connectionId: string,
  accountId: string,
  webhookState: Record<string, unknown>,
  deps: GmailDeltaDeps,
  signal?: AbortSignal,
): Promise<{ events: ConnectorEvent[]; newHistoryId: string }> {
  let cursor = webhookState.historyId as string | undefined;
  if (!cursor) {
    cursor = await deps.getProfileHistoryId();
  }

  let messages: Array<{ id: string; threadId: string }>;
  let newHistoryId: string;
  try {
    ({ messages, historyId: newHistoryId } = await deps.historyList(cursor, signal));
  } catch (err) {
    // An expired historyId returns 404 from history.list. The gap is unrecoverable,
    // so skip it: advance the cursor to the current historyId and resume tracking
    // from now, returning zero events for this cycle.
    if (!isNotFound(err)) throw err;
    const resumeHistoryId = await deps.getProfileHistoryId();
    return { events: [], newHistoryId: resumeHistoryId };
  }

  const seen = new Set<string>();
  const events: ConnectorEvent[] = [];
  for (const msg of messages ?? []) {
    if (seen.has(msg.id)) continue;
    seen.add(msg.id);
    events.push({
      provider: 'gmail',
      connectionId,
      accountId,
      kind: 'message.received',
      historyId: newHistoryId,
      dedupeKey: `gmail:${connectionId}:${msg.id}`,
    });
  }

  return { events, newHistoryId };
}

export async function advanceGmailCursor(
  svc: SupabaseClient,
  connectionId: string,
  newHistoryId: string,
): Promise<void> {
  const { error } = await svc.rpc('jsonb_merge_connection_state', {
    p_connection: connectionId,
    p_patch: { historyId: newHistoryId },
  });
  if (error) throw new Error(`cursor advance failed: ${error.message}`);
}
