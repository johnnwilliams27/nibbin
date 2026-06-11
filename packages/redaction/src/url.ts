/**
 * URL scrubbing (SPEC §5): query strings and fragments are dropped entirely;
 * the host is kept; path segments that look like identifiers are templated to
 * `{id}` so paths describe workflow shape, never specific records.
 */

const ID_SEGMENT = [
  /^\d+$/, // numeric ids
  /^[0-9a-f]{6,}$/i, // hex ids / hashes
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, // uuid
  /^[A-Za-z0-9_-]{16,}$/, // opaque tokens/slugs
  /\d{4,}/, // any segment embedding a long digit run
];

export function scrubUrl(raw: string): { host: string; path_template: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

  const segments = parsed.pathname.split('/').filter((s) => s.length > 0);
  const templated = segments.map((seg) => {
    const decoded = (() => {
      try {
        return decodeURIComponent(seg);
      } catch {
        return seg;
      }
    })();
    return ID_SEGMENT.some((re) => re.test(decoded)) ? '{id}' : decoded;
  });

  return {
    host: parsed.hostname,
    path_template: '/' + templated.join('/'),
  };
}

export function hostOf(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    return new URL(raw).hostname;
  } catch {
    return null;
  }
}
