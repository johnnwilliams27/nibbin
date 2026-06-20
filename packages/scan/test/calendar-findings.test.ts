import { expect, it, describe } from 'vitest';
import { quarantine, scanWindowEndingAt, type Connection } from '@nibbin/connectors';
import { modulesForProvider } from '../src/engine';
import { calendarMeetingLoad } from '../src/modules/calendar';

const NOW = Date.UTC(2026, 5, 11, 12, 0, 0);

function connection(id = 'conn-gcal'): Connection {
  return {
    id,
    accountId: 'acct-1',
    provider: 'google-calendar',
    method: 'H',
    scopes: [],
    status: 'active',
    tokenRef: null,
    webhookState: {},
    createdBy: null,
    createdAt: new Date(NOW - 30 * 86_400_000).toISOString(),
    revokedAt: null,
  };
}

describe('google-calendar scan wiring', () => {
  it('resolves the three calendar modules for the provider', () => {
    const ids = modulesForProvider('google-calendar').map((m) => m.id).sort();
    expect(ids).toEqual(['calendar.confirmation-gaps', 'calendar.meeting-load', 'calendar.no-show-churn']);
  });
});

// FIX 5: scan-path fetchEvents must be capped at MAX_SCAN_PAGES (50)
describe('calendar scan page cap (Fix 5)', () => {
  it('stops paginating at MAX_SCAN_PAGES=50 when nextPageToken never clears', async () => {
    // Simulate a reader that always returns nextPageToken — without a cap this would hang.
    let readCalls = 0;
    const reader = {
      read: async (_path: string) => {
        readCalls++;
        // 10 events per page, all with attendees (so calendarMeetingLoad fires)
        const startBase = NOW - readCalls * 4 * 86_400_000;
        const items = Array.from({ length: 10 }, (_, i) => ({
          id: `ev-${readCalls}-${i}`,
          status: 'confirmed',
          start: { dateTime: new Date(startBase + i * 3_600_000).toISOString() },
          end: { dateTime: new Date(startBase + i * 3_600_000 + 5_400_000).toISOString() },
          attendees: [
            { self: true, responseStatus: 'accepted' },
            { self: false, responseStatus: 'accepted' },
          ],
        }));
        return quarantine(
          JSON.stringify({ items, nextPageToken: 'stuck-page-token' }),
          `google-calendar:test:/calendar/v3/calendars/primary/events`,
        );
      },
    };

    const conn = connection();
    const window = scanWindowEndingAt(NOW);
    // Should not throw or hang — must complete within the page cap
    await calendarMeetingLoad.run({ connection: conn, window, reader });

    // MAX_SCAN_PAGES = 50 — reader must not have been called more than 50 times
    expect(readCalls).toBe(50);
  });
});
