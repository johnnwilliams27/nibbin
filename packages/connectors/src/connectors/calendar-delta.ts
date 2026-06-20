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
   * Accepts an optional syncToken (absent on first run) and an optional
   * pageToken for multi-page responses; returns the items array, the new
   * nextSyncToken (only on the last page), and a nextPageToken when more
   * pages follow.
   */
  listSync: (syncToken?: string, pageToken?: string) => Promise<{
    items?: CalendarSyncItem[];
    nextSyncToken?: string;
    nextPageToken?: string;
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

/** True when an error signals an expired sync token (HTTP 410 Gone). */
function isSyncTokenExpired(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { status?: unknown; code?: unknown; response?: { status?: unknown } };
  return e.status === 410 || e.code === 410 || e.response?.status === 410;
}

/**
 * Maximum number of pages fetched in a single cron invocation.
 * Guards against a non-advancing nextPageToken from Google spinning a cron
 * invocation indefinitely. On hitting the cap the items accumulated so far
 * are returned with the best sync token seen — safe to persist and retry next
 * cycle; an empty token is never persisted.
 */
const MAX_SYNC_PAGES = 50;

/**
 * Accumulate all pages from listSync starting at `syncToken` (undefined for
 * baseline).  Returns all items across pages and the final nextSyncToken.
 * If the server returns an empty token on the last page, the caller's
 * fallback logic handles it.
 */
async function accumulatePages(
  listSync: CalendarDeltaDeps['listSync'],
  syncToken: string | undefined,
): Promise<{ allItems: CalendarSyncItem[]; newSyncToken: string }> {
  const allItems: CalendarSyncItem[] = [];
  let pageToken: string | undefined;
  let newSyncToken = syncToken ?? '';
  let pages = 0;

  do {
    const res = await listSync(syncToken, pageToken);
    allItems.push(...(res.items ?? []));
    if (res.nextSyncToken) newSyncToken = res.nextSyncToken;
    pageToken = res.nextPageToken;
    pages++;
    if (pages >= MAX_SYNC_PAGES) break;
  } while (pageToken);

  return { allItems, newSyncToken };
}

/**
 * Fetch the incremental calendar delta for one connection.
 *
 * First run (no `calendarSyncToken` in webhookState): establishes the
 * baseline sync token via a full-sync list call; emits NO events so the
 * initial poll doesn't flood Nibbins with historical events.
 *
 * Subsequent runs: emits one CalendarConnectorEvent per changed event id.
 * Deduplication within a single batch is applied (a repeated id produces one
 * event).  The caller (poll route) applies cross-cycle dedup via the event
 * store keyed 'google-calendar'.
 *
 * 410 recovery: an expired sync token causes Google to return 410 Gone.
 * Rather than stalling forever, we drop the expired token, perform a fresh
 * baseline accumulation, emit NO events, and return the new token — matching
 * Gmail's historyId recovery behaviour.
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

  let allItems: CalendarSyncItem[];
  let newSyncToken: string;

  try {
    ({ allItems, newSyncToken } = await accumulatePages(deps.listSync, prior));
  } catch (err) {
    // 410 Gone: sync token has expired; the gap is unrecoverable.
    // Re-anchor to the current baseline and resume from now, emitting no events.
    if (!isSyncTokenExpired(err)) throw err;
    ({ allItems, newSyncToken } = await accumulatePages(deps.listSync, undefined));
    // Guard: never persist an empty token after recovery.
    if (!newSyncToken) return { events: [], newSyncToken: prior ?? '' };
    return { events: [], newSyncToken };
  }

  // Guard: never persist an empty sync token.
  if (!newSyncToken) {
    return { events: [], newSyncToken: prior ?? '' };
  }

  // First run: baseline only — emit nothing so historical events are not
  // replayed as "new" changes the first time a calendar connection is polled.
  if (!prior) {
    return { events: [], newSyncToken };
  }

  const seen = new Set<string>();
  const events: CalendarConnectorEvent[] = [];
  for (const item of allItems) {
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
