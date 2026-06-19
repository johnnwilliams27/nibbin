import type { NextRequest } from "next/server";
import { CONNECTORS } from "../../../lib/connections/catalog";

// Same-origin proxy for connector brand logos. The browser requests
// /api/connector-logo?domain=<d> instead of hitting upstream logo providers
// directly, so the client's IP is never disclosed to third-party services —
// only Nibbin's server contacts them. Restricted to domains in our connector
// catalog (no open proxy / SSRF: we only ever fetch fixed hosts with an
// allowlisted domain interpolated).

const ALLOWED_DOMAINS = new Set(
  CONNECTORS.map((c) => c.domain).filter((d): d is string => Boolean(d)),
);

const ONE_DAY = 60 * 60 * 24;
const ONE_WEEK = ONE_DAY * 7;
const MAX_LOGO_BYTES = 512 * 1024;
const LOGO_FETCH_TIMEOUT_MS = 2000;

// Upstream sources tried in priority order:
//   1. Clearbit  — clean square brand logos when available (HubSpot-era API,
//      unreliable but highest quality when it works).
//   2. Google S2 — full-colour favicons at 128 px, extremely reliable.
//   3. DuckDuckGo — ICO-format favicon fallback, also very reliable.
// We return the first source that gives HTTP 200 + image/* + ≤ 512 KB.
async function tryFetchImage(
  url: string,
): Promise<{ body: ArrayBuffer; contentType: string } | null> {
  try {
    const res = await fetch(url, {
      // Cache the upstream fetch; logos are effectively static.
      next: { revalidate: ONE_WEEK },
      signal: AbortSignal.timeout(LOGO_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const ct = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!ct.startsWith("image/")) return null;
    const body = await res.arrayBuffer();
    if (body.byteLength > MAX_LOGO_BYTES) return null;
    return { body, contentType: ct };
  } catch {
    return null;
  }
}

// Intentionally public: brand logos are public assets and the response is the
// same for everyone, so no appSession/auth is needed (and an <img> can't send it).

export async function GET(req: NextRequest) {
  const domain = req.nextUrl.searchParams.get("domain");
  // Only proxy logos for connectors we actually list. Unknown/blank → 404 so the
  // client's <img onError> falls back to the monogram tile.
  if (!domain || !ALLOWED_DOMAINS.has(domain)) {
    return new Response(null, { status: 404 });
  }

  const encoded = encodeURIComponent(domain);
  const sources = [
    `https://logo.clearbit.com/${encoded}`,
    `https://www.google.com/s2/favicons?domain=${encoded}&sz=128`,
    `https://icons.duckduckgo.com/ip3/${encoded}.ico`,
  ];

  for (const url of sources) {
    const result = await tryFetchImage(url);
    if (result) {
      return new Response(result.body, {
        status: 200,
        headers: {
          "content-type": result.contentType,
          // Cached at the CDN + browser so repeat views don't re-proxy. NOT `immutable`:
          // the URL isn't content-hashed, so a stale/bad entry must remain refreshable.
          "cache-control": `public, max-age=${ONE_DAY}, s-maxage=${ONE_WEEK}`,
        },
      });
    }
  }

  // All sources failed — let the client's monogram fallback render.
  return new Response(null, { status: 404 });
}
