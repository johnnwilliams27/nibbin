/**
 * Calendar incremental-sync delta fetcher (poll analog of fetchGmailDelta).
 *
 * Google Calendar uses `nextSyncToken` for incremental polling: the first
 * call with no syncToken establishes the baseline (full-sync page) and
 * returns the initial token; subsequent calls pass that token and receive
 * only changes since the last sync.  This mirrors the Gmail historyId pattern.
 *
 * Deferred: push/watch webhooks (google-channel-token scheme).  Until those
 * are wired, the cron poll drives all calendar liveness.
 */

/** Minimal shape returned by listSync; items only need id for dispatch. */
export interface CalendarSyncItem {
  id?: string;
  status?: string;
}

export interface CalendarDeltaDeps {
  /**
   * Wraps GoogleCalendarClient.listEventsSync for the 'primary' calendar.
   * Accepts an optional syncToken (absent on first run) and returns the
   * items array and the new nextSyncToken.
   */
  listSync: (syncToken?: string) => Promise<{
    items?: CalendarSyncItem[];
    nextSyncToken?: string;
  }>;
}

/**
 * Structurally compatible with apps/web/lib/connections/dispatch.ConnectorEvent.
 * Defined here to avoid a cross-layer import from packages into apps.
 */
export interface CalendarConnectorEvent {
  provider: 'google-calendar';
  connectionId: string;
  accountId: string;
  kind: 'calendar.changed';
  dedupeKey: string;
}

/**
 * Fetch the incremental calendar delta for one connection.
 *
 * First run (no `calendarSyncToken` in webhookState): establishes the
 * baseline sync token via a full-sync list call; emits NO events so the
 * initial poll doesn't flood Nibbins with historical events.
 *
 * Subsequent runs: emits one CalendarConnectorEvent per changed event id.
 * Deduplication within a single page is applied (a repeated id produces one
 * event).  The caller (poll route) applies cross-cycle dedup via the event
 * store keyed 'google-calendar'.
 */
export async function fetchCalendarDelta(
  connectionId: string,
  accountId: string,
  webhookState: Record<string, unknown>,
  deps: CalendarDeltaDeps,
): Promise<{ events: CalendarConnectorEvent[]; newSyncToken: string }> {
  const prior =
    typeof webhookState.calendarSyncToken === 'string'
      ? webhookState.calendarSyncToken
      : undefined;

  const res = await deps.listSync(prior);
  const newSyncToken = res.nextSyncToken ?? prior ?? '';

  // First run: baseline only — emit nothing so historical events are not
  // replayed as "new" changes the first time a calendar connection is polled.
  if (!prior) {
    return { events: [], newSyncToken };
  }

  const seen = new Set<string>();
  const events: CalendarConnectorEvent[] = [];
  for (const item of res.items ?? []) {
    if (!item.id) continue;
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    events.push({
      provider: 'google-calendar',
      connectionId,
      accountId,
      kind: 'calendar.changed',
      dedupeKey: `google-calendar:${connectionId}:${item.id}`,
    });
  }

  return { events, newSyncToken };
}
