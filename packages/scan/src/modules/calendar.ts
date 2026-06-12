/**
 * Calendar scan modules (§4.4): meeting load, no-show/reschedule churn,
 * confirmation/reminder gaps. Adapter: google-calendar (primary calendar).
 */
import type { ScanContext, ScanModule } from '@nibbin/connectors';
import { makeFinding, round1, weeksIn } from '../findings';
import { parseQuarantinedJson } from '../unwrap';

interface GcalEvent {
  id: string;
  status?: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: Array<{ email?: string; responseStatus?: string; self?: boolean }>;
}

async function fetchEvents(ctx: ScanContext): Promise<GcalEvent[]> {
  const params = new URLSearchParams({
    timeMin: new Date(ctx.window.startMs).toISOString(),
    timeMax: new Date(ctx.window.endMs).toISOString(),
    singleEvents: 'true',
    maxResults: '250',
    orderBy: 'startTime',
  });
  const res = parseQuarantinedJson<{ items?: GcalEvent[] }>(
    await ctx.reader.read(`/calendar/v3/calendars/primary/events?${params}`),
  );
  return res?.items ?? [];
}

function durationHours(e: GcalEvent): number {
  const s = e.start?.dateTime ? Date.parse(e.start.dateTime) : NaN;
  const f = e.end?.dateTime ? Date.parse(e.end.dateTime) : NaN;
  if (!Number.isFinite(s) || !Number.isFinite(f) || f <= s) return 1;
  return (f - s) / 3_600_000;
}

function others(e: GcalEvent): Array<{ email?: string; responseStatus?: string }> {
  return (e.attendees ?? []).filter((a) => !a.self);
}

export const calendarMeetingLoad: ScanModule = {
  id: 'calendar.meeting-load',
  providers: ['google-calendar'],
  async run(ctx) {
    const events = await fetchEvents(ctx);
    const meetings = events.filter((e) => e.status !== 'cancelled' && others(e).length >= 1);
    const weeks = weeksIn(ctx.window);
    const perWeek = meetings.length / weeks;
    if (perWeek < 3) return [];
    const hoursPerWeek = round1(meetings.reduce((s, e) => s + durationHours(e), 0) / weeks);
    return [
      makeFinding(
        this.id,
        ctx.connection.id,
        `You sit in about ${round1(perWeek)} booked sessions a week — roughly ${hoursPerWeek} hours of calendar time.`,
        {
          hoursPerWeek,
          basis: `${meetings.length} events with attendees in ${Math.round(weeks)} weeks; summed scheduled duration`,
        },
        { meetings: meetings.length, perWeek: round1(perWeek) },
      ),
    ];
  },
};

export const calendarNoShowChurn: ScanModule = {
  id: 'calendar.no-show-churn',
  providers: ['google-calendar'],
  async run(ctx) {
    const events = await fetchEvents(ctx);
    const churned = events.filter(
      (e) => e.status === 'cancelled' || others(e).some((a) => a.responseStatus === 'declined'),
    );
    if (churned.length < 4) return [];
    const weeks = weeksIn(ctx.window);
    return [
      makeFinding(
        this.id,
        ctx.connection.id,
        `${churned.length} sessions were cancelled or declined in the last ${Math.round(weeks)} weeks — slots you could have refilled with a confirmation nudge.`,
        {
          hoursPerWeek: round1((churned.reduce((s, e) => s + durationHours(e), 0) / weeks)),
          basis: `${churned.length} cancelled/declined events in the window; scheduled duration counted as lost time`,
        },
        { churned: churned.length },
      ),
    ];
  },
};

export const calendarConfirmationGaps: ScanModule = {
  id: 'calendar.confirmation-gaps',
  providers: ['google-calendar'],
  async run(ctx) {
    const events = await fetchEvents(ctx);
    const withGuests = events.filter((e) => e.status !== 'cancelled' && others(e).length >= 1);
    const unconfirmed = withGuests.filter((e) =>
      others(e).every((a) => a.responseStatus !== 'accepted'),
    );
    if (unconfirmed.length < 5 || withGuests.length < 10) return [];
    const sharePct = Math.round((unconfirmed.length / withGuests.length) * 100);
    return [
      makeFinding(
        this.id,
        ctx.connection.id,
        `${sharePct}% of your booked sessions never got a confirmed yes from the other side — that's where no-shows come from.`,
        {
          hoursPerWeek: round1((unconfirmed.length * 10) / 60 / weeksIn(ctx.window)),
          basis: `${unconfirmed.length} of ${withGuests.length} attendee events with no accepted response; ~10 min each to chase by hand`,
        },
        { unconfirmed: unconfirmed.length, withGuests: withGuests.length, sharePct },
      ),
    ];
  },
};

export const CALENDAR_MODULES = [calendarMeetingLoad, calendarNoShowChurn, calendarConfirmationGaps];
