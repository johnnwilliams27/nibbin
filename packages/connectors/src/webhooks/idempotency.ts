/**
 * Webhook idempotency + replay windows (SPEC §6.5/§6.9): a verified webhook
 * is processed at most once. The store's uniqueness constraint is the
 * authority — replays (and races between two web instances) land on the same
 * (provider, event id) key and lose.
 */
import { safeFetch, type UnsafeTestOverrides } from '../egress/safe-fetch';

export interface WebhookEventStore {
  /**
   * Record the event id; true if this is the first time it was seen.
   * False = duplicate/replay — the caller must drop the event.
   */
  recordOnce(provider: string, providerEventId: string, connectionId?: string): Promise<boolean>;
  /**
   * Read-only: has this event id already been recorded? Unlike recordOnce this
   * does NOT claim the key. The connector-poll dispatch (issue #113) consults it
   * BEFORE triggering a Nibbin so an already-fired Nibbin is skipped on a capped
   * re-poll, without claiming the key before the run actually starts (which
   * would re-break claim-then-commit / P2.5).
   */
  hasRecord(provider: string, providerEventId: string): Promise<boolean>;
}

export class MemoryWebhookEventStore implements WebhookEventStore {
  private seen = new Set<string>();

  async recordOnce(provider: string, providerEventId: string): Promise<boolean> {
    const key = `${provider}${String.fromCharCode(0)}${providerEventId}`;
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    return true;
  }

  async hasRecord(provider: string, providerEventId: string): Promise<boolean> {
    // recordOnce keys with a NUL separator (String.fromCharCode(0)); the read
    // MUST use the same separator or it never matches the claim.
    return this.seen.has(`${provider}${String.fromCharCode(0)}${providerEventId}`);
  }
}

/** Backed by public.webhook_events and its unique constraint (M3 migration). */
export class SupabaseWebhookEventStore implements WebhookEventStore {
  private readonly host: string;

  constructor(
    private readonly supabaseUrl: string,
    private readonly serviceKey: string,
    private readonly unsafeTestOverrides?: UnsafeTestOverrides,
  ) {
    const url = new URL(supabaseUrl);
    if (url.protocol !== 'https:' && !unsafeTestOverrides?.allowHttp) {
      throw new Error('supabaseUrl must be https');
    }
    this.host = url.hostname;
  }

  async recordOnce(provider: string, providerEventId: string, connectionId?: string): Promise<boolean> {
    const res = await safeFetch(
      `${this.supabaseUrl.replace(/\/$/, '')}/rest/v1/webhook_events`,
      {
        method: 'POST',
        headers: {
          apikey: this.serviceKey,
          authorization: `Bearer ${this.serviceKey}`,
          'content-type': 'application/json',
          prefer: 'return=minimal',
        },
        body: JSON.stringify({
          provider,
          provider_event_id: providerEventId,
          connection_id: connectionId ?? null,
        }),
      },
      { allowedHosts: [this.host] },
      this.unsafeTestOverrides,
    );
    if (res.status === 201) return true;
    if (res.status === 409) return false; // unique violation — replay
    throw new Error(`webhook_events insert failed with status ${res.status}`);
  }

  async hasRecord(provider: string, providerEventId: string): Promise<boolean> {
    // Key on (provider, provider_event_id) ONLY — that is exactly the unique
    // constraint recordOnce's claim is enforced by (M3 migration). connection_id
    // is deliberately NOT filtered: it is not part of that constraint, so a
    // connection-scoped read would silently diverge from the provider+event-scoped
    // claim if a future dedupeKey ever stopped embedding the connection.
    const params = new URLSearchParams({
      provider: `eq.${provider}`,
      provider_event_id: `eq.${providerEventId}`,
      select: 'provider_event_id',
      limit: '1',
    });
    const res = await safeFetch(
      `${this.supabaseUrl.replace(/\/$/, '')}/rest/v1/webhook_events?${params}`,
      {
        method: 'GET',
        headers: {
          apikey: this.serviceKey,
          authorization: `Bearer ${this.serviceKey}`,
          accept: 'application/json',
        },
      },
      { allowedHosts: [this.host] },
      this.unsafeTestOverrides,
    );
    if (res.status !== 200) throw new Error(`webhook_events read failed with status ${res.status}`);
    const rows = (await res.json()) as unknown[];
    return Array.isArray(rows) && rows.length > 0;
  }
}

/** Reject events older (or further in the future) than the declared window. */
export function isWithinReplayWindow(eventTimestampMs: number, replayWindowSecs: number, nowMs = Date.now()): boolean {
  return Math.abs(nowMs - eventTimestampMs) <= replayWindowSecs * 1000;
}
