import { describe, it, expect } from 'vitest';
import { parseObservationSummary, summaryIsClean } from './observation-schema';

const valid = {
  study_id: 's1',
  study_period: { start: '2026-06-20', end: '2026-06-21' },
  total_events_reviewed: 12,
  active_ms: 600000,
  top_apps: [{ name: 'Figma', durationMs: 400000, category: 'design' }],
  busiest_hour: 9,
  workflow_shapes: [{ pattern: 'Figma→Slack', frequency: 3 }],
  gap_count: 1,
};

describe('parseObservationSummary', () => {
  it('accepts a valid summary', () => {
    expect(parseObservationSummary(valid)?.study_id).toBe('s1');
  });
  it('rejects unexpected fields (strict) — guards against future raw-content leak', () => {
    expect(parseObservationSummary({ ...valid, ax_label: 'secret' })).toBeNull();
  });
  it('rejects missing required fields', () => {
    const bad = { ...valid } as Record<string, unknown>;
    delete bad.active_ms;
    expect(parseObservationSummary(bad)).toBeNull();
  });
});

describe('summaryIsClean', () => {
  it('flags a payload that smuggles content matching a battery rule', () => {
    // an email address is a battery-matched token
    const dirty = { ...valid, top_apps: [{ name: 'leak@example.com', durationMs: 1 }] };
    expect(summaryIsClean(dirty)).toBe(false);
  });
  it('passes a clean structural summary', () => {
    expect(summaryIsClean(valid)).toBe(true);
  });
});
