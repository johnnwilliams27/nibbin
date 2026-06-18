/**
 * `nudge.unconfirmed-event` — the CROSS-RESOURCE detect-and-nudge PRIMITIVE
 * (design §2.2), lifted from the `hopper` template. The template program
 * (apps/web programs.ts) delegates to THIS exact implementation, so the
 * primitive and `hopper` stay byte-for-byte identical (parity test) when
 * `withinDays` is at its default (7 = hopper's horizon).
 *
 * Shape: `calendar.read` (google-calendar) → detect upcoming events with an
 * unconfirmed external guest → draft `email.draft` (GMAIL) to the guest. This
 * is the cross-resource case: the read rides the gcal connection, the draft
 * rides the gmail connection. The Composer derives BOTH required connectors
 * from this primitive's `effectiveTools` (server-side, never from the LLM).
 *
 * SAFETY (load-bearing): the Composer never emits the read path or effectArgs —
 * it picks this primitive's id + the schema-validated `withinDays` scalar. The
 * gcal path, the unconfirmed-attendee filter, the sanitized guest address, and
 * the `{eventId, to}` args are built by THIS trusted code. The polite pause
 * throws INSIDE the generator and checks BOTH connectors (Slice-2a P1), never
 * at factory-build time.
 */
import type { ProgramFn } from '../runner';
import type { ProgramStep } from '../types';
import { DAY, calendarEventsPath, parseQuarantinedJson, safeAddress } from './shared';

type ConnectionMap = Record<string, string | undefined>;

export interface NudgeUnconfirmedEventInputs {
  /** Look this many days ahead for unconfirmed guests. Default 7 (hopper). */
  withinDays?: number;
}

interface CalEvent {
  id: string;
  summary?: string;
  status?: string;
  start?: { dateTime?: string };
  attendees?: Array<{ email?: string; self?: boolean; responseStatus?: string }>;
}

/**
 * The parameterized hopper program: the trusted implementation of the
 * `nudge.unconfirmed-event` primitive. `hopperProgram` (apps/web) delegates
 * here. Reads on the google-calendar connection, drafts on the gmail one.
 */
export function nudgeUnconfirmedEvent(
  inputs: NudgeUnconfirmedEventInputs,
  connMap: ConnectionMap,
  nowMs: number,
): ProgramFn {
  const withinDays = inputs.withinDays ?? 7;
  return async function* () {
    const gcal = connMap['google-calendar'];
    if (!gcal) throw new Error('no active google-calendar connection — pausing politely');
    const gmail = connMap.gmail;
    if (!gmail) throw new Error('no active gmail connection — pausing politely');
    const res = yield {
      kind: 'read',
      capability: 'calendar.read',
      connectionId: gcal,
      path: calendarEventsPath(nowMs, nowMs + withinDays * DAY),
    };
    const events = (res && parseQuarantinedJson<{ items?: CalEvent[] }>(res))?.items ?? [];
    const unconfirmed = events.filter(
      (e) =>
        e.status !== 'cancelled' &&
        (e.attendees ?? []).some((a) => !a.self && a.responseStatus !== 'accepted' && a.responseStatus !== 'declined'),
    );
    if (unconfirmed.length === 0) {
      yield { kind: 'compose', payload: { note: 'everything coming up is confirmed' } };
      return;
    }
    const next = unconfirmed[0];
    const when = next.start?.dateTime
      ? new Date(next.start.dateTime).toLocaleString('en-US', { weekday: 'long', hour: 'numeric', minute: '2-digit' })
      : 'our scheduled time';
    const guestEmail = safeAddress((next.attendees ?? []).find((a) => !a.self)?.email);
    yield {
      kind: 'draft',
      capability: 'email.draft',
      connectionId: gmail,
      patternKey: 'email.draft:session-confirmation',
      title: `Confirmation for ${next.summary ?? 'your next session'}`,
      draft:
        `Hi! Looking forward to ${next.summary ?? 'our session'} on ${when}. ` +
        `Just confirming the time still works on your end — if anything changed, ` +
        `reply here and we’ll find a better slot. See you soon!`,
      effectArgs: { eventId: next.id, to: guestEmail },
    } satisfies ProgramStep;
  };
}
