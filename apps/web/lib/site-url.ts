/**
 * Canonical origin for auth redirects and the magic-link `emailRedirectTo`.
 *
 * NEVER derive this from the request Host header — that is attacker-controllable
 * and would let a magic link point at an attacker domain (red-team PR #8 P1).
 * Order: an explicitly pinned site URL, then Vercel's server-injected deployment
 * URL (trustworthy, not client-controlled — covers preview deploys), then a
 * localhost fallback for dev.
 */
export function siteOrigin(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/+$/, '');
  const vercel = process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;
  return 'http://localhost:3000';
}
