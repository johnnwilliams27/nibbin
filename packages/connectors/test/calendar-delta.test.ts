import { expect, it, describe } from 'vitest';
import { fetchCalendarDelta } from '../src/connectors/calendar-delta';

describe('fetchCalendarDelta', () => {
  it('bootstraps a sync token on first run and emits no events', async () => {
    const r = await fetchCalendarDelta('c1', 'a1', {}, {
      listSync: async () => ({ items: [{ id: 'e1' }], nextSyncToken: 'tok1' }),
    });
    expect(r.newSyncToken).toBe('tok1');
    expect(r.events).toHaveLength(0);
  });

  it('emits events for changes on a subsequent run', async () => {
    const r = await fetchCalendarDelta('c1', 'a1', { calendarSyncToken: 'tok1' }, {
      listSync: async () => ({ items: [{ id: 'e2', status: 'confirmed' }], nextSyncToken: 'tok2' }),
    });
    expect(r.newSyncToken).toBe('tok2');
    expect(r.events.length).toBe(1);
  });

  it('emits events with correct ConnectorEvent fields', async () => {
    const r = await fetchCalendarDelta('conn-1', 'acct-1', { calendarSyncToken: 'tok1' }, {
      listSync: async () => ({ items: [{ id: 'evt-abc', status: 'confirmed' }], nextSyncToken: 'tok2' }),
    });
    expect(r.events[0]).toMatchObject({
      provider: 'google-calendar',
      connectionId: 'conn-1',
      accountId: 'acct-1',
      kind: 'calendar.changed',
      dedupeKey: 'google-calendar:conn-1:evt-abc',
    });
  });

  it('skips events with no id', async () => {
    const r = await fetchCalendarDelta('c1', 'a1', { calendarSyncToken: 'tok1' }, {
      listSync: async () => ({ items: [{ status: 'confirmed' }, { id: 'e2' }], nextSyncToken: 'tok2' }),
    });
    expect(r.events).toHaveLength(1);
  });

  it('deduplicates repeated event ids in a single page', async () => {
    const r = await fetchCalendarDelta('c1', 'a1', { calendarSyncToken: 'tok1' }, {
      listSync: async () => ({
        items: [{ id: 'dup' }, { id: 'dup' }, { id: 'other' }],
        nextSyncToken: 'tok2',
      }),
    });
    expect(r.events).toHaveLength(2);
  });

  it('returns empty events and no token when listSync returns nothing', async () => {
    const r = await fetchCalendarDelta('c1', 'a1', { calendarSyncToken: 'tok1' }, {
      listSync: async () => ({}),
    });
    // No new token returned — falls back to prior
    expect(r.newSyncToken).toBe('tok1');
    expect(r.events).toHaveLength(0);
  });

  it('accumulates items across multiple pages and uses the final nextSyncToken', async () => {
    // Page 1: items + nextPageToken (no nextSyncToken yet)
    // Page 2: items + nextSyncToken (no nextPageToken — final page)
    let call = 0;
    const r = await fetchCalendarDelta('c1', 'a1', { calendarSyncToken: 'tok1' }, {
      listSync: async (_syncToken, pageToken) => {
        call++;
        if (call === 1) {
          expect(pageToken).toBeUndefined();
          return { items: [{ id: 'e1' }, { id: 'e2' }], nextPageToken: 'p2' };
        }
        expect(pageToken).toBe('p2');
        return { items: [{ id: 'e3' }], nextSyncToken: 'tok2' };
      },
    });
    expect(r.newSyncToken).toBe('tok2');
    expect(r.events).toHaveLength(3);
    expect(r.events.map((e) => e.dedupeKey)).toEqual([
      'google-calendar:c1:e1',
      'google-calendar:c1:e2',
      'google-calendar:c1:e3',
    ]);
  });

  it('terminates at MAX_SYNC_PAGES (50) when nextPageToken never clears', async () => {
    let calls = 0;
    // Simulate a stuck Google response: every page returns a nextPageToken that
    // never clears, so the loop would spin forever without the cap.
    const r = await fetchCalendarDelta('c1', 'a1', { calendarSyncToken: 'tok1' }, {
      listSync: async (_syncToken, _pageToken) => {
        calls++;
        return {
          items: [{ id: `e${calls}` }],
          // Keep returning a pageToken but never return a nextSyncToken — this
          // would spin forever without the cap.
          nextPageToken: 'stuck-page-token',
        };
      },
    });
    // Loop must have stopped at the cap, not run indefinitely.
    expect(calls).toBe(50);
    // Items accumulated up to the cap are kept (one per page = 50).
    expect(r.events.length).toBe(50);
    // Best token we had (tok1 from calendarSyncToken) is preserved — not empty.
    expect(r.newSyncToken).toBe('tok1');
  });

  it('recovers from 410 expired sync token: emits no events and returns a fresh token', async () => {
    // First call throws 410; subsequent baseline call returns a fresh token
    let call = 0;
    const r = await fetchCalendarDelta('c1', 'a1', { calendarSyncToken: 'expired' }, {
      listSync: async (syncToken) => {
        call++;
        if (call === 1) {
          // Simulate expired token — matches ConnectorRequestError shape (status field)
          const err = Object.assign(new Error('Sync token expired'), { status: 410 });
          throw err;
        }
        // Baseline call: syncToken must be undefined (fresh start)
        expect(syncToken).toBeUndefined();
        return { items: [{ id: 'old-event' }], nextSyncToken: 'fresh' };
      },
    });
    expect(r.events).toHaveLength(0);
    expect(r.newSyncToken).toBe('fresh');
  });

  // FIX 1: syncToken and pageToken must be mutually exclusive across pages
  it('passes syncToken ONLY on the first page, undefined on subsequent pages', async () => {
    const capturedArgs: Array<{ syncToken: string | undefined; pageToken: string | undefined }> = [];
    let call = 0;
    await fetchCalendarDelta('c1', 'a1', { calendarSyncToken: 'tok1' }, {
      listSync: async (syncToken, pageToken) => {
        capturedArgs.push({ syncToken, pageToken });
        call++;
        if (call === 1) {
          // First page: syncToken should be passed, no pageToken yet
          return { items: [{ id: 'e1' }], nextPageToken: 'p2' };
        }
        // Second page: syncToken must be undefined — Google requires mutual exclusivity
        return { items: [{ id: 'e2' }], nextSyncToken: 'tok2' };
      },
    });
    // First call: syncToken present, pageToken absent
    expect(capturedArgs[0]!.syncToken).toBe('tok1');
    expect(capturedArgs[0]!.pageToken).toBeUndefined();
    // Second call: syncToken must be undefined, pageToken set
    expect(capturedArgs[1]!.syncToken).toBeUndefined();
    expect(capturedArgs[1]!.pageToken).toBe('p2');
  });

  // FIX 4: empty sync token must never be persisted
  it('returns null (not empty string) when prior is undefined and Google returns no nextSyncToken', async () => {
    // Simulate first run (no prior token) where Google returns no nextSyncToken
    const r = await fetchCalendarDelta('c1', 'a1', {}, {
      listSync: async () => ({ items: [{ id: 'e1' }] }), // no nextSyncToken
    });
    // Must not yield an empty string — null signals "no advance" to the poll route
    expect(r.newSyncToken).toBeNull();
    expect(r.newSyncToken).not.toBe('');
    expect(r.events).toHaveLength(0);
  });

  it('returns the prior token (not empty string) when already-synced run gets no nextSyncToken', async () => {
    const r = await fetchCalendarDelta('c1', 'a1', { calendarSyncToken: 'existing-tok' }, {
      listSync: async () => ({}), // no items, no nextSyncToken
    });
    // Falls back to prior, never persists empty string
    expect(r.newSyncToken).toBe('existing-tok');
    expect(r.newSyncToken).not.toBe('');
  });

  // FIX 5: fetchCalendarDelta delta-path page cap already tested above (MAX_SYNC_PAGES = 50)
  // The scan-path page cap (MAX_SCAN_PAGES) is tested in calendar-findings.test.ts
});

describe('fetchCalendarDelta — calendar scan page cap (Fix 5)', () => {
  // Re-export fetchEvents is not exposed directly; test indirectly via a ScanModule run
  // The real cap test lives in packages/scan/test/calendar-findings.test.ts
  it('sanity: accumulatePages already enforces MAX_SYNC_PAGES=50 for the delta path', async () => {
    let calls = 0;
    const r = await fetchCalendarDelta('c1', 'a1', { calendarSyncToken: 'tok1' }, {
      listSync: async () => {
        calls++;
        return { items: [{ id: `e${calls}` }], nextPageToken: 'stuck' };
      },
    });
    expect(calls).toBe(50);
    expect(r.events).toHaveLength(50);
  });
});
