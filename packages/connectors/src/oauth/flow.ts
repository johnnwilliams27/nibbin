/**
 * OAuth authorization-code engine (SPEC §6.5).
 *
 * Anti-replay is enforced with state + PKCE: `state` is issued per flow and
 * checked timing-safe on the callback, and the S256 `code_verifier` binds the
 * redeemed code to this client. (No `nonce`/`id_token` is requested or
 * consumed, so none is emitted — it would be dead scaffolding.)
 *
 * Connect-time consent model (owner decision, Connector Lever 1): a first
 * connect requests the descriptor's READ **and** declared WRITE scopes in a
 * single consent (`beginConnectAuthorization`), so a Nibbin can act once the
 * human approves the side effect. `beginAuthorization` (read-only) is retained
 * for the rare read-only-only flow and as the base of the per-Nibbin upgrade
 * path. The C8 safety line moved from *scope acquisition* to *execution*:
 * every side effect is still gated by Agent School stage + approval + velocity
 * at the runtime layer — widening what is REQUESTED at connect does not widen
 * what may be EXECUTED without a human yes.
 *
 * `beginWriteScopeUpgrade` remains for the per-Nibbin incremental-consent path
 * (used when a connection was made read-only, or to add a narrower subset); it
 * demands the adopting Nibbin's id and a plain-language explanation.
 *
 * Google providers are pending verification (docs/STATE.md): connects are
 * gated to the tester allowlist and the 100-user cap until OAuth
 * verification + CASA complete (docs/RISKS.md §1).
 */
import { getConnector } from '../registry/registry';
import type { ConnectorDescriptor } from '../registry/types';
import { OAUTH_PROVIDERS } from './providers';
import {
  codeChallengeS256,
  generateCodeVerifier,
  generateState,
  timingSafeEqualString,
} from './pkce';
import { safeFetch, type UnsafeTestOverrides } from '../egress/safe-fetch';
import type { StoredToken } from '../vault';

/** Gate for providers whose platform verification is pending. */
export interface TesterAllowlist {
  isAllowed(email: string): boolean;
  /** Distinct testers consented so far — compared against the platform cap. */
  count(): number;
}

export interface BeginAuthorizationRequest {
  provider: string;
  clientId: string;
  redirectUri: string;
  /** Required while the provider's platform verification is pending. */
  tester?: { email: string; allowlist: TesterAllowlist };
  loginHint?: string;
}

export interface WriteScopeUpgradeRequest extends BeginAuthorizationRequest {
  /** The adopting Nibbin this upgrade is for — write scopes are per-Nibbin (C8). */
  nibbinId: string;
  /** Subset of the descriptor's declared write scopes. */
  scopes: string[];
  /** Shown to the user verbatim; "explained plainly" is part of the claim. */
  plainLanguageReason: string;
}

export interface PendingAuthorization {
  provider: string;
  url: string;
  state: string;
  codeVerifier?: string;
  /** The exact scopes requested — recorded onto the connection at callback. */
  scopes: string[];
}

export class OAuthFlowError extends Error {
  constructor(
    readonly reason:
      | 'unknown-provider'
      | 'not-oauth'
      | 'tester-required'
      | 'tester-not-allowed'
      | 'tester-cap-reached'
      | 'invalid-write-request'
      | 'state-mismatch'
      | 'exchange-failed',
    detail: string,
  ) {
    super(`${reason}: ${detail}`);
    this.name = 'OAuthFlowError';
  }
}

function requireOAuthProvider(provider: string): { descriptor: ConnectorDescriptor; config: (typeof OAUTH_PROVIDERS)[string] } {
  const descriptor = getConnector(provider);
  const config = OAUTH_PROVIDERS[provider];
  if (!config) {
    throw new OAuthFlowError(
      'not-oauth',
      `${provider} does not use the hand-built OAuth engine (aggregator or generic rail)`,
    );
  }
  return { descriptor, config };
}

function enforcePlatformGate(descriptor: ConnectorDescriptor, req: BeginAuthorizationRequest): void {
  const platform = descriptor.platform;
  if (platform?.verification !== 'pending') return;
  if (!req.tester) {
    throw new OAuthFlowError(
      'tester-required',
      `${descriptor.id} is pending platform verification — connects are limited to the test allowlist (${platform.trackedIn ?? 'docs/STATE.md'})`,
    );
  }
  if (!req.tester.allowlist.isAllowed(req.tester.email)) {
    throw new OAuthFlowError('tester-not-allowed', `${req.tester.email} is not on the ${descriptor.id} test allowlist`);
  }
  const cap = platform.unverifiedUserCap;
  if (cap !== undefined && req.tester.allowlist.count() >= cap) {
    throw new OAuthFlowError(
      'tester-cap-reached',
      `${descriptor.id} unverified-app cap (${cap}) reached — verification must complete before more connects`,
    );
  }
}

function buildAuthorization(
  descriptor: ConnectorDescriptor,
  req: BeginAuthorizationRequest,
  scopes: string[],
  incremental: boolean,
): PendingAuthorization {
  const config = OAUTH_PROVIDERS[descriptor.id]!;
  const state = generateState();
  const url = new URL(config.authorizationUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', req.clientId);
  url.searchParams.set('redirect_uri', req.redirectUri);
  url.searchParams.set('scope', scopes.join(' '));
  url.searchParams.set('state', state);
  if (req.loginHint) url.searchParams.set('login_hint', req.loginHint);
  for (const [k, v] of Object.entries(config.extraAuthParams ?? {})) {
    url.searchParams.set(k, v);
  }
  if (incremental && config.supportsIncrementalConsent) {
    url.searchParams.set('include_granted_scopes', 'true');
  }
  let codeVerifier: string | undefined;
  if (config.supportsPkce) {
    codeVerifier = generateCodeVerifier();
    url.searchParams.set('code_challenge', codeChallengeS256(codeVerifier));
    url.searchParams.set('code_challenge_method', 'S256');
  }
  return { provider: descriptor.id, url: url.href, state, codeVerifier, scopes };
}

/**
 * Read-only authorization — requests exactly the descriptor's READ scopes.
 * Retained for read-only-only connects and as the base of any flow that does
 * not want write at connect time. There is deliberately no way to pass extra
 * scopes here.
 */
export function beginAuthorization(req: BeginAuthorizationRequest): PendingAuthorization {
  const { descriptor } = requireOAuthProvider(req.provider);
  enforcePlatformGate(descriptor, req);
  return buildAuthorization(descriptor, req, descriptor.scopes.read, false);
}

/**
 * Connect-time authorization (owner decision, Connector Lever 1) — requests the
 * descriptor's READ **and** declared WRITE scopes in one consent so a Nibbin
 * can act on the connection after a human approves the side effect. Safety did
 * not move here: execution of every side effect remains gated by Agent School
 * stage + approval + velocity at the runtime layer. A provider that declares no
 * write scopes degrades to a read-only request automatically.
 */
export function beginConnectAuthorization(req: BeginAuthorizationRequest): PendingAuthorization {
  const { descriptor } = requireOAuthProvider(req.provider);
  enforcePlatformGate(descriptor, req);
  const scopes = [...descriptor.scopes.read, ...descriptor.scopes.write];
  // Incremental consent so connects re-add prior grants cleanly when supported.
  return buildAuthorization(descriptor, req, scopes, true);
}

/**
 * Per-Nibbin write-scope upgrade at adoption time (C8, §6.5 incremental
 * consent). Requested scopes must be declared write scopes; the
 * plain-language reason is mandatory and is what the user sees.
 */
export function beginWriteScopeUpgrade(req: WriteScopeUpgradeRequest): PendingAuthorization {
  const { descriptor } = requireOAuthProvider(req.provider);
  enforcePlatformGate(descriptor, req);
  if (!req.nibbinId.trim()) {
    throw new OAuthFlowError('invalid-write-request', 'write scopes are requested per-Nibbin; nibbinId required');
  }
  if (req.plainLanguageReason.trim().length < 12) {
    throw new OAuthFlowError(
      'invalid-write-request',
      'a plain-language explanation of why this Nibbin needs write access is required',
    );
  }
  if (req.scopes.length === 0) {
    throw new OAuthFlowError('invalid-write-request', 'no write scopes requested');
  }
  const declared = new Set(descriptor.scopes.write);
  for (const s of req.scopes) {
    if (!declared.has(s)) {
      throw new OAuthFlowError('invalid-write-request', `"${s}" is not a declared write scope for ${descriptor.id}`);
    }
  }
  return buildAuthorization(descriptor, req, [...descriptor.scopes.read, ...req.scopes], true);
}

export interface ExchangeCodeRequest {
  provider: string;
  code: string;
  redirectUri: string;
  clientId: string;
  clientSecret: string;
  codeVerifier?: string;
  /** state we issued (from PendingAuthorization) */
  expectedState: string;
  /** state echoed back on the callback */
  returnedState: string;
  /** scopes we asked for — recorded if the provider doesn't echo scopes */
  requestedScopes: string[];
}

interface TokenEndpointResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
}

function toStoredToken(body: TokenEndpointResponse, fallbackScopes: string[], nowMs: number): StoredToken {
  if (!body.access_token) {
    throw new OAuthFlowError('exchange-failed', 'token endpoint returned no access_token');
  }
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAtMs: body.expires_in !== undefined ? nowMs + body.expires_in * 1000 : undefined,
    tokenType: body.token_type ?? 'Bearer',
    scopes: body.scope ? body.scope.split(/[ ,]+/).filter(Boolean) : fallbackScopes,
  };
}

async function postTokenEndpoint(
  provider: string,
  params: Record<string, string>,
  requestedScopes: string[],
  unsafeTestOverrides?: UnsafeTestOverrides,
): Promise<StoredToken> {
  const { descriptor, config } = requireOAuthProvider(provider);
  const res = await safeFetch(
    config.tokenUrl,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams(params).toString(),
    },
    { allowedHosts: descriptor.egressAllowlist },
    unsafeTestOverrides,
  );
  if (res.status >= 400) {
    // never include the response body — providers echo codes/credentials
    throw new OAuthFlowError('exchange-failed', `${provider} token endpoint returned ${res.status}`);
  }
  return toStoredToken(res.json() as TokenEndpointResponse, requestedScopes, Date.now());
}

/** Redeem the callback code. State is checked timing-safe before any I/O. */
export async function exchangeCode(
  req: ExchangeCodeRequest,
  unsafeTestOverrides?: UnsafeTestOverrides,
): Promise<StoredToken> {
  if (!timingSafeEqualString(req.expectedState, req.returnedState)) {
    throw new OAuthFlowError('state-mismatch', 'callback state does not match the issued state');
  }
  return postTokenEndpoint(
    req.provider,
    {
      grant_type: 'authorization_code',
      code: req.code,
      redirect_uri: req.redirectUri,
      client_id: req.clientId,
      client_secret: req.clientSecret,
      ...(req.codeVerifier ? { code_verifier: req.codeVerifier } : {}),
    },
    req.requestedScopes,
    unsafeTestOverrides,
  );
}

/**
 * Refresh with rotation: the returned StoredToken carries the NEW refresh
 * token when the provider rotates (falling back to the old one otherwise);
 * callers must vault the result immediately — the old payload is dead.
 */
export async function refreshAccessToken(
  provider: string,
  current: StoredToken,
  clientId: string,
  clientSecret: string,
  unsafeTestOverrides?: UnsafeTestOverrides,
): Promise<StoredToken> {
  if (!current.refreshToken) {
    throw new OAuthFlowError('exchange-failed', 'no refresh token on record');
  }
  const next = await postTokenEndpoint(
    provider,
    {
      grant_type: 'refresh_token',
      refresh_token: current.refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    },
    current.scopes,
    unsafeTestOverrides,
  );
  return { ...next, refreshToken: next.refreshToken ?? current.refreshToken };
}
