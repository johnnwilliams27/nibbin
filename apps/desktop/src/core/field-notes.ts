/**
 * Local Field Notes (SPEC §5): daily study stats computed and rendered
 * ON-DEVICE. They power the study beats in §4.5 without uploading anything —
 * C1/C7 hold because this module is pure math over already-redacted events
 * and its output never leaves the process. No network, no IO.
 */
import type { ObserverEvent } from '@nibbin/redaction';

export interface AppStat {
  name: string;
  durationMs: number;
  events: number;
}

export interface FieldNotesDay {
  day: string;
  eventCount: number;
  activeMs: number;
  keys: number;
  clicks: number;
  topApps: AppStat[];
  gapCount: number;
  /** Repeated role_path+action steps seen today (workflow shape, no content). */
  busiestHour: number | null;
}

export function computeFieldNotes(events: ObserverEvent[], day: string): FieldNotesDay {
  const todays = events.filter((e) => e.ts.slice(0, 10) === day);

  const apps = new Map<string, AppStat>();
  let activeMs = 0;
  let keys = 0;
  let clicks = 0;
  let gapCount = 0;
  const hourBuckets = new Map<number, number>();

  for (const e of todays) {
    if (e.kind === 'capture_gap') {
      gapCount += 1;
      continue;
    }
    const stat = apps.get(e.app.name) ?? { name: e.app.name, durationMs: 0, events: 0 };
    stat.events += 1;
    if (e.input) {
      stat.durationMs += e.input.duration_ms;
      activeMs += e.input.duration_ms;
      keys += e.input.keys;
      clicks += e.input.clicks;
    }
    apps.set(e.app.name, stat);

    const hour = new Date(e.ts).getUTCHours();
    hourBuckets.set(hour, (hourBuckets.get(hour) ?? 0) + 1);
  }

  let busiestHour: number | null = null;
  let busiestCount = 0;
  for (const [hour, count] of hourBuckets) {
    if (count > busiestCount) {
      busiestHour = hour;
      busiestCount = count;
    }
  }

  return {
    day,
    eventCount: todays.filter((e) => e.kind !== 'capture_gap').length,
    activeMs,
    keys,
    clicks,
    topApps: [...apps.values()].sort((a, b) => b.durationMs - a.durationMs || b.events - a.events).slice(0, 5),
    gapCount,
    busiestHour,
  };
}

/** Days of the study that produced at least one event. */
export function studyDaysWithActivity(events: ObserverEvent[]): string[] {
  return [...new Set(events.filter((e) => e.kind !== 'capture_gap').map((e) => e.ts.slice(0, 10)))].sort();
}
