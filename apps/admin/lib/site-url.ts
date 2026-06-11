/**
 * Canonical origin for staff-auth redirects. NEVER from the request Host header
 * (attacker-controllable). Order: pinned NEXT_PUBLIC_SITE_URL → Vercel's
 * server-injected URL → localhost:3001 (admin dev port).
 */
export function siteOrigin(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/+$/, '');
  const vercel = process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;
  return 'http://localhost:3001';
}
