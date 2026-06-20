/**
 * Google Calendar [H] — scheduling Nibbins, availability answers (SPEC §4.3).
 * calendar.events write scope is requested at connect (C8); the runtime write-grant
 * gate (gateSideEffect) is the primary authority — the local scope-check below is
 * defense-in-depth, not the gate that governs autonomy.
 */
import { HttpConnectorClient } from './base';
import type { Connection } from '../types';
import type { TokenVault } from '../vault';
import type { UnsafeTestOverrides } from '../egress/safe-fetch';

const BASE = 'https://www.googleapis.com';
const SCOPE_EVENTS = 'https://www.googleapis.com/auth/calendar.events';

export interface CalendarEvent {
  id: string;
  status?: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: Array<{ email?: string; responseStatus?: string }>;
  reminders?: { useDefault?: boolean };
  updated?: string;
}

export class GoogleCalendarClient extends HttpConnectorClient {
  constructor(connection: Connection, vault: TokenVault, unsafeTestOverrides?: UnsafeTestOverrides) {
    super(connection, BASE, vault, unsafeTestOverrides);
  }

  async listCalendars(): Promise<{ items?: Array<{ id: string; primary?: boolean }> }> {
    const { data } = await this.readJson<{ items?: Array<{ id: string; primary?: boolean }> }>(
      '/calendar/v3/users/me/calendarList',
    );
    return data;
  }

  /** Events in [timeMinIso, timeMaxIso) — the scan's 12-month window. */
  async listEvents(
    calendarId: string,
    timeMinIso: string,
    timeMaxIso: string,
    pageToken?: string,
  ): Promise<{ items?: CalendarEvent[]; nextPageToken?: string }> {
    const params = new URLSearchParams({
      timeMin: timeMinIso,
      timeMax: timeMaxIso,
      singleEvents: 'true',
      maxResults: '250',
      orderBy: 'startTime',
      // Derived-not-raw: exclude summary (event titles) and attendee email/displayName;
      // scan modules only need status, start/end for duration, and attendee responseStatus/self.
      fields: 'items(id,status,start,end,attendees(responseStatus,self)),nextPageToken',
    });
    if (pageToken) params.set('pageToken', pageToken);
    const { data } = await this.readJson<{ items?: CalendarEvent[]; nextPageToken?: string }>(
      `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
    );
    return data;
  }

  /**
   * Incremental sync via Google's nextSyncToken (poll-friendly; no webhook).
   * Pass `syncToken` from a previous response for delta results; omit on the
   * first call to receive a full (baseline) page plus the initial sync token.
   */
  async listEventsSync(
    calendarId: string,
    syncToken?: string,
    pageToken?: string,
  ): Promise<{ items?: CalendarEvent[]; nextSyncToken?: string; nextPageToken?: string }> {
    const params = new URLSearchParams({
      singleEvents: 'true',
      maxResults: '250',
      // Derived-not-raw: delta path only needs id + status for dispatch; exclude
      // summary (event titles) and attendee email/displayName entirely.
      fields: 'items(id,status),nextPageToken,nextSyncToken',
    });
    if (syncToken) params.set('syncToken', syncToken);
    if (pageToken) params.set('pageToken', pageToken);
    const { data } = await this.readJson<{
      items?: CalendarEvent[];
      nextSyncToken?: string;
      nextPageToken?: string;
    }>(`/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`);
    return data;
  }

  /** Push channel registration (webhook path; verified by channel token). */
  async watchEvents(calendarId: string, channelId: string, address: string, token: string): Promise<unknown> {
    const res = await this.request(`/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/watch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: channelId, type: 'web_hook', address, token }),
    });
    return res.json();
  }

  /** Write path — requires calendar.events scope (defense-in-depth check; the
   *  primary gate is gateSideEffect in the runtime, which enforces the earned-
   *  autonomy model before this method is ever reached). */
  async createEvent(calendarId: string, event: Record<string, unknown>): Promise<{ id?: string }> {
    if (!this.connection.scopes.includes(SCOPE_EVENTS)) {
      throw new Error(`connection lacks ${SCOPE_EVENTS} — runtime gateSideEffect should have blocked this; scope-check is defense-in-depth (C8)`);
    }
    const res = await this.request(`/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(event),
    });
    return res.json() as { id?: string };
  }
}
