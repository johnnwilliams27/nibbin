import { describe, expect, it } from 'vitest';
import type { ObserverEvent } from '@nibbin/redaction';
import { computeFieldNotes, studyDaysWithActivity } from '../src/core/field-notes.js';

function ev(ts: string, app: string, durationMs: number, kind: ObserverEvent['kind'] = 'ax_delta'): ObserverEvent {
  return {
    v: 1,
    id: `e_${ts}_${app}`,
    ts,
    session: 'ses_1',
    kind,
    app: { bundle_id: `com.example.${app.toLowerCase()}`, name: app },
    window: { title_redacted: 'Doc {NUM}', id: 'w_1' },
    url: null,
    ax: { role_path: 'window/doc', action: 'edit', label_redacted: '', value_class: 'none' },
    input: { keys: 10, clicks: 2, duration_ms: durationMs },
    frame_ref: null,
    redaction: { rules_hit: [], review_state: 'auto' },
  };
}

describe('local Field Notes (on-device daily stats)', () => {
  it('aggregates per-day, ranks apps, counts gaps separately', () => {
    const events = [
      ev('2026-06-12T09:01:00.000Z', 'Mail', 60_000),
      ev('2026-06-12T09:30:00.000Z', 'Studio', 240_000),
      ev('2026-06-12T14:00:00.000Z', 'Mail', 30_000),
      ev('2026-06-12T14:05:00.000Z', 'Observer', 120_000, 'capture_gap'),
      ev('2026-06-13T10:00:00.000Z', 'Mail', 10_000),
    ];
    const notes = computeFieldNotes(events, '2026-06-12');
    expect(notes.eventCount).toBe(3);
    expect(notes.activeMs).toBe(330_000);
    expect(notes.keys).toBe(30);
    expect(notes.clicks).toBe(6);
    expect(notes.gapCount).toBe(1);
    expect(notes.topApps[0]).toEqual({ name: 'Studio', durationMs: 240_000, events: 1 });
    expect(notes.busiestHour).toBe(9);
  });

  it('lists study days with activity', () => {
    const events = [ev('2026-06-12T09:00:00.000Z', 'Mail', 1), ev('2026-06-14T09:00:00.000Z', 'Mail', 1)];
    expect(studyDaysWithActivity(events)).toEqual(['2026-06-12', '2026-06-14']);
  });
});
