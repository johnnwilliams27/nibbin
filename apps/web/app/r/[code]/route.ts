import { NextResponse, type NextRequest } from 'next/server';
import { serviceClient } from '../../../lib/supabase/service';
import { resolveLinkCode } from '../../../lib/gtm/links';

// Click redirect: bio links point at /r/<code> (e.g. /r/tt). We log the click
// as a cookieless product_event, then 302 to the landing page carrying UTM so
// the eventual signup is attributable. Never statically optimized.
export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ code: string }> },
): Promise<NextResponse> {
  const { code } = await ctx.params;
  const resolved = resolveLinkCode(code ?? '');

  // Unknown/invalid code: bare redirect home, log nothing. resolveLinkCode only
  // ever yields a relative path, so the Location is same-origin by construction.
  if (!resolved) {
    return NextResponse.redirect(new URL('/', req.url), 302);
  }

  // Best-effort click log — a logging failure must never block the redirect.
  try {
    const svc = serviceClient();
    await svc.from('product_events').insert({
      name: 'link_click',
      props: {
        code: resolved.ref,
        utm_source: resolved.source,
        utm_medium: resolved.medium,
        utm_campaign: resolved.campaign,
      },
    });
  } catch (err) {
    console.error('[gtm-redirect] click log failed', err instanceof Error ? err.message : String(err));
  }

  return NextResponse.redirect(new URL(resolved.redirectPath, req.url), 302);
}
