import type { NextRequest } from "next/server";
import { CONNECTORS } from "../../../lib/connections/catalog";

// Same-origin proxy for connector brand logos. The browser requests
// /api/connector-logo?domain=<d> instead of hitting logo.clearbit.com directly,
// so the client's IP is never disclosed to the third-party logo provider — only
// Nibbin's server contacts it. Restricted to domains in our connector catalog
// (no open proxy / SSRF: we only ever fetch logo.clearbit.com/<known-domain>).

const ALLOWED_DOMAINS = new Set(
  CONNECTORS.map((c) => c.domain).filter((d): d is string => Boolean(d)),
);

const ONE_DAY = 60 * 60 * 24;
const ONE_WEEK = ONE_DAY * 7;

export async function GET(req: NextRequest) {
  const domain = req.nextUrl.searchParams.get("domain");
  // Only proxy logos for connectors we actually list. Unknown/blank → 404 so the
  // client's <img onError> falls back to the monogram tile.
  if (!domain || !ALLOWED_DOMAINS.has(domain)) {
    return new Response(null, { status: 404 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`https://logo.clearbit.com/${encodeURIComponent(domain)}`, {
      // Cache the upstream fetch; logos are effectively static.
      next: { revalidate: ONE_WEEK },
    });
  } catch {
    return new Response(null, { status: 502 });
  }

  if (!upstream.ok) {
    return new Response(null, { status: 404 });
  }

  const body = await upstream.arrayBuffer();
  const contentType = upstream.headers.get("content-type") ?? "image/png";
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": contentType,
      // Long-lived caching at the CDN + browser so repeat views don't re-proxy.
      "cache-control": `public, max-age=${ONE_DAY}, s-maxage=${ONE_WEEK}, immutable`,
    },
  });
}
