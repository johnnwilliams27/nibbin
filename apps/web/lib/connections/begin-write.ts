import 'server-only';
import { beginWriteScopeUpgrade, getConnector, type TesterAllowlist } from '@nibbin/connectors';
import type { GoogleOAuthConfig } from './google-oauth-env';
import type { StorePendingInput } from './pending';

const PENDING_TTL_MS = 10 * 60 * 1000;
const WRITE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/gmail.send',
];
const DEFAULT_REASON = 'Maya will create a Gmail draft for your review.';

export interface BeginWriteConnectArgs {
  nibbinId: string;
  provider: string;             // 'gmail'
  accountId: string;
  userId: string;
  userEmail: string | null;
  returnTo?: string;            // default: `/app/nibbins/${nibbinId}?writeGranted=${provider}`
  plainLanguageReason?: string; // default: 'Maya will create a Gmail draft for your review.'
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

  const pending = beginWriteScopeUpgrade({
    provider: args.provider,
    clientId: deps.config.clientId,
    redirectUri: deps.config.redirectUri,
    nibbinId: args.nibbinId,
    scopes: WRITE_SCOPES,
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
