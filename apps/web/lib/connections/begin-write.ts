import 'server-only';
import { beginWriteScopeUpgrade, getConnector, type TesterAllowlist } from '@nibbin/connectors';
import type { GoogleOAuthConfig } from './google-oauth-env';
import type { StorePendingInput } from './pending';

const PENDING_TTL_MS = 10 * 60 * 1000;
const DEFAULT_REASON = 'Maya will create a Gmail draft for your review.';

export interface BeginWriteConnectArgs {
  nibbinId: string;
  provider: string;             // any wired provider with declared write scopes
  accountId: string;
  userId: string;
  userEmail: string | null;
  returnTo?: string;            // default: `/app/nibbins/${nibbinId}?writeGranted=${provider}`
  plainLanguageReason?: string; // default: 'Maya will create a Gmail draft for your review.'
  /**
   * Subset of the provider's declared write scopes to request. Defaults to ALL
   * declared write scopes for the provider (provider-generic — no Gmail
   * hardcode). The OAuth engine rejects any scope not declared for the provider.
   */
  scopes?: string[];
}

export interface BeginWriteConnectDeps {
  config: GoogleOAuthConfig;
  allowlistFor: (provider: string) => Promise<TesterAllowlist>;
  save: (input: StorePendingInput) => Promise<void>;
  nowMs: number;
  pendingTtlMs?: number;
}

export async function beginWriteConnect(
  args: BeginWriteConnectArgs,
  deps: BeginWriteConnectDeps,
): Promise<{ url: string }> {
  const descriptor = getConnector(args.provider);
  const tester =
    descriptor.platform?.verification === 'pending'
      ? { email: args.userEmail ?? '', allowlist: await deps.allowlistFor(args.provider) }
      : undefined;

  // Provider-generic: derive write scopes from the registry rather than a Gmail
  // constant. Caller may request a subset; default is all declared write scopes.
  const writeScopes =
    args.scopes && args.scopes.length > 0 ? args.scopes : descriptor.scopes.write;

  const pending = beginWriteScopeUpgrade({
    provider: args.provider,
    clientId: deps.config.clientId,
    redirectUri: deps.config.redirectUri,
    nibbinId: args.nibbinId,
    scopes: writeScopes,
    plainLanguageReason: args.plainLanguageReason ?? DEFAULT_REASON,
    tester,
    loginHint: args.userEmail ?? undefined,
  });

  const defaultReturnTo = `/app/nibbins/${args.nibbinId}?writeGranted=${args.provider}`;

  await deps.save({
    state: pending.state,
    provider: args.provider,
    accountId: args.accountId,
    userId: args.userId,
    codeVerifier: pending.codeVerifier,
    scopes: pending.scopes,
    returnTo: args.returnTo ?? defaultReturnTo,
    resumeTemplate: null,
    expiresAtMs: deps.nowMs + (deps.pendingTtlMs ?? PENDING_TTL_MS),
    nibbinId: args.nibbinId,
  });

  return { url: pending.url };
}
