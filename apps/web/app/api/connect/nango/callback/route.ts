import 'server-only';
/**
 * POST /api/connect/nango/callback
 *
 * Nango auth webhook receiver (P4 Nango connector lane — Task 9).
 *
 * After the user completes OAuth on Nango's hosted UI, Nango fires a POST
 * to this route with a signed payload. We:
 *  1. Verify the HMAC-SHA256 signature using the Nango SDK before trusting
 *     any payload content (fail-closed: unsigned or invalid → 401).
 *  2. Ignore non-auth events (sync / forward / async_action) — these arrive
 *     at the same webhook URL but require no action from Nibbin.
 *  3. Ignore auth failure events (success:false) — the user denied access;
 *     no connection row to update.
 *  4. Look up the connection row by (provider, nango_connection_id) derived
 *     from the event's connectionId/providerConfigKey. Unknown → 400.
 *  5. Call nango.getConnection() to read back the granted scopes — this is
 *     the SSOT for scope writeback (C8 invariant preserved).
 *  6. Upsert the row: nango_connection_id, nango_provider_config_key, scopes,
 *     status='active'. Idempotent: a replayed callback updates the row again
 *     without error and triggers watch once per call.
 *  7. For Gmail: register/renew the Pub/Sub watch (fire-and-forget, non-fatal).
 *     For Google Calendar: register the push channel (fire-and-forget, non-fatal).
 *
 * connectionId reuse (Plan risk #2):
 *   The connectionId scheme `nibbin-{accountId}-{provider}` is stable across
 *   disconnect→reconnect. Nango treats a POST with an existing connectionId as
 *   a reconnect (token is refreshed in-place); it does NOT create a duplicate.
 *   This is intentional: the same accountId always resolves to the same Nango
 *   connection so token rotation is transparent. Our upsert on the DB row is
 *   also idempotent. If Nango ever rejects a reused connectionId we can append
 *   a timestamp suffix in buildNangoConnectUrl — the callback route doesn't
 *   need to change because it always looks up by connectionId from the event.
 *
 * Webhook signature:
 *   Nango sends `X-Nango-Hmac-Sha256: HMAC-SHA256(NANGO_WEBHOOK_SIGNING_KEY, rawBody)`.
 *   We use the Nango SDK's `verifyIncomingWebhookRequest(rawBody, headers)` which
 *   performs a constant-time comparison. The signing key MUST be set as
 *   `NANGO_WEBHOOK_SIGNING_KEY` (separate from NANGO_SECRET_KEY/apiKey).
 *
 * Env variables consumed:
 *   NANGO_WEBHOOK_SIGNING_KEY  — Nango dashboard → Webhooks → Signing key
 *   GMAIL_PUBSUB_TOPIC         — Google Cloud Pub/Sub topic for Gmail push
 *   CALENDAR_WEBHOOK_ADDRESS   — Public URL for Calendar push notifications
 *   CALENDAR_WEBHOOK_TOKEN     — Token for Calendar push channel verification
 */
import { NextResponse, type NextRequest } from 'next/server';
import type { NangoAuthWebhookBodySuccess, NangoWebhookBody } from '@nangohq/types';
import { getNango } from '../../../../../lib/connectors/nango';
import { serviceClient } from '../../../../../lib/supabase/service';
import { makeGmailClient, makeGoogleCalendarClient } from '@nibbin/connectors';

export const dynamic = 'force-dynamic';

// ── Provider key reverse-mapping ────────────────────────────────────────────

/** Reverse of providerToNangoKey: maps Nango providerConfigKey → Nibbin provider id. */
function nangoKeyToProvider(providerConfigKey: string): string | null {
  const MAP: Record<string, string> = {
    'google-mail': 'gmail',
    'google-calendar': 'google-calendar',
  };
  return MAP[providerConfigKey] ?? null;
}

// ── Scope parsing ────────────────────────────────────────────────────────────

/**
 * Parse Nango's space-separated scope string into the string[] that
 * connections.scopes stores — the same format requireGrantedScope() expects.
 */
function parseScopeString(raw: string): string[] {
  return raw
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// ── Push watch helpers ───────────────────────────────────────────────────────

/**
 * Register/renew the Gmail Pub/Sub watch for the connection.
 * Fire-and-forget: a watch failure must not fail the callback response —
 * the cron gmail-watch-renew route will bootstrap it within 24h.
 */
async function registerGmailWatch(
  nango: ReturnType<typeof getNango>,
  connectionId: string,
  nangoConnectionId: string,
  provider: string,
  scopes: string[],
  accountId: string,
): Promise<void> {
  const topicName = process.env.GMAIL_PUBSUB_TOPIC ?? '';
  if (!topicName) return; // Pub/Sub not configured; cron will bootstrap later

  const conn = {
    id: connectionId,
    accountId,
    provider,
    method: 'N' as const,
    scopes,
    status: 'active' as const,
    tokenRef: null,
    webhookState: {},
    createdBy: null,
    createdAt: new Date().toISOString(),
    revokedAt: null,
    nangoConnectionId,
    nangoProviderConfigKey: 'google-mail',
  };

  const client = makeGmailClient(conn, nango);
  await client.watch(topicName);
}

/**
 * Register a Calendar push watch channel for the connection.
 * Uses the same channel-id scheme as the existing watchEvents() call.
 * Fire-and-forget: failure is non-fatal.
 */
async function registerCalendarWatch(
  nango: ReturnType<typeof getNango>,
  connectionId: string,
  nangoConnectionId: string,
  provider: string,
  scopes: string[],
  accountId: string,
): Promise<void> {
  const address = process.env.CALENDAR_WEBHOOK_ADDRESS ?? '';
  const token = process.env.CALENDAR_WEBHOOK_TOKEN ?? '';
  if (!address) return; // Calendar push not configured

  const conn = {
    id: connectionId,
    accountId,
    provider,
    method: 'N' as const,
    scopes,
    status: 'active' as const,
    tokenRef: null,
    webhookState: {},
    createdBy: null,
    createdAt: new Date().toISOString(),
    revokedAt: null,
    nangoConnectionId,
    nangoProviderConfigKey: 'google-calendar',
  };

  const client = makeGoogleCalendarClient(conn, nango);
  // calendarId 'primary' is the owner's primary calendar — the only one that
  // requires push notifications at connect time (additional calendars are
  // handled by the calendar-delta cron).
  await client.watchEvents(
    'primary',
    `nibbin-cal-${connectionId}`,
    address,
    token,
  );
}

// ── Route handler ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  // 1. Read the raw body as text (required for HMAC verification)
  const rawBody = await request.text();

  // 2. Verify webhook authenticity using the Nango SDK (fail-closed)
  const nango = getNango();
  const headers: Record<string, unknown> = {};
  request.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  const signatureValid = nango.verifyIncomingWebhookRequest(rawBody, headers);
  if (!signatureValid) {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });
  }

  // 3. Parse and validate the event body
  let event: NangoWebhookBody;
  try {
    event = JSON.parse(rawBody) as NangoWebhookBody;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  // 4. Only process successful auth events — everything else is a no-op
  if (event.type !== 'auth') {
    return NextResponse.json({ ok: true, skipped: 'not_auth_event' });
  }
  const authEvent = event as NangoAuthWebhookBodySuccess;
  if (!authEvent.success) {
    // OAuth failure (user denied access etc.) — no connection to activate
    return NextResponse.json({ ok: true, skipped: 'auth_failure' });
  }

  const { connectionId, providerConfigKey } = authEvent;

  // 5. Derive the Nibbin provider id from the Nango providerConfigKey
  const provider = nangoKeyToProvider(providerConfigKey);
  if (!provider) {
    // Unknown integration key — not one we manage
    return NextResponse.json({ error: 'unknown_provider_config_key' }, { status: 400 });
  }

  // 6. Derive account from the connectionId and set up the service client.
  //    Derivation: connectionId = 'nibbin-{accountId}-{provider}' (Task 8).
  const accountId = deriveAccountId(connectionId, provider);
  const svc = serviceClient();

  // 7. Read the granted scopes back from Nango (C8 scope-at-connect invariant)
  //    Done BEFORE the row write so scopes are always from the live Nango token.
  let scopes: string[] = [];
  try {
    const connData = await nango.getConnection(providerConfigKey, connectionId);
    // getConnection returns credentials.raw.scope as a space-separated string
    const rawScope = (connData as { credentials?: { raw?: { scope?: string } } })
      ?.credentials?.raw?.scope ?? '';
    scopes = parseScopeString(rawScope);
  } catch {
    // Nango unavailable — fall back to empty scopes; the cron watch-renew will retry
    // and the scope-check in requireGrantedScope will block write actions safely.
    scopes = [];
  }

  // 8. Look up the PRE-ISSUED connection row for this connect.
  //
  //    SECURITY (cross-account binding): the row must have been pre-issued by
  //    beginConnectAction for THIS exact (account_id, nango_connection_id).
  //    We match on nango_connection_id — the binding Nibbin created server-side
  //    at connect — not just the account parsed from the connectionId string.
  //    A forged connectionId (e.g. an attacker completing OAuth under
  //    connection_id=nibbin-{victimAccount}-{provider}) has NO pre-issued row,
  //    so this lookup returns null and we refuse below. We never INSERT a fresh
  //    row from a parsed-but-unverified connectionId.
  //
  //    Scoped to non-revoked so a revoked row from a previous disconnect does
  //    not block a reconnect (the reconnect pre-issues a fresh pending row).
  const { data: existingRow, error: selectError } = await svc
    .from('connections')
    .select('id, account_id')
    .eq('account_id', accountId)
    .eq('provider', provider)
    .eq('nango_connection_id', connectionId)
    .neq('status', 'revoked')
    .maybeSingle();

  if (selectError) {
    console.error('[nango/callback] connection lookup failed', selectError.message);
    return NextResponse.json({ error: 'lookup_failed' }, { status: 500 });
  }

  if (!existingRow) {
    // No pre-issued row for this (account, connectionId) → reject. Either the
    // connect was never initiated by Nibbin for this account, or the
    // connectionId was forged. Do NOT create a connection from an unverified id.
    console.error('[nango/callback] no pre-issued connection row for connectionId', provider);
    return NextResponse.json({ error: 'connection_not_pre_issued' }, { status: 400 });
  }

  // Pre-issued row exists → activate it (idempotent replay / re-auth).
  const { error: updateError } = await svc
    .from('connections')
    .update({
      nango_connection_id: connectionId,
      nango_provider_config_key: providerConfigKey,
      scopes,
      status: 'active',
    })
    .eq('id', existingRow.id);

  if (updateError) {
    console.error('[nango/callback] connection update failed', existingRow.id, updateError.message);
    return NextResponse.json({ error: 'update_failed' }, { status: 500 });
  }
  const rowId = existingRow.id as string;

  // 9. Trigger push watch registration — fire-and-forget (non-fatal)
  try {
    if (provider === 'gmail') {
      await registerGmailWatch(nango, rowId, connectionId, provider, scopes, accountId);
    } else if (provider === 'google-calendar') {
      await registerCalendarWatch(nango, rowId, connectionId, provider, scopes, accountId);
    }
  } catch (e) {
    // Log but do not fail the response — the cron will bootstrap the watch.
    console.error('[nango/callback] watch registration failed (non-fatal)', provider, (e as Error).message);
  }

  return NextResponse.json({ ok: true, connectionId, provider });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extract the accountId from a Nango connectionId.
 * Format: 'nibbin-{accountId}-{provider}' (set in buildNangoConnectUrl, Task 8).
 *
 * Examples:
 *   'nibbin-acc-123-gmail'            → 'acc-123'
 *   'nibbin-acc-123-google-calendar'  → 'acc-123'
 *
 * Edge case: provider names with hyphens (e.g. 'google-calendar') — we strip
 * the trailing '-{provider}' by using the known provider list. If parsing
 * fails, we return '' (which will result in a row-not-found 400).
 */
function deriveAccountId(connectionId: string, provider: string): string {
  const prefix = 'nibbin-';
  const suffix = `-${provider}`;
  if (!connectionId.startsWith(prefix) || !connectionId.endsWith(suffix)) return '';
  return connectionId.slice(prefix.length, connectionId.length - suffix.length);
}
