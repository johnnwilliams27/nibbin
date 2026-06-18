/**
 * The M5 DoD test: the whole 14-day arc simulated on a fast clock through
 * the real worker, with an in-memory store that mimics the database's
 * unique-index semantics exactly. Asserts: every beat lands on its day, max
 * one push per local day, nothing in quiet hours, 20h spacing holds,
 * concurrent ticks never double-send, and the arc completes.
 */
import { describe, expect, it } from 'vitest';
import { inQuietHours } from '../src/beats';
import { localDay, localHour } from '../src/localtime';
import { stubArcData } from '../src/stub';
import { tick } from '../src/worker';
import { MIN_PUSH_SPACING_MS } from '../src/scheduler';
import type {
  ArcDataPort,
  ArcRow,
  ArcStatus,
  BeatContent,
  BeatEmail,
  BeatKey,
  DripStore,
  EarnedEvent,
  QuietHours,
  SendRecord,
} from '../src/types';

interface StoreRow extends SendRecord {
  accountId: string;
  slot: BeatKey;
}

/**
 * In-memory DripStore with the same conflict + guard rules as the real
 * pg store: unique (account_id, slot), one non-skipped push per local day,
 * and the 20h spacing floor enforced AT CLAIM TIME against live rows — a
 * stale caller snapshot must not get past it (logic-skeptic M5 P1).
 */
function memoryStore(arcSeed: Omit<ArcRow, 'sends' | 'status'>[], clock: () => Date) {
  const rows: StoreRow[] = [];
  const notifications: { accountId: string; kind: string; sourceId: string }[] = [];
  const statuses = new Map<string, ArcStatus>();

  const store: DripStore = {
    async arcs(): Promise<ArcRow[]> {
      return arcSeed.map((a) => ({
        ...a,
        status: statuses.get(a.accountId) ?? 'active',
        sends: rows.filter((r) => r.accountId === a.accountId).map((r) => ({ ...r })),
      }));
    },
    async claimSend(accountId, beat, slot, day): Promise<boolean> {
      // unique (account_id, slot)
      if (rows.some((r) => r.accountId === accountId && r.slot === slot)) return false;
      // unique (account_id, local_day) where status <> 'skipped'
      if (rows.some((r) => r.accountId === accountId && r.localDay === day && r.status !== 'skipped')) return false;
      // 20h floor against LIVE rows (the insert guard in pg-store.ts)
      const nowMs = clock().getTime();
      if (
        rows.some(
          (r) =>
            r.accountId === accountId &&
            r.status !== 'skipped' &&
            r.claimedAt != null &&
            nowMs - r.claimedAt.getTime() < MIN_PUSH_SPACING_MS,
        )
      )
        return false;
      rows.push({ accountId, beat, slot, status: 'claimed', localDay: day, claimedAt: clock() });
      return true;
    },
    async markSent(accountId, beat) {
      const r = rows.find((x) => x.accountId === accountId && x.beat === beat && x.status === 'claimed');
      if (r) r.status = 'sent';
    },
    async markFailed(accountId, beat) {
      const r = rows.find((x) => x.accountId === accountId && x.beat === beat && x.status === 'claimed');
      if (r) r.status = 'failed';
    },
    async recordSkipped(accountId, skips, day) {
      for (const { beat, slot } of skips) {
        if (rows.some((r) => r.accountId === accountId && r.slot === slot)) continue;
        rows.push({ accountId, beat, slot, status: 'skipped', localDay: day, claimedAt: null });
      }
    },
    async completeArc(accountId) {
      statuses.set(accountId, 'completed');
    },
    async insertEarnedNotification(accountId, event: EarnedEvent) {
      if (notifications.some((n) => n.accountId === accountId && n.kind === event.kind && n.sourceId === event.id)) return;
      notifications.push({ accountId, kind: event.kind, sourceId: event.id });
    },
    async insertBeatNotification(accountId, content: BeatContent) {
      if (notifications.some((n) => n.accountId === accountId && n.kind === 'beat' && n.sourceId === content.key)) return;
      notifications.push({ accountId, kind: 'beat', sourceId: content.key });
    },
  };

  return { store, rows, notifications, statuses };
}

const QUIET: QuietHours = { start: 21, end: 9 };

function runArc(opts: {
  tz: string;
  data?: ArcDataPort;
  email?: (e: BeatEmail) => Promise<boolean>;
  days?: number;
}) {
  const startedAt = new Date('2026-06-01T15:00:00Z'); // the hatch
  let now = new Date(startedAt);
  const clock = () => now;

  const seed = [
    {
      accountId: 'acct-1',
      startedAt,
      tz: opts.tz,
      quiet: QUIET,
      emailEnabled: true,
      email: 'casey@example.com',
    },
  ];
  const mem = memoryStore(seed, clock);
  const emails: BeatEmail[] = [];

  const deps = {
    store: mem.store,
    data: opts.data ?? stubArcData(),
    email: {
      sendBeat: async (e: BeatEmail) => {
        if (opts.email) return opts.email(e);
        emails.push(e);
        return true;
      },
    },
    clock,
    onError: () => {},
  };

  const pushLog: { beat: BeatKey; at: Date; localDay: string; hour: number }[] = [];

  return {
    mem,
    emails,
    pushLog,
    async simulate(): Promise<void> {
      const totalHours = (opts.days ?? 18) * 24;
      for (let h = 0; h < totalHours; h += 1) {
        now = new Date(startedAt.getTime() + h * 3600_000);
        const before = mem.rows.filter((r) => r.status === 'sent').length;
        await tick(deps);
        const after = mem.rows.filter((r) => r.status === 'sent');
        if (after.length > before) {
          const newest = after[after.length - 1];
          pushLog.push({
            beat: newest.beat,
            at: new Date(now),
            localDay: localDay(now, opts.tz),
            hour: localHour(now, opts.tz),
          });
        }
      }
    },
  };
}

describe('the 14-day arc, fast-clock (DoD)', () => {
  it('delivers the full no-Observer arc: right beats, right days, then completes', async () => {
    const sim = runArc({ tz: 'UTC' });
    await sim.simulate();

    const sentBeats = sim.pushLog.map((p) => p.beat);
    expect(sentBeats).toEqual([
      'field_notes_1', // day 1
      'species', // day 2
      'training_1', // day 3
      'journal', // day 4
      'scan_depth', // day 5 — no study running, substitute
      'half_time', // day 7
      'training_2', // day 9
      'map_preview', // day 10
      'diagnosis_reveal', // day 14 (graduation eve skipped: nobody close)
    ]);

    // Each beat on its scheduled local day (start day 2026-06-01 = day 0).
    const dayOf = Object.fromEntries(sim.pushLog.map((p) => [p.beat, p.localDay]));
    expect(dayOf.field_notes_1).toBe('2026-06-02');
    expect(dayOf.scan_depth).toBe('2026-06-06');
    expect(dayOf.half_time).toBe('2026-06-08');
    expect(dayOf.diagnosis_reveal).toBe('2026-06-15');

    // graduation_eve retired quietly, never pushed.
    const grad = sim.mem.rows.find((r) => r.beat === 'graduation_eve');
    expect(grad?.status).toBe('skipped');

    // Every push also landed a leaf, and the email mirror matched 1:1.
    expect(sim.mem.notifications.filter((n) => n.kind === 'beat')).toHaveLength(9);
    expect(sim.emails.map((e) => e.beat)).toEqual(sentBeats);

    // The arc closed.
    expect(sim.mem.statuses.get('acct-1')).toBe('completed');
  });

  it('enforces one push per local day, quiet hours, and the 20h floor', async () => {
    const sim = runArc({ tz: 'America/New_York' });
    await sim.simulate();

    expect(sim.pushLog.length).toBeGreaterThan(0);

    const byDay = new Map<string, number>();
    for (const p of sim.pushLog) {
      byDay.set(p.localDay, (byDay.get(p.localDay) ?? 0) + 1);
      expect(inQuietHours(p.hour, QUIET)).toBe(false);
    }
    for (const [, count] of byDay) expect(count).toBe(1);

    for (let i = 1; i < sim.pushLog.length; i += 1) {
      const gap = sim.pushLog[i].at.getTime() - sim.pushLog[i - 1].at.getTime();
      expect(gap).toBeGreaterThanOrEqual(20 * 3600_000);
    }
  });

  it('study + graduation flags light up the study beats and day 12', async () => {
    const data = stubArcData({
      flags: async () => ({ studyActive: true, nearGraduation: true }),
      nearGraduation: async () => ({ nibbin: 'Scout', approvedDraftsRemaining: 2 }),
    });
    const sim = runArc({ tz: 'UTC', data });
    await sim.simulate();

    const beats = sim.pushLog.map((p) => p.beat);
    expect(beats).toContain('study_whisper');
    expect(beats).toContain('graduation_eve');
    expect(beats).not.toContain('scan_depth');
  });

  it('concurrent ticks never double-send (claim is the gate)', async () => {
    const startedAt = new Date('2026-06-01T15:00:00Z');
    const now = new Date('2026-06-02T18:30:00Z'); // day 1, Field Notes window
    const clock = () => now;
    const mem = memoryStore(
      [{ accountId: 'acct-1', startedAt, tz: 'UTC', quiet: QUIET, emailEnabled: true, email: 'c@example.com' }],
      clock,
    );
    const emails: BeatEmail[] = [];
    const deps = {
      store: mem.store,
      data: stubArcData(),
      email: { sendBeat: async (e: BeatEmail) => (emails.push(e), true) },
      clock,
    };

    await Promise.all([tick(deps), tick(deps), tick(deps)]);

    expect(mem.rows.filter((r) => r.beat === 'field_notes_1')).toHaveLength(1);
    expect(emails).toHaveLength(1);
  });

  it('an email failure marks the beat failed, holds the day, and never retries the beat', async () => {
    let attempts = 0;
    const sim = runArc({
      tz: 'UTC',
      email: async () => {
        attempts += 1;
        throw new Error('provider down');
      },
    });
    await sim.simulate();

    // Every beat claim failed at the email step exactly once — no re-sends
    // of a failed beat, and the failed claim keeps holding its local day.
    const failed = sim.mem.rows.filter((r) => r.status === 'failed');
    expect(failed.length).toBeGreaterThan(0);
    expect(attempts).toBe(failed.length);
    const sent = sim.mem.rows.filter((r) => r.status === 'sent');
    expect(sent).toHaveLength(0);
  });

  it('a stale worker snapshot cannot bypass the 20h floor (the store re-checks)', async () => {
    // Regression (logic-skeptic M5 P1): tick B took its arc snapshot before
    // tick A's 20:00 push, then stalls past local midnight. Its scheduler
    // sees a clean day and approves — the CLAIM must still refuse.
    const startedAt = new Date('2026-06-01T15:00:00Z');
    let now = new Date('2026-06-03T20:00:00Z'); // day 2, late push
    const clock = () => now;
    const seed = [{ accountId: 'acct-1', startedAt, tz: 'UTC', quiet: { start: 0, end: 0 }, emailEnabled: false, email: 'c@example.com' }];
    const mem = memoryStore(seed, clock);

    // Tick A pushes species at 20:00 on day 2.
    expect(await mem.store.claimSend('acct-1', 'species', 'species', '2026-06-03')).toBe(true);

    // Tick B resumes at 10:01 next day holding a PRE-CLAIM snapshot.
    const staleArc: ArcRow = { ...seed[0], status: 'active', sends: [] };
    now = new Date('2026-06-04T10:01:00Z'); // 14h later — scheduler would approve
    const staleDeps = {
      store: { ...mem.store, arcs: async () => [staleArc] },
      data: stubArcData(),
      email: { sendBeat: async () => true },
      clock,
    };
    await tick(staleDeps);
    // No second push landed inside the floor.
    const nonSkipped = mem.rows.filter((r) => r.status !== 'skipped');
    expect(nonSkipped).toHaveLength(1);
    expect(nonSkipped[0].beat).toBe('species');
  });

  it('the day-5 slot can never deliver twice, even when the study flag flips between ticks', async () => {
    // Regression (logic-skeptic M5 P1): scan_depth and study_whisper are one
    // table slot under two keys — slot uniqueness must arbitrate.
    const startedAt = new Date('2026-06-01T15:00:00Z');
    const now = new Date('2026-06-06T10:00:00Z');
    const clock = () => now;
    const mem = memoryStore(
      [{ accountId: 'acct-1', startedAt, tz: 'UTC', quiet: { start: 21, end: 9 }, emailEnabled: false, email: 'c@example.com' }],
      clock,
    );
    expect(await mem.store.claimSend('acct-1', 'scan_depth', 'study_whisper', '2026-06-06')).toBe(true);
    // Flag flipped; a stale tick tries the other key of the same slot a day later.
    expect(await mem.store.claimSend('acct-1', 'study_whisper', 'study_whisper', '2026-06-07')).toBe(false);
  });

  it('a graduation after the arc completes still lands its leaf', async () => {
    // Regression (logic-skeptic M5 P1): School events fire whenever earned,
    // independent of the calendar — including after day 14 closed the arc.
    const startedAt = new Date('2026-06-01T15:00:00Z');
    const now = new Date('2026-06-21T12:00:00Z'); // day 20
    const clock = () => now;
    const mem = memoryStore(
      [{ accountId: 'acct-1', startedAt, tz: 'UTC', quiet: { start: 21, end: 9 }, emailEnabled: true, email: 'c@example.com' }],
      clock,
    );
    await mem.store.completeArc('acct-1');

    const event: EarnedEvent = {
      id: 'evt-9', kind: 'graduation', nibbin: 'Scout', detail: 'Verified accuracy over 25 runs.',
      nibbinId: 'nib-9', species: 'Sprout', stage: 'grad', palette: null, accessory: null, marking: null,
    };
    const emails: BeatEmail[] = [];
    await tick({
      store: mem.store,
      data: stubArcData({ earnedEvents: async () => [event] }),
      email: { sendBeat: async (e) => (emails.push(e), true) },
      clock,
    });

    expect(mem.notifications.filter((n) => n.kind === 'graduation')).toHaveLength(1);
    // And no beat push happened on the completed arc.
    expect(mem.rows).toHaveLength(0);
    expect(emails).toHaveLength(0);
  });

  it('earned events land as leaves whenever they fire, idempotently, outside the daily push', async () => {
    const event: EarnedEvent = {
      id: 'evt-1', kind: 'evolution', nibbin: 'Scout', detail: 'Scout grew into a Senior.',
      nibbinId: 'nib-1', species: 'Sprout', stage: 'senior', palette: null, accessory: null, marking: null,
    };
    const data = stubArcData({ earnedEvents: async () => [event] });
    const sim = runArc({ tz: 'UTC', data, days: 3 });
    await sim.simulate();

    // Delivered once despite firing on every hourly tick.
    const earned = sim.mem.notifications.filter((n) => n.kind === 'evolution');
    expect(earned).toHaveLength(1);
    // And the daily beat still went out — events don't consume the push slot.
    expect(sim.pushLog.map((p) => p.beat)).toContain('field_notes_1');
  });
});
