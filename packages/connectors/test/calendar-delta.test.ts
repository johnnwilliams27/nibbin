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
});
