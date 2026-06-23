/**
 * GTM link tracking — pure helpers shared by the /r/[code] redirect route and
 * the waitlist server action. No IO, no Next imports: trivially testable.
 *
 * The redirect route maps a short bio/video `code` to a same-origin landing URL
 * carrying UTM params, and logs the click. `resolveLinkCode` is the security
 * seam: it validates the code and only ever emits a RELATIVE path, so a crafted
 * code can never redirect off-origin (open-redirect guard).
 */

/** Known bio codes → canonical utm_source. Anything else is a per-video ref. */
const PLATFORM_CODES: Readonly<Record<string, string>> = {
  tt: 'tiktok',
  ig: 'instagram',
  x: 'x',
};

/** Codes are short, lowercase, alphanumeric + dashes only — never a path/host. */
const CODE_RE = /^[a-z0-9-]{1,64}$/;

/** UTM values (client-supplied via hidden fields) — bounded, url-safe punctuation only. */
const UTM_RE = /^[a-zA-Z0-9._-]{1,64}$/;

export interface ResolvedLink {
  source: string;
  medium: string;
  campaign: string;
  ref: string;
  /** Always a relative `/?...` path — same-origin by construction. */
  redirectPath: string;
}

/**
 * Validate a redirect code and derive its UTM + same-origin landing path.
 * Returns null for any code that isn't a clean short slug (the route then does
 * a bare redirect to `/` and logs nothing).
 */
export function resolveLinkCode(rawCode: string): ResolvedLink | null {
  const code = rawCode.toLowerCase();
  if (!CODE_RE.test(code)) return null;

  const platform = PLATFORM_CODES[code];
  const source = platform ?? code;
  const medium = platform ? 'bio' : 'video';
  const campaign = 'launch';

  const params = new URLSearchParams({
    utm_source: source,
    utm_medium: medium,
    utm_campaign: campaign,
    ref: code,
  });

  return { source, medium, campaign, ref: code, redirectPath: `/?${params.toString()}` };
}

/**
 * Sanitize a single UTM value read from untrusted FormData. Returns the trimmed
 * value if it's a bounded, url-safe token, else null (so we store clean data or
 * nothing — never truncated garbage or injection).
 */
export function normalizeUtm(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 64) return null;
  return UTM_RE.test(trimmed) ? trimmed : null;
}
