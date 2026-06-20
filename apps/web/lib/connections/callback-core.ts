import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { exchangeCode, type StoredToken, type UnsafeTestOverrides } from '@nibbin/connectors';
import { serviceClient } from '../supabase/service';
import { getOAuthConfigFor } from './oauth-config';
import { consumePending, type PendingAuth } from './pending';
import { completeConnection } from './complete';
import { adoptTemplate } from '../runtime/adopt';
import { createWriteGrant, type WriteCapability } from './grants';
import { CONNECTABLE_PROVIDERS } from './providers';

/** True when `provider` is in the wired-connector allowlist. */
export function isWiredProvider(provider: string): boolean {
  return CONNECTABLE_PROVIDERS.some((p) => p.id === provider && p.wired);
}

/**
 * Per-provider write-grant copy + capability for the per-Nibbin write upgrade.
 * Returns null for providers with no write capability wired yet.
 */
export function writeGrantSpecFor(
  provider: string,
): { capability: WriteCapability; reason: string } | null {
  switch (provider) {
    case 'gmail':
      return { capability: 'email.draft', reason: 'Maya will create a Gmail draft for your review.' };
    case 'google-calendar':
      return {
        capability: 'calendar.event-create',
        reason: 'This Nibbin will create or update calendar events for your approval before anything is saved.',
      };
    default:
      return null;
  }
}

/**
 * Redeem the callback code via the OAuth engine.
 * Uses getOAuthConfigFor(pending.provider) so it works for any wired provider,
 * not just Gmail. State is validated upstream by consumePending; the
 * expectedState/returnedState pair here is belt-and-suspenders only.
 */
export async function exchangeViaEngine(
  pending: PendingAuth,
  code: string,
  overrides?: UnsafeTestOverrides,
): Promise<StoredToken> {
  const cfg = getOAuthConfigFor(pending.provider);
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

/**
 * Insert an active connection (service role) and seal the token in the vault.
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

export interface CallbackOpts {
  /**
   * When provided, the pending row's `provider` field must equal this value.
   * The dynamic [provider] route passes the URL segment here to prevent
   * redeeming a pending authorization on the wrong provider's callback.
   */
  expectedProvider?: string;
  /**
   * The provider id this route handles (e.g. 'gmail', 'google-calendar').
   * When set, error redirects append `&provider=<id>` so the connections page
   * can pre-fill the retry form with the correct provider instead of defaulting
   * to 'gmail'. Only appended to error redirects; success redirects are
   * unaffected. Never appended if the value is unknown.
   */
  provider?: string;
  /** Provider-specific post-connect work (e.g. Gmail sweep dispatch). */
  postConnect?: (svc: SupabaseClient, pending: PendingAuth, connectionId: string) => Promise<void>;
}

/**
 * Shared OAuth callback handler for all providers.
 *
 * Security properties preserved from the Gmail-only route:
 * - Single-use state: consumePending atomically marks consumed_at (DB-level).
 * - TTL: expires_at checked in the same DB UPDATE (no race window).
 * - Tokens sealed in vault only: connection_token_store RPC; never in redirect
 *   URLs, logs, or app tables.
 * - Same-origin returnTo: redirectTo comes from pending.returnTo (stored
 *   server-side at initiate time); we pass it to NextResponse.redirect via a
 *   new URL(redirectTo, request.url) which enforces same-origin resolution.
 * - expectedProvider guard: dynamic route passes its [provider] segment so a
 *   pending row for the wrong provider cannot be redeemed here.
 */
export async function handleConnectionCallback(
  request: NextRequest,
  opts: CallbackOpts = {},
): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const oauthError = url.searchParams.get('error');

  if (oauthError || !code || !state) {
    const providerHint = opts.provider;
    const declined = providerHint
      ? `/app/connections?error=declined&provider=${encodeURIComponent(providerHint)}`
      : '/app/connections?error=declined';
    return NextResponse.redirect(new URL(declined, request.url));
  }

  const svc = serviceClient();
  let createdConnectionId: string | null = null;
  let createdPending: PendingAuth | null = null;

  let saveFailed = false;
  let completeResult: { redirectTo: string };
  try {
    completeResult = await completeConnection(
      { code, returnedState: state, nowMs: Date.now() },
      {
        consume: async (s, now) => {
          const p = await consumePending(s, now, svc);
          // Guard: the pending row's provider must match the route it was redeemed on.
          if (p && opts.expectedProvider && p.provider !== opts.expectedProvider) return null;
          if (p) createdPending = p;
          return p;
        },
        exchange: (pending, c) => exchangeViaEngine(pending, c),
        createActiveConnection: async (pending, token) => {
          try {
            const id = await makeCreateActiveConnection(svc)(pending, token);
            createdConnectionId = id;
            return id;
          } catch (err) {
            // Log server-side without token material; never put error text in the redirect URL.
            console.error('[connections] vault/insert failed for provider', pending.provider, '—', err instanceof Error ? err.message : String(err));
            throw { __saveFailed: true } as unknown as Error;
          }
        },
        resumeAdopt: async (pending, templateKey) => {
          const r = await adoptTemplate(pending.accountId, pending.userId, templateKey);
          return { ok: r.missingConnectors.length === 0, missing: r.missingConnectors };
        },
        createWriteGrant: async (pending, connectionId) => {
          if (!pending.nibbinId) return;
          const spec = writeGrantSpecFor(pending.provider);
          if (!spec) return;
          await createWriteGrant(
            {
              accountId: pending.accountId,
              nibbinId: pending.nibbinId,
              connectionId,
              capability: spec.capability,
              grantedBy: pending.userId,
              plainLanguageReason: spec.reason,
            },
            svc,
          );
        },
      },
    );
  } catch (err) {
    if (err !== null && typeof err === 'object' && '__saveFailed' in err) {
      saveFailed = true;
      completeResult = { redirectTo: '/app/connections?error=save_failed' };
    } else {
      throw err;
    }
  }

  let { redirectTo } = completeResult!;

  // Append &provider=<id> to error redirects so the connections page can
  // pre-fill the retry form correctly. Only applied to error paths; success
  // redirects are unaffected. Resolved from the route hint (opts.provider) or,
  // as a fallback, the consumed pending row's provider (only if known).
  if (redirectTo.includes('?error=') || redirectTo.includes('&error=')) {
    // cast: TS narrows the closure-assigned `createdPending` to `never` here.
    const providerHint = opts.provider ?? (createdPending as PendingAuth | null)?.provider;
    if (providerHint) {
      redirectTo = redirectTo.includes('?')
        ? `${redirectTo}&provider=${encodeURIComponent(providerHint)}`
        : `${redirectTo}?provider=${encodeURIComponent(providerHint)}`;
    }
  }

  if (!saveFailed && createdConnectionId && opts.postConnect && createdPending) {
    await opts.postConnect(svc, createdPending, createdConnectionId);
  }

  return NextResponse.redirect(new URL(redirectTo, request.url));
}
