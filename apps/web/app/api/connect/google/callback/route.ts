import { NextResponse, type NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { exchangeCode, type StoredToken } from '@nibbin/connectors';
import type { UnsafeTestOverrides } from '@nibbin/connectors';
import { serviceClient } from '../../../../../lib/supabase/service';
import { getGoogleOAuthConfig } from '../../../../../lib/connections/google-oauth-env';
import { consumePending, type PendingAuth } from '../../../../../lib/connections/pending';
import { completeConnection } from '../../../../../lib/connections/complete';
import { adoptTemplate } from '../../../../../lib/runtime/adopt';
import { createWriteGrant } from '../../../../../lib/connections/grants';
import { siteOrigin } from '../../../../../lib/site-url';
import { onGmailConnected } from '../../../../../lib/sweep/dispatch';

export const dynamic = 'force-dynamic';

/** Redeem the callback code via the OAuth engine (test override injects a mock token endpoint). */
export async function exchangeViaEngine(
  pending: PendingAuth,
  code: string,
  overrides?: UnsafeTestOverrides,
): Promise<StoredToken> {
  const cfg = getGoogleOAuthConfig();
  // State is already validated upstream: completeConnection consumes the pending
  // BY the returned state (consumePending), so by the time we exchange,
  // pending.state IS the callback's returned state by construction. The
  // expected/returned pair below is therefore that already-validated value —
  // belt-and-suspenders, not the primary CSRF check.
  return exchangeCode(
    {
      provider: pending.provider,
      code,
      redirectUri: cfg.redirectUri,
      clientId: cfg.clientId,
      clientSecret: cfg.clientSecret,
      codeVerifier: pending.codeVerifier,
      expectedState: pending.state,
      returnedState: pending.state,
      requestedScopes: pending.scopes,
    },
    overrides,
  );
}

/** Insert an active connection (service role) and seal the token in the vault.
 * For write upgrades (nibbinId set), updates the existing connection's scopes
 * in-place (design §9.1 — one connection per account per provider).
 */
export function makeCreateActiveConnection(svc: SupabaseClient) {
  return async (pending: PendingAuth, token: StoredToken): Promise<string> => {
    if (pending.nibbinId) {
      // Write-scope upgrade: find existing active connection and update scopes in-place
      const { data: existing } = await svc
        .from('connections')
        .select('id')
        .eq('account_id', pending.accountId)
        .eq('provider', pending.provider)
        .eq('status', 'active')
        .maybeSingle();
      if (existing) {
        const { error: upErr } = await svc
          .from('connections')
          .update({ scopes: token.scopes })
          .eq('id', existing.id as string);
        if (upErr) throw new Error(`connection scopes update failed: ${upErr.message}`);
        // Only overwrite the vaulted token when the re-consent actually returned
        // a refresh token (prompt=consent normally guarantees one). Storing a
        // refresh-less token would wipe our ability to refresh; in that rare case
        // keep the existing token and just take the widened scopes above.
        if (token.refreshToken) {
          const { error: vErr } = await svc.rpc('connection_token_store', {
            p_connection: existing.id,
            p_token: JSON.stringify(token),
          });
          if (vErr) throw new Error(`token store failed: ${vErr.message}`);
        }
        return existing.id as string;
      }
    }
    // First connect — insert new row
    const { data, error } = await svc
      .from('connections')
      .insert({
        account_id: pending.accountId,
        provider: pending.provider,
        method: 'H',
        scopes: token.scopes,
        status: 'active',
        created_by: pending.userId,
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(`connection insert failed: ${error?.message}`);
    const { error: vErr } = await svc.rpc('connection_token_store', {
      p_connection: data.id,
      p_token: JSON.stringify(token),
    });
    if (vErr) throw new Error(`token store failed: ${vErr.message}`);
    return data.id as string;
  };
}

export async function GET(request: NextRequest): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const oauthError = url.searchParams.get('error');

  if (oauthError || !code || !state) {
    return NextResponse.redirect(new URL('/app/connections?error=declined', request.url));
  }

  const svc = serviceClient();
  let createdConnectionId: string | null = null;
  let createdPending: PendingAuth | null = null;
  let createdPendingUserId: string | null = null;

  const createAndCapture = async (pending: PendingAuth, token: StoredToken): Promise<string> => {
    const id = await makeCreateActiveConnection(svc)(pending, token);
    createdConnectionId = id;
    return id;
  };

  const { redirectTo } = await completeConnection(
    { code, returnedState: state, nowMs: Date.now() },
    {
      consume: async (s, now) => {
        const p = await consumePending(s, now, svc);
        if (p) { createdPending = p; createdPendingUserId = p.userId; }
        return p;
      },
      exchange: (pending, c) => exchangeViaEngine(pending, c),
      createActiveConnection: createAndCapture,
      resumeAdopt: async (pending, templateKey) => {
        const r = await adoptTemplate(pending.accountId, pending.userId, templateKey);
        return { ok: r.missingConnectors.length === 0, missing: r.missingConnectors };
      },
      createWriteGrant: async (pending, connectionId) => {
        if (!pending.nibbinId) return;
        await createWriteGrant(
          {
            accountId: pending.accountId,
            nibbinId: pending.nibbinId,
            connectionId,
            capability: 'email.draft',
            grantedBy: pending.userId,
            plainLanguageReason: 'Maya will create a Gmail draft for your review.',
          },
          svc,
        );
      },
    },
  );

  // Dispatch sweep (fire-and-forget) iff the user gave sweep consent.
  // Use siteOrigin() — NOT request.url — for the internal HMAC-bearing worker
  // POST: request.url derives from the attacker-influenceable Host header on
  // Vercel, so the credentials must only ever go to our pinned origin (RT-2).
  if (createdConnectionId && createdPendingUserId) {
    // cast needed: TS narrows the closure-assigned `createdPending` to `never` here.
    const pendingConsent = (createdPending as PendingAuth | null)?.sweepConsent ?? false;
    await onGmailConnected(svc, siteOrigin(), createdConnectionId, pendingConsent, createdPendingUserId);
  }

  return NextResponse.redirect(new URL(redirectTo, request.url));
}
