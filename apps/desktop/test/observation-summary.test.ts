import { describe, it, expect } from 'vitest';
import { deriveWorkflowShapes, buildObservationSummary } from '../src/core/observation-summary.js';
import type { ObserverEvent } from '@nibbin/redaction';

function ev(app: string, ts: string, durationMs = 1000): ObserverEvent {
  return {
    v: 1,
    id: `${app}-${ts}`,
    ts,
    session: 'ses_1',
    kind: 'snapshot',
    app: { name: app, bundle_id: `com.${app}` },
    window: { title_redacted: 'X', id: 'w_1' },
    url: null,
    ax: null,
    input: { duration_ms: durationMs, keys: 1, clicks: 1 },
    frame_ref: null,
    redaction: { rules_hit: [], review_state: 'auto' },
  } as unknown as ObserverEvent;
}

describe('deriveWorkflowShapes', () => {
  it('collapses same-app runs and counts length-2/3 app transitions only', () => {
    const events = [
      ev('Figma', '2026-06-20T09:00:00Z'),
      ev('Figma', '2026-06-20T09:01:00Z'), // collapsed
      ev('Slack', '2026-06-20T09:02:00Z'),
      ev('Figma', '2026-06-20T09:03:00Z'),
      ev('Slack', '2026-06-20T09:04:00Z'),
    ];
    const shapes = deriveWorkflowShapes(events);
    const fs = shapes.find((s) => s.pattern === 'Figma→Slack');
    expect(fs?.frequency).toBe(2);
    // no raw content anywhere in patterns — app names only
    for (const s of shapes) expect(s.pattern).not.toMatch(/[Xx]title|redacted|http/);
  });
});

describe('buildObservationSummary', () => {
  it('returns null below the floor (<10 events or <5min active)', () => {
    const summary = buildObservationSummary([ev('Figma', '2026-06-20T09:00:00Z')], 'study-1');
    expect(summary).toBeNull();
  });

  it('carries only structural fields and no raw event content', () => {
    const events = Array.from({ length: 12 }, (_, i) =>
      ev(i % 2 ? 'Slack' : 'Figma', `2026-06-20T09:${String(i).padStart(2, '0')}:00Z`, 40_000),
    );
    const summary = buildObservationSummary(events, 'study-1')!;
    expect(summary.study_id).toBe('study-1');
    expect(summary.total_events_reviewed).toBe(12);
    expect(summary.top_apps[0].name).toBeDefined();
    const json = JSON.stringify(summary);
    expect(json).not.toMatch(/title_redacted|label_redacted|bundle_id|"id"/);
  });
});
