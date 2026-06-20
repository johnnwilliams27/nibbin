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
});
