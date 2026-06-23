/**
 * On-device derivation of the ObservationSummary (P3, Option A). PURE math over
 * the post-privacy-review survivor events. C1/C7: only structural derivations
 * (app names, timing, transition shapes) — never any *_redacted content, URL,
 * keystroke text, or event ids — appear in the output. Nothing here does IO.
 */
import type { ObserverEvent } from '@nibbin/redaction';
import { studyDaysWithActivity } from './field-notes.js';

export interface ObservationApp {
  name: string;
  durationMs: number;
  category?: string;
}

export interface WorkflowShape {
  pattern: string; // app-name transition only, e.g. "Figma→Slack"
  frequency: number;
}

export interface ObservationSummary {
  study_id: string;
  study_period: { start: string; end: string };
  total_events_reviewed: number;
  active_ms: number;
  top_apps: ObservationApp[];
  busiest_hour: number | null;
  workflow_shapes: WorkflowShape[];
  gap_count: number;
}

const MIN_EVENTS = 10;
const MIN_ACTIVE_MS = 5 * 60 * 1000;

/** Collapse runs of the same app, then count length-2 and length-3 transitions. */
export function deriveWorkflowShapes(events: ObserverEvent[]): WorkflowShape[] {
  const ordered = [...events]
    .filter((e) => e.kind !== 'capture_gap')
    .sort((a, b) => a.ts.localeCompare(b.ts))
    .map((e) => e.app.name);
  const collapsed: string[] = [];
  for (const name of ordered) {
    if (collapsed[collapsed.length - 1] !== name) collapsed.push(name);
  }
  const counts = new Map<string, number>();
  const bump = (k: string) => counts.set(k, (counts.get(k) ?? 0) + 1);
  for (let i = 0; i + 1 < collapsed.length; i++) {
    bump(`${collapsed[i]}→${collapsed[i + 1]}`);
    if (i + 2 < collapsed.length) bump(`${collapsed[i]}→${collapsed[i + 1]}→${collapsed[i + 2]}`);
  }
  return [...counts.entries()]
    .map(([pattern, frequency]) => ({ pattern, frequency }))
    .filter((s) => s.frequency > 1)
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, 5);
}

export function buildObservationSummary(
  events: ObserverEvent[],
  studyId: string,
): ObservationSummary | null {
  const real = events.filter((e) => e.kind !== 'capture_gap');
  const days = studyDaysWithActivity(events);
  let activeMs = 0;
  const apps = new Map<string, ObservationApp>();
  let busiest: number | null = null;
  let busiestCount = 0;
  const hours = new Map<number, number>();
  let gapCount = 0;
  for (const e of events) {
    if (e.kind === 'capture_gap') { gapCount++; continue; }
    const a = apps.get(e.app.name) ?? { name: e.app.name, durationMs: 0 };
    if (e.input) { a.durationMs += e.input.duration_ms; activeMs += e.input.duration_ms; }
    apps.set(e.app.name, a);
    const h = new Date(e.ts).getUTCHours();
    hours.set(h, (hours.get(h) ?? 0) + 1);
  }
  for (const [h, c] of hours) if (c > busiestCount) { busiest = h; busiestCount = c; }

  if (real.length < MIN_EVENTS || activeMs < MIN_ACTIVE_MS) return null;

  return {
    study_id: studyId,
    study_period: { start: days[0] ?? '', end: days[days.length - 1] ?? '' },
    total_events_reviewed: real.length,
    active_ms: activeMs,
    top_apps: [...apps.values()].sort((a, b) => b.durationMs - a.durationMs).slice(0, 5),
    busiest_hour: busiest,
    workflow_shapes: deriveWorkflowShapes(events),
    gap_count: gapCount,
  };
}
