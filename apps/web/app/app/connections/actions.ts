'use server';

import { redirect } from 'next/navigation';
import { appSession } from '../../../lib/auth/app-session';
import { serviceClient } from '../../../lib/supabase/service';
import { getGoogleOAuthConfig } from '../../../lib/connections/google-oauth-env';
import { loadTesterAllowlist } from '../../../lib/connections/tester-allowlist';
import { storePending } from '../../../lib/connections/pending';
import { beginConnect } from '../../../lib/connections/begin';
import { beginWriteConnect } from '../../../lib/connections/begin-write';
import { grantWriteCapability } from '../../../lib/connections/grants';
import { revokeAndSuspend } from '../../../lib/connections/revoke-connection';

export async function beginConnectAction(formData: FormData): Promise<void> {
  const provider = String(formData.get('provider') ?? '');
  const returnTo = (formData.get('returnTo') as string) || undefined;
  const resumeTemplate = (formData.get('resumeTemplate') as string) || undefined;

  const { user, accountId } = await appSession();
  const svc = serviceClient();
  const { url } = await beginConnect(
    { provider, accountId, userId: user.id, userEmail: user.email ?? null, returnTo, resumeTemplate },
    {
      config: getGoogleOAuthConfig(),
      allowlistFor: (p) => loadTesterAllowlist(p, svc),
      save: (input) => storePending(input, svc),
      nowMs: Date.now(),
    },
  );
  redirect(url);
}

/**
 * Disconnect the caller's connection for a provider from the Connections card.
 * Account-scoped lookup so a request can only ever revoke the caller's own
 * connection (never an arbitrary connection_id). revokeAndSuspend destroys the
 * vault secret, flips status → revoked, and suspends dependent write-grants.
 */
export async function disconnectAction(formData: FormData): Promise<void> {
  const provider = String(formData.get('provider') ?? '');
  const { user, accountId } = await appSession();
  const svc = serviceClient();

  const { data: conn } = await svc
    .from('connections')
    .select('id')
    .eq('account_id', accountId)
    .eq('provider', provider)
    .neq('status', 'revoked')
    .maybeSingle();

  if (conn?.id) await revokeAndSuspend(conn.id as string, user.id, svc);

  redirect(`/app/connections?disconnected=${encodeURIComponent(provider)}`);
}

export async function beginWriteConnectAction(formData: FormData): Promise<void> {
  const nibbinId = String(formData.get('nibbinId') ?? '').trim();
  const provider = String(formData.get('provider') ?? 'gmail');
  if (!nibbinId) throw new Error('nibbinId required');

  const { user, accountId } = await appSession();
  const svc = serviceClient();

  // Check if compose is already held — if so, grant directly without OAuth
  const { data: conn } = await svc
    .from('connections')
    .select('id, scopes')
    .eq('account_id', accountId)
    .eq('provider', provider)
    .eq('status', 'active')
    .maybeSingle();

  const COMPOSE = 'https://www.googleapis.com/auth/gmail.compose';
  if (conn && (conn.scopes as string[]).includes(COMPOSE)) {
    // Compose already held — grant email.draft directly without OAuth round-trip
    await grantWriteCapability(
      nibbinId, conn.id as string, accountId, user.id,
      'email.draft',
      'Maya will create a Gmail draft for your review.',
      svc,
    );
    redirect(`/app/nibbins/${nibbinId}?writeGranted=${provider}`);
    return;
  }

  // Compose not yet held — begin the OAuth upgrade flow
  const { url } = await beginWriteConnect(
    { nibbinId, provider, accountId, userId: user.id, userEmail: user.email ?? null },
    {
      config: getGoogleOAuthConfig(),
      allowlistFor: (p) => loadTesterAllowlist(p, svc),
      save: (input) => storePending(input, svc),
      nowMs: Date.now(),
    },
  );
  redirect(url);
}

/**
 * Disconnect a connection: revoke the OAuth token (vault secret destroyed),
 * set status → revoked, then suspend all nibbin_write_grants for this
 * connection_id. Design §4.4, §8.
 */
export async function revokeConnectionAction(connectionId: string): Promise<void> {
  const { user } = await appSession();
  const svc = serviceClient();
  await revokeAndSuspend(connectionId, user.id, svc);
}
