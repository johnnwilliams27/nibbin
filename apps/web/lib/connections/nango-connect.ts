import 'server-only';
/**
 * Nango [N] connect action logic.
 *
 * Enforces the tester-allowlist gate (same invariant as [H] path) then
 * redirects to Nango's hosted OAuth URL.
 *
 * Nango hosted connect URL shape (Nango v0.43+):
 *   https://api.nango.dev/oauth/connect/{providerConfigKey}
 *     ?connection_id=...&public_key=...
 *
 * The public key is NANGO_PUBLIC_KEY (browser-safe; never the secret key).
 * The secret key (NANGO_SECRET_KEY) is used server-side only and never
 * appears in the redirect URL.
 */
import { enforcePlatformGate, OAuthFlowError } from '@nibbin/connectors';
import { getConnector } from '@nibbin/connectors';
import type { TesterAllowlist } from '@nibbin/connectors';

export interface NangoConnectInput {
  provider: string;
  accountId: string;
  /** User email for the tester-allowlist gate. null triggers tester-required. */
  userEmail: string | null;
  testerAllowlist: TesterAllowlist;
  /** Safe same-origin return path after connect — encoded into state. */
  returnTo?: string;
}

export interface NangoConnectResult {
  /** Redirect the user to this URL to start the Nango hosted OAuth flow. */
  url: string;
  /** The connection_id we passed to Nango — write to connections row on callback. */
  nangoConnectionId: string;
}

/**
 * Map a Nibbin provider id to Nango's integration/providerConfigKey.
 * Only [N]-lane providers are listed here.
 */
export function providerToNangoKey(provider: string): string {
  const MAP: Record<string, string> = {
    gmail: 'google-mail',
    'google-calendar': 'google-calendar',
  };
  const key = MAP[provider];
  if (!key) throw new Error(`no Nango provider config key for ${provider}`);
  return key;
}

/**
 * Build the Nango hosted connect redirect URL for a [N]-lane provider.
 *
 * Enforces the tester-allowlist gate before building the URL so a non-
 * allowlisted user is rejected here with the same OAuthFlowError the [H]
 * path throws — the error is identical regardless of lane.
 */
export function buildNangoConnectUrl(input: NangoConnectInput): NangoConnectResult {
  const descriptor = getConnector(input.provider);
  if (descriptor.method !== 'N') {
    throw new Error(`provider ${input.provider} is not a Nango connector (method: ${descriptor.method})`);
  }

  // Enforce the tester gate — same invariant as [H] path.
  // userEmail === null means the caller has no email → treat as absent tester.
  enforcePlatformGate(descriptor, {
    provider: input.provider,
    tester: input.userEmail
      ? { email: input.userEmail, allowlist: input.testerAllowlist }
      : undefined,
  });

  const providerConfigKey = providerToNangoKey(input.provider);
  const nangoConnectionId = `nibbin-${input.accountId}-${input.provider}`;
  const publicKey = process.env.NANGO_PUBLIC_KEY ?? '';
  const nangoHost = process.env.NANGO_HOST ?? 'https://api.nango.dev';

  const url = new URL(`${nangoHost}/oauth/connect/${encodeURIComponent(providerConfigKey)}`);
  url.searchParams.set('connection_id', nangoConnectionId);
  url.searchParams.set('public_key', publicKey);
  if (input.returnTo) url.searchParams.set('state', encodeURIComponent(input.returnTo));

  return { url: url.href, nangoConnectionId };
}

// Re-export OAuthFlowError so callers can catch it without importing from connectors.
export { OAuthFlowError };
