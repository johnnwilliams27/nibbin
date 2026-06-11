/**
 * Inbound webhook signature verification (SPEC §6.5: "signature verification
 * on every inbound; replay windows"). One verifier per SignatureScheme in the
 * registry; the webhook router refuses any request that doesn't pass the
 * scheme its connector declares.
 *
 * All comparisons are timing-safe. All verifiers take the RAW request body —
 * never a re-serialized parse.
 */
import { createHmac, createPublicKey, timingSafeEqual, verify as cryptoVerify } from 'node:crypto';
import { safeFetch, type UnsafeTestOverrides } from '../egress/safe-fetch';

export type VerifyResult = { valid: true } | { valid: false; reason: string };

function timingSafeEqualBytes(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function hmacHex(secret: string, payload: string | Buffer): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

function safeHexCompare(expectedHex: string, receivedHex: string): boolean {
  if (!/^[0-9a-f]+$/i.test(receivedHex)) return false;
  return timingSafeEqualBytes(Buffer.from(expectedHex, 'hex'), Buffer.from(receivedHex.toLowerCase(), 'hex'));
}

/** Generic scheme: hex HMAC-SHA256 of the raw body. */
export function verifyHmacSha256(rawBody: string | Buffer, signatureHex: string, secret: string): VerifyResult {
  if (!secret) return { valid: false, reason: 'no secret configured' };
  return safeHexCompare(hmacHex(secret, rawBody), signatureHex.trim())
    ? { valid: true }
    : { valid: false, reason: 'signature mismatch' };
}

/**
 * Stripe-Signature: `t=<unix>,v1=<hex>[,v1=...]` over `${t}.${rawBody}`.
 * Timestamp tolerance is the replay window.
 */
export function verifyStripeSignature(
  rawBody: string | Buffer,
  header: string,
  secret: string,
  opts: { toleranceSecs?: number; nowSecs?: number } = {},
): VerifyResult {
  const tolerance = opts.toleranceSecs ?? 300;
  const now = opts.nowSecs ?? Math.floor(Date.now() / 1000);
  let timestamp: number | undefined;
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const [k, v] = part.split('=', 2);
    if (k?.trim() === 't' && v) timestamp = Number(v);
    if (k?.trim() === 'v1' && v) signatures.push(v);
  }
  if (timestamp === undefined || Number.isNaN(timestamp)) return { valid: false, reason: 'no timestamp' };
  if (signatures.length === 0) return { valid: false, reason: 'no v1 signature' };
  if (Math.abs(now - timestamp) > tolerance) return { valid: false, reason: 'outside replay window' };
  const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
  const expected = hmacHex(secret, `${timestamp}.${body}`);
  return signatures.some((s) => safeHexCompare(expected, s))
    ? { valid: true }
    : { valid: false, reason: 'signature mismatch' };
}

/** Meta/Instagram: `X-Hub-Signature-256: sha256=<hex>` over the raw body. */
export function verifyMetaSignature(rawBody: string | Buffer, header: string, appSecret: string): VerifyResult {
  const prefix = 'sha256=';
  if (!header.startsWith(prefix)) return { valid: false, reason: 'missing sha256= prefix' };
  return verifyHmacSha256(rawBody, header.slice(prefix.length), appSecret);
}

/** Slack: `v0=<hex>` over `v0:${timestamp}:${rawBody}`, timestamped. */
export function verifySlackSignature(
  rawBody: string | Buffer,
  signatureHeader: string,
  timestampHeader: string,
  signingSecret: string,
  opts: { toleranceSecs?: number; nowSecs?: number } = {},
): VerifyResult {
  const tolerance = opts.toleranceSecs ?? 300;
  const now = opts.nowSecs ?? Math.floor(Date.now() / 1000);
  const ts = Number(timestampHeader);
  if (!Number.isFinite(ts)) return { valid: false, reason: 'bad timestamp' };
  if (Math.abs(now - ts) > tolerance) return { valid: false, reason: 'outside replay window' };
  if (!signatureHeader.startsWith('v0=')) return { valid: false, reason: 'missing v0= prefix' };
  const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
  const expected = hmacHex(signingSecret, `v0:${ts}:${body}`);
  return safeHexCompare(expected, signatureHeader.slice(3))
    ? { valid: true }
    : { valid: false, reason: 'signature mismatch' };
}

/** Google Calendar/Drive push: shared channel token, compared timing-safe. */
export function verifyGoogleChannelToken(receivedToken: string, expectedToken: string): VerifyResult {
  if (!expectedToken) return { valid: false, reason: 'no channel token configured' };
  return timingSafeEqualBytes(Buffer.from(receivedToken, 'utf8'), Buffer.from(expectedToken, 'utf8'))
    ? { valid: true }
    : { valid: false, reason: 'channel token mismatch' };
}

// ── Google Pub/Sub push OIDC (Gmail watch) ──────────────────────────────────

const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);

export interface Jwk {
  kty: string;
  alg?: string;
  kid?: string;
  n?: string;
  e?: string;
}

function b64urlJson(segment: string): unknown {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
}

export interface OidcClaims {
  iss: string;
  aud: string;
  exp: number;
  iat: number;
  email?: string;
  email_verified?: boolean;
}

/**
 * Verify the `Authorization: Bearer <jwt>` a Pub/Sub push subscription sends.
 * Checks RS256 signature against Google's JWKS, issuer, audience, expiry,
 * and (when configured) the service-account email.
 *
 * Callers SHOULD always pass `expectedEmail` (the push subscription's service
 * account) so a different Google project cannot post to this endpoint even if
 * the audience URL leaks. It is optional only because the Gmail watch wiring
 * lands at M4; treat it as required there.
 */
export async function verifyGooglePubSubOidc(
  authorizationHeader: string,
  opts: {
    expectedAudience: string;
    expectedEmail?: string;
    nowSecs?: number;
    /** test seam: JWKS document instead of fetching Google's */
    jwks?: { keys: Jwk[] };
    unsafeTestOverrides?: UnsafeTestOverrides;
  },
): Promise<VerifyResult & { claims?: OidcClaims }> {
  const m = authorizationHeader.match(/^Bearer\s+(.+)$/i);
  if (!m) return { valid: false, reason: 'no bearer token' };
  const segments = m[1]!.split('.');
  if (segments.length !== 3) return { valid: false, reason: 'not a JWT' };

  let header: { alg?: string; kid?: string };
  let claims: OidcClaims;
  try {
    header = b64urlJson(segments[0]!) as { alg?: string; kid?: string };
    claims = b64urlJson(segments[1]!) as OidcClaims;
  } catch {
    return { valid: false, reason: 'malformed JWT' };
  }
  if (header.alg !== 'RS256') return { valid: false, reason: `unexpected alg ${header.alg}` };

  let jwks = opts.jwks;
  if (!jwks) {
    const res = await safeFetch(
      GOOGLE_JWKS_URL,
      {},
      { allowedHosts: ['www.googleapis.com'] },
      opts.unsafeTestOverrides,
    );
    if (res.status !== 200) return { valid: false, reason: 'JWKS fetch failed' };
    jwks = res.json() as { keys: Jwk[] };
  }
  const key = jwks.keys.find((k) => k.kid === header.kid && k.kty === 'RSA');
  if (!key) return { valid: false, reason: 'no matching JWKS key' };

  const publicKey = createPublicKey({ key: key as unknown as Record<string, string>, format: 'jwk' });
  const signed = Buffer.from(`${segments[0]}.${segments[1]}`, 'utf8');
  const signature = Buffer.from(segments[2]!, 'base64url');
  if (!cryptoVerify('RSA-SHA256', signed, publicKey, signature)) {
    return { valid: false, reason: 'signature mismatch' };
  }

  const now = opts.nowSecs ?? Math.floor(Date.now() / 1000);
  if (!GOOGLE_ISSUERS.has(claims.iss)) return { valid: false, reason: 'bad issuer' };
  if (claims.aud !== opts.expectedAudience) return { valid: false, reason: 'bad audience' };
  if (claims.exp <= now) return { valid: false, reason: 'expired' };
  if (claims.iat > now + 60) return { valid: false, reason: 'issued in the future' };
  if (opts.expectedEmail && (claims.email !== opts.expectedEmail || claims.email_verified !== true)) {
    return { valid: false, reason: 'unexpected service account' };
  }
  return { valid: true, claims };
}
