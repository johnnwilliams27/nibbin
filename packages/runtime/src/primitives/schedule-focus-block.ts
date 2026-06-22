/**
 * `schedule.focus-block` — the CALENDAR WRITE primitive (Task 3 proof).
 *
 * Reads the next `withinDays` calendar days (google-calendar), detects the
 * FIRST weekday (Mon–Fri) that has `>= minMeetings` non-cancelled events
 * ("overloaded"), and drafts a 90-minute Focus block at 08:00 local on that
 * day as a `calendar.event-create` step.
 *
 * This is the end-to-end proof that synthesis→action works for a SECOND
 * connector. Everything downstream already existed (client `createEvent`,
 * executor branch `engine.ts:369`, capability descriptor, poll flow); this
 * primitive is the missing verb.
 *
 * SAFETY (load-bearing):
 *  - Single connector: google-calendar powers BOTH the read and the write.
 *  - The executor (`engine.ts:369`) reads `args.args.event` and
 *    `args.args.calendarId`. `effectArgs.event` here IS that object — passed
 *    verbatim to `GoogleCalendarClient.createEvent(calendarId, event)`.
 *  - NO reserved native-draft keys (`nativeDraft`/`nativeDraftRef`/`dismiss`)
 *    are set. `calendar.event-create` has `nativeDraft:false` on its descriptor,
 *    so the runner never calls the executor for a native-draft mirror at Draft
 *    level. Exactly one executor call occurs at Send level.
 *  - The start/end ISO strings are computed deterministically from `nowMs` —
 *    no `Date.now()` inside the generator.
 */
import type { ProgramFn } from '../runner';
import type { ProgramStep } from '../types';
import { DAY, calendarEventsPath, parseQuarantinedJson } from './shared';

type ConnectionMap = Record<string, string | undefined>;

export interface ScheduleFocusBlockInputs {
  /** Look this many days ahead. Default 7. */
  withinDays?: number;
  /** Minimum non-cancelled events on a day to be "overloaded". Default 4. */
  minMeetings?: number;
}

interface CalEvent {
  id: string;
  summary?: string;
  status?: string;
  start?: { dateTime?: string; date?: string };
}

/**
 * Returns the ISO date string "YYYY-MM-DD" for the day that is `offsetDays`
 * full days after the date containing `nowMs` (UTC), deterministically from
 * `nowMs`. Used to compute focus-block start/end without ever calling
 * `Date.now()` inside the generator.
 */
function isoDateAt(nowMs: number, offsetDays: number): string {
  const d = new Date(nowMs + offsetDays * DAY);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Returns the UTC day-of-week (0=Sun … 6=Sat) of the day `offsetDays` past
 * the date containing `nowMs`.
 */
function dayOfWeekAt(nowMs: number, offsetDays: number): number {
  return new Date(nowMs + offsetDays * DAY).getUTCDay();
}

/**
 * Trusted implementation of the `schedule.focus-block` primitive. Single
 * connector: google-calendar for both the read and the write.
 */
export function scheduleFocusBlock(
  inputs: ScheduleFocusBlockInputs,
  connMap: ConnectionMap,
  nowMs: number,
): ProgramFn {
  const withinDays = inputs.withinDays ?? 7;
  const minMeetings = inputs.minMeetings ?? 4;

  return async function* () {
    const gcal = connMap['google-calendar'];
    if (!gcal) throw new Error('no active google-calendar connection — pausing politely');

    const res = yield {
      kind: 'read',
      capability: 'calendar.read',
      connectionId: gcal,
      path: calendarEventsPath(nowMs, nowMs + withinDays * DAY),
    };

    const events = (res && parseQuarantinedJson<{ items?: CalEvent[] }>(res))?.items ?? [];

    // Group non-cancelled events by UTC calendar date string "YYYY-MM-DD".
    const byDay = new Map<string, number>();
    for (const e of events) {
      if (e.status === 'cancelled') continue;
      const dateStr = e.start?.dateTime
        ? e.start.dateTime.slice(0, 10)
        : (e.start?.date ?? '');
      if (!dateStr) continue;
      byDay.set(dateStr, (byDay.get(dateStr) ?? 0) + 1);
    }

    // Find the FIRST weekday (Mon–Fri, offset 0..withinDays-1) with >= minMeetings.
    let overloadedDate: string | null = null;
    for (let offset = 0; offset < withinDays; offset++) {
      const dow = dayOfWeekAt(nowMs, offset);
      if (dow === 0 || dow === 6) continue; // skip weekends
      const dateStr = isoDateAt(nowMs, offset);
      if ((byDay.get(dateStr) ?? 0) >= minMeetings) {
        overloadedDate = dateStr;
        break;
      }
    }

    if (!overloadedDate) {
      yield { kind: 'compose', payload: { note: 'no overloaded days coming up' } };
      return;
    }

    // Propose a 90-minute focus block at 08:00 UTC on the overloaded day.
    // Use ISO dateTime strings (the Google Calendar API requires them for
    // timed events; an all-day event would use `date` instead).
    const startIso = `${overloadedDate}T08:00:00Z`;
    const endIso   = `${overloadedDate}T09:30:00Z`;

    yield {
      kind: 'draft',
      capability: 'calendar.event-create',
      connectionId: gcal,
      patternKey: 'calendar.event-create:focus-block',
      title: 'Focus block',
      draft: 'Proposed a 2-hour focus block on your busiest upcoming day.',
      effectArgs: {
        event: {
          summary: 'Focus block',
          start: { dateTime: startIso },
          end:   { dateTime: endIso },
        },
      },
    } satisfies ProgramStep;
  };
}
