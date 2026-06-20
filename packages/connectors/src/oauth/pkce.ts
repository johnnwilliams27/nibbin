/**
 * PKCE + state primitives (SPEC §6.5). All randomness from the CSPRNG;
 * comparisons timing-safe. No nonce: the authorization-code flow does not
 * request an id_token, so there is no nonce to validate or emit.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

function base64url(buf: Buffer): string {
  return buf.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

/** 43-char RFC 7636 code verifier. */
export function generateCodeVerifier(): string {
  return base64url(randomBytes(32));
}

/** S256 code challenge for a verifier. */
export function codeChallengeS256(verifier: string): string {
  return base64url(createHash('sha256').update(verifier).digest());
}

export function generateState(): string {
  return base64url(randomBytes(24));
}

/** Constant-time string equality (state checks). */
export function timingSafeEqualString(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
