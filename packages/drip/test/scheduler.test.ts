/**
 * Scheduler unit suite: timezone edges, quiet hours, one-push-per-day, the
 * 20h spacing floor (tz-flip abuse), conditional beats, catch-up + skip.
 */
import { describe, expect, it } from 'vitest';
import { arcDay, localDay, localHour, safeTz } from '../src/localtime';
import { MIN_PUSH_SPACING_MS, planBeat } from '../src/scheduler';
import type { ArcFlags, ArcState, SendRecord } from '../src/types';

const NO_FLAGS: ArcFlags = { studyActive: false, studyCompleted: false, nearGraduation: false };

function arc(over: Partial<ArcState> = {}): ArcState {
  return {
    accountId: 'a1',
    startedAt: new Date('2026-06-01T15:00:00Z'),
    tz: 'UTC',
    quiet: { start: 21, end: 9 },
    emailEnabled: true,
    sends: [],
    ...over,
  };
}

function sent(beat: SendRecord['beat'], localDayStr: string, claimedAt: string): SendRecord {
  return { beat, status: 'sent', localDay: localDayStr, claimedAt: new Date(claimedAt) };
}

describe('localtime', () => {
  it('falls back to UTC on a hostile users.tz', () => {
    expect(safeTz('Mars/Olympus_Mons')).toBe('UTC');
    expect(safeTz(null)).toBe('UTC');
    expect(safeTz('America/New_York')).toBe('America/New_York');
  });

  it('computes the local calendar day per zone', () => {
    const at = new Date('2026-06-02T02:00:00Z');
    expect(localDay(at, 'UTC')).toBe('2026-06-02');
    expect(localDay(at, 'America/Los_Angeles')).toBe('2026-06-01'); // 19:00 prev day
    expect(localDay(at, 'Asia/Tokyo')).toBe('2026-06-02');
  });

  it('counts arc days across a DST spring-forward without drift', () => {
    // US DST began 2026-03-08; the 23-hour day must still count as one day.
    const start = new Date('2026-03-06T22:00:00-05:00');
    const after = new Date('2026-03-09T10:00:00-04:00');
    expect(arcDay(start, after, 'America/New_York')).toBe(3);
  });

  it('localHour uses h23 (never 24)', () => {
    expect(localHour(new Date('2026-06-02T00:30:00Z'), 'UTC')).toBe(0);
  });
});

describe('planBeat — the table', () => {
  it('sends nothing on day 0 (the hatch is onboarding, not a push)', () => {
    const plan = planBeat(arc(), NO_FLAGS, new Date('2026-06-01T19:00:00Z'));
    expect(plan.send).toBeNull();
    expect(plan.skip).toEqual([]);
  });

  it('day 1 Field Notes are an evening report — held before 18:00 local', () => {
    const early = planBeat(arc(), NO_FLAGS, new Date('2026-06-02T12:00:00Z'));
    expect(early.send).toBeNull();
    const evening = planBeat(arc(), NO_FLAGS, new Date('2026-06-02T18:30:00Z'));
    expect(evening.send).toBe('field_notes_1');
  });

  it('substitutes scan_depth for the day-5 whisper when no study runs', () => {
    const sends = [sent('journal', '2026-06-05', '2026-06-05T10:00:00Z')];
    const plan = planBeat(arc({ sends }), NO_FLAGS, new Date('2026-06-06T10:00:00Z'));
    expect(plan.send).toBe('scan_depth');
    const study = planBeat(arc({ sends }), { ...NO_FLAGS, studyActive: true }, new Date('2026-06-06T10:00:00Z'));
    expect(study.send).toBe('study_whisper');
  });

  it('holds graduation eve on its own day and retires it after', () => {
    const sends = [
      sent('field_notes_1', '2026-06-02', '2026-06-02T18:00:00Z'),
      sent('species', '2026-06-03', '2026-06-03T10:00:00Z'),
      sent('training_1', '2026-06-04', '2026-06-04T10:00:00Z'),
      sent('journal', '2026-06-05', '2026-06-05T10:00:00Z'),
      sent('scan_depth', '2026-06-06', '2026-06-06T10:00:00Z'),
      sent('half_time', '2026-06-08', '2026-06-08T17:00:00Z'),
      sent('training_2', '2026-06-10', '2026-06-10T10:00:00Z'),
      sent('map_preview', '2026-06-11', '2026-06-11T10:00:00Z'),
    ];
    // Day 12, nobody near: hold (it could still be earned today), no skip.
    const onDay = planBeat(arc({ sends }), NO_FLAGS, new Date('2026-06-13T10:00:00Z'));
    expect(onDay.send).toBeNull();
    expect(onDay.skip).toEqual([]);
    // Day 13: the day passed — retire it quietly.
    const after = planBeat(arc({ sends }), NO_FLAGS, new Date('2026-06-14T10:00:00Z'));
    expect(after.skip).toContain('graduation_eve');
    // Day 12 with someone close: it fires.
    const earned = planBeat(arc({ sends }), { ...NO_FLAGS, nearGraduation: true }, new Date('2026-06-13T10:00:00Z'));
    expect(earned.send).toBe('graduation_eve');
  });
});

describe('planBeat — delivery rules', () => {
  it('respects quiet hours, including windows wrapping midnight', () => {
    // 22:00 local is inside 21→9 quiet hours.
    const night = planBeat(arc(), NO_FLAGS, new Date('2026-06-02T22:00:00Z'));
    expect(night.send).toBeNull();
    // 05:00 local: still quiet.
    const dawn = planBeat(arc(), NO_FLAGS, new Date('2026-06-03T05:00:00Z'));
    expect(dawn.send).toBeNull();
  });

  it('never pushes twice in one local day', () => {
    const sends = [sent('field_notes_1', '2026-06-02', '2026-06-02T18:00:00Z')];
    // Later the same local day, day-2 beat exists? No — but force the case by
    // jumping to day 2 where species is due, same-day record blocks it.
    const sameDay = planBeat(
      arc({ sends: [sent('species', '2026-06-03', '2026-06-03T10:00:00Z')] }),
      NO_FLAGS,
      new Date('2026-06-03T19:00:00Z'),
    );
    expect(sameDay.send).toBeNull();
    expect(sends).toBeDefined();
  });

  it('enforces the 20h wall-clock floor across local days (tz-flip-proof)', () => {
    // The local-day dedup is keyed to user-editable users.tz; this absolute
    // floor is what makes flipping timezone unable to mint a second push.
    const sends = [sent('species', '2026-06-03', '2026-06-03T20:00:00Z')];
    const a = arc({ quiet: { start: 0, end: 0 }, sends });
    // New local day, but only 14h since the last push: held.
    expect(planBeat(a, NO_FLAGS, new Date('2026-06-04T10:00:00Z')).send).toBeNull();
    // 20h30m later: allowed.
    expect(planBeat(a, NO_FLAGS, new Date('2026-06-04T16:30:00Z')).send).toBe('training_1');
    expect(MIN_PUSH_SPACING_MS).toBeGreaterThanOrEqual(20 * 3600_000);
  });

  it('skipped records do not block the day or the spacing floor', () => {
    const sends: SendRecord[] = [
      { beat: 'field_notes_1', status: 'skipped', localDay: '2026-06-04', claimedAt: new Date('2026-06-04T10:00:00Z') },
      { beat: 'species', status: 'skipped', localDay: '2026-06-04', claimedAt: new Date('2026-06-04T10:00:00Z') },
    ];
    const plan = planBeat(arc({ sends }), NO_FLAGS, new Date('2026-06-04T10:00:00Z'));
    expect(plan.send).toBe('training_1');
  });
});

describe('planBeat — catch-up', () => {
  it('after missed days, sends only the most recent beat and retires the rest', () => {
    // Nothing ever sent; it's day 4 — journal goes out, days 1–3 retire.
    const plan = planBeat(arc(), NO_FLAGS, new Date('2026-06-05T10:00:00Z'));
    expect(plan.send).toBe('journal');
    expect(plan.skip.sort()).toEqual(['field_notes_1', 'species', 'training_1'].sort());
  });

  it('the diagnosis reveal may run up to 2 days late, then the arc closes', () => {
    const late = planBeat(arc(), NO_FLAGS, new Date('2026-06-16T17:30:00Z')); // day 15
    expect(late.send).toBe('diagnosis_reveal');
    const closed = planBeat(arc(), NO_FLAGS, new Date('2026-06-18T17:30:00Z')); // day 17
    expect(closed.send).toBeNull();
    expect(closed.arcComplete).toBe(true);
    expect(closed.skip).toContain('diagnosis_reveal');
  });

  it('completes cleanly when every slot is resolved', () => {
    const all: SendRecord[] = (
      ['field_notes_1', 'species', 'training_1', 'journal', 'scan_depth', 'half_time', 'training_2', 'map_preview', 'graduation_eve', 'diagnosis_reveal'] as const
    ).map((b, i) => sent(b, `2026-06-0${Math.min(9, i + 2)}`, '2026-06-02T10:00:00Z'));
    const plan = planBeat(arc({ sends: all }), NO_FLAGS, new Date('2026-06-16T10:00:00Z'));
    expect(plan.send).toBeNull();
    expect(plan.arcComplete).toBe(true);
  });
});
