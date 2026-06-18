import 'server-only';
import { beginAuthorization, getConnector, type TesterAllowlist } from '@nibbin/connectors';
import type { GoogleOAuthConfig } from './google-oauth-env';
import type { StorePendingInput } from './pending';

const PENDING_TTL_MS = 10 * 60 * 1000;

function safeReturnTo(rt: string | undefined): string | undefined {
  if (!rt) return undefined;
  // same-origin app path only: leading single slash, no protocol-relative, no scheme
  if (rt.startsWith('/') && !rt.startsWith('//') && !rt.includes('://') && rt.startsWith('/app/')) {
    return rt;
  }
  return undefined; // fall back to the callback's default ('/app/connections')
}

export interface BeginConnectArgs {
  provider: string;
  accountId: string;
  userId: string;
  userEmail: string | null;
  returnTo?: string;
  resumeTemplate?: string;
}

export interface BeginConnectDeps {
  config: GoogleOAuthConfig;
  allowlistFor: (provider: string) => Promise<TesterAllowlist>;
  save: (input: StorePendingInput) => Promise<void>;
  nowMs: number;
  pendingTtlMs?: number;
}

export async function beginConnect(args: BeginConnectArgs, deps: BeginConnectDeps): Promise<{ url: string }> {
  const descriptor = getConnector(args.provider);
  const tester =
    descriptor.platform?.verification === 'pending'
      ? { email: args.userEmail ?? '', allowlist: await deps.allowlistFor(args.provider) }
      : undefined;

  const pending = beginAuthorization({
    provider: args.provider,
    clientId: deps.config.clientId,
    redirectUri: deps.config.redirectUri,
    tester,
    loginHint: args.userEmail ?? undefined,
  });

  await deps.save({
    state: pending.state,
    provider: args.provider,
    accountId: args.accountId,
    userId: args.userId,
    codeVerifier: pending.codeVerifier,
    scopes: pending.scopes,
    returnTo: safeReturnTo(args.returnTo) ?? null,
    resumeTemplate: args.resumeTemplate ?? null,
    expiresAtMs: deps.nowMs + (deps.pendingTtlMs ?? PENDING_TTL_MS),
  });

  return { url: pending.url };
}
