/**
 * CalDAV rail [G] — calendar long tail (SPEC §4.3). REPORT calendar-query
 * over the deny-by-default egress proxy; the user's basic credential is
 * pinned to the registered host and can never follow a redirect elsewhere.
 * Read-only: this rail issues REPORT/PROPFIND only.
 */
import { safeFetch, type UnsafeTestOverrides } from '../egress/safe-fetch';
import { quarantine, type QuarantinedContent } from '../quarantine';

export interface CalDavConfig {
  /** user-supplied calendar collection URL (https) */
  url: string;
  username: string;
  password: string;
}

function calDavTimestamp(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export class CalDavRailClient {
  private readonly host: string;

  constructor(
    private readonly config: CalDavConfig,
    private readonly unsafeTestOverrides?: UnsafeTestOverrides,
  ) {
    this.host = new URL(config.url).hostname;
  }

  /** VEVENTs in the window, as quarantined iCalendar data + a count. */
  async fetchEvents(startMs: number, endMs: number): Promise<{ raw: QuarantinedContent; eventCount: number }> {
    const body = `<?xml version="1.0" encoding="utf-8" ?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><d:getetag/><c:calendar-data/></d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VEVENT">
        <c:time-range start="${calDavTimestamp(startMs)}" end="${calDavTimestamp(endMs)}"/>
      </c:comp-filter>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`;
    const auth = Buffer.from(`${this.config.username}:${this.config.password}`, 'utf8').toString('base64');
    const res = await safeFetch(
      this.config.url,
      {
        method: 'REPORT',
        headers: {
          authorization: `Basic ${auth}`,
          'content-type': 'application/xml; charset=utf-8',
          depth: '1',
        },
        body,
      },
      { credentialHosts: [this.host], maxResponseBytes: 4 * 1024 * 1024 },
      this.unsafeTestOverrides,
    );
    if (res.status >= 400) throw new Error(`caldav REPORT returned ${res.status}`);
    const text = res.text();
    const eventCount = (text.match(/BEGIN:VEVENT/g) ?? []).length;
    return { raw: quarantine(text, `caldav:${this.host}:calendar-query`), eventCount };
  }
}
