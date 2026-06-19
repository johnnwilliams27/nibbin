/**
 * pg-store unit tests: verifies that arcs() reads quiet hours from
 * notification_settings (not drip_arcs), and that missing notification_settings
 * rows fall back to defaults 21/9.
 */
import { describe, it, expect, vi } from 'vitest';
import { pgDripStore } from '../src/pg-store';
import type { Pool, QueryResult } from 'pg';

function makePool(arcRows: Record<string, unknown>[], sendRows: Record<string, unknown>[] = []): Pool {
  let call = 0;
  return {
    query: vi.fn(async () => {
      call += 1;
      if (call === 1) return { rows: arcRows, rowCount: arcRows.length } as unknown as QueryResult;
      return { rows: sendRows, rowCount: sendRows.length } as unknown as QueryResult;
    }),
  } as unknown as Pool;
}

describe('pgDripStore.arcs() — notification_settings join', () => {
  it('uses coalesced quiet_start/quiet_end from notification_settings when present', async () => {
    const pool = makePool([
      {
        account_id: 'acct-1',
        started_at: new Date('2026-06-01T15:00:00Z'),
        status: 'active',
        email_enabled: true,
        quiet_start: 22,  // from coalesce(ns.quiet_start, 21)
        quiet_end: 7,     // from coalesce(ns.quiet_end, 9)
        tz: 'UTC',
        email: 'user@example.com',
      },
    ]);
    const store = pgDripStore(pool);
    const arcs = await store.arcs();

    expect(arcs).toHaveLength(1);
    expect(arcs[0].quiet).toEqual({ start: 22, end: 7 });
    expect(arcs[0].emailEnabled).toBe(true);
  });

  it('falls back to default quiet hours 21/9 when no notification_settings row exists', async () => {
    const pool = makePool([
      {
        account_id: 'acct-2',
        started_at: new Date('2026-06-01T15:00:00Z'),
        status: 'active',
        email_enabled: false,
        quiet_start: 21, // coalesce(null, 21) = 21
        quiet_end: 9,   // coalesce(null, 9) = 9
        tz: 'America/New_York',
        email: 'other@example.com',
      },
    ]);
    const store = pgDripStore(pool);
    const arcs = await store.arcs();

    expect(arcs[0].quiet).toEqual({ start: 21, end: 9 });
  });

  it('the arcs() query uses LEFT JOIN notification_settings and coalesce', async () => {
    const pool = makePool([
      {
        account_id: 'acct-3',
        started_at: new Date('2026-06-01T15:00:00Z'),
        status: 'active',
        email_enabled: true,
        quiet_start: 21,
        quiet_end: 9,
        tz: 'UTC',
        email: 'x@x.com',
      },
    ]);
    const store = pgDripStore(pool);
    await store.arcs();

    const querySpy = pool.query as ReturnType<typeof vi.fn>;
    const firstCallArg: string = querySpy.mock.calls[0][0];

    // The query must reference notification_settings with a LEFT JOIN.
    expect(firstCallArg).toMatch(/left join notification_settings/i);
    // It must coalesce quiet_start with 21 and quiet_end with 9.
    expect(firstCallArg).toMatch(/coalesce\s*\(\s*ns\.quiet_start\s*,\s*21\s*\)/i);
    expect(firstCallArg).toMatch(/coalesce\s*\(\s*ns\.quiet_end\s*,\s*9\s*\)/i);
    // It must NOT select a.quiet_start or a.quiet_end directly from drip_arcs.
    expect(firstCallArg).not.toMatch(/a\.quiet_start/i);
    expect(firstCallArg).not.toMatch(/a\.quiet_end/i);
  });

  it('preserves email_enabled from drip_arcs (not from notification_settings)', async () => {
    const pool = makePool([
      {
        account_id: 'acct-4',
        started_at: new Date('2026-06-01T15:00:00Z'),
        status: 'active',
        email_enabled: false,
        quiet_start: 21,
        quiet_end: 9,
        tz: 'UTC',
        email: 'y@y.com',
      },
    ]);
    const store = pgDripStore(pool);
    const arcs = await store.arcs();

    // email_enabled=false must be preserved as-is
    expect(arcs[0].emailEnabled).toBe(false);
    // The SQL must still select a.email_enabled (from drip_arcs)
    const querySpy = pool.query as ReturnType<typeof vi.fn>;
    const sql: string = querySpy.mock.calls[0][0];
    expect(sql).toMatch(/a\.email_enabled/i);
  });

  it('returns empty array when there are no arcs', async () => {
    const pool = makePool([]);
    const store = pgDripStore(pool);
    const arcs = await store.arcs();
    expect(arcs).toEqual([]);
  });
});
