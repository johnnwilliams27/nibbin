import 'server-only';
import { createHmac } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

export function makeSweepHmac(accountId: string, connectionId: string): string | null {
  const secret = process.env.SWEEP_HMAC_SECRET;
  if (!secret) return null;
  return createHmac('sha256', secret).update(`${accountId}:${connectionId}`).digest('hex');
}

/** Fire-and-forget POST to the onboarding sweep worker (gmail only; no-op without a secret). */
export function dispatchSweepFireAndForget(
  baseUrl: string,
  accountId: string,
  connectionId: string,
  provider: string,
): void {
  if (provider !== 'gmail') return;
  const hmac = makeSweepHmac(accountId, connectionId);
  if (!hmac) return;
  const sweepUrl = new URL('/api/sweep/gmail/onboarding', baseUrl).href;
  fetch(sweepUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accountId, connectionId, hmac }),
    signal: AbortSignal.timeout(5_000),
  }).catch(() => {});
}

/**
 * After a connection is established (or a panel toggle), record consent if the
 * user opted in and dispatch the sweep iff the connection now carries consent.
 * The worker re-checks consent (fail-closed); this is the caller-side gate.
 */
export async function onGmailConnected(
  svc: SupabaseClient,
  baseUrl: string,
  connectionId: string,
  sweepConsent: boolean,
  userId: string,
): Promise<{ dispatched: boolean }> {
  const { data: conn } = await svc
    .from('connections')
    .select('account_id, provider, sweep_consent_at')
    .eq('id', connectionId)
    .maybeSingle();
  if (!conn || conn.provider !== 'gmail') return { dispatched: false };

  let consentAt = conn.sweep_consent_at as string | null;
  if (sweepConsent && !consentAt) {
    await svc
      .from('connections')
      .update({ sweep_consent_at: new Date().toISOString(), sweep_consent_by: userId })
      .eq('id', connectionId);
    consentAt = 'set';
  }
  if (!consentAt) return { dispatched: false };

  const hmac = makeSweepHmac(conn.account_id as string, connectionId);
  if (!hmac) return { dispatched: false };
  dispatchSweepFireAndForget(baseUrl, conn.account_id as string, connectionId, 'gmail');
  return { dispatched: true };
}
