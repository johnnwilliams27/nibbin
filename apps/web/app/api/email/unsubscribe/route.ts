/**
 * Unsubscribe endpoint (CAN-SPAM + RFC 8058). Works without a login, forever:
 * the token is a signed claim over the address (packages/email).
 *
 *  - GET  → a single-button confirmation page. The button matters: mail
 *    scanners prefetch GETs, and a prefetch must not unsubscribe anyone.
 *  - POST → performs the suppression. Mail clients hit this directly via
 *    List-Unsubscribe-Post (one-click); the GET page's form posts here too.
 *
 * Suppression is idempotent — repeating the request is always safe.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { esc, verifyUnsubscribeToken } from '@nibbin/email';
import { serviceClient } from '../../../../lib/supabase/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function secret(): string {
  const s = process.env.EMAIL_UNSUBSCRIBE_SECRET;
  if (!s) throw new Error('Missing EMAIL_UNSUBSCRIBE_SECRET');
  return s;
}

function page(body: string, status = 200): NextResponse {
  return new NextResponse(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Nibbin</title></head>
<body style="margin:0;background:#FBF6E6;font-family:Archivo,Arial,sans-serif;color:#23291A;">
<div style="max-width:480px;margin:64px auto;padding:32px;background:#FFFFFF;border:1px solid #EAEDE3;border-radius:12px;">${body}</div>
</body></html>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}

const invalid = () =>
  page(
    `<h1 style="font-size:20px;margin:0 0 12px;">That link didn't check out</h1>
     <p style="line-height:1.6;margin:0;">This unsubscribe link is malformed or was altered. Try the link from a newer email, or write to hello@nibbin.com and a person will sort it.</p>`,
    400,
  );

export async function GET(req: NextRequest): Promise<NextResponse> {
  const token = req.nextUrl.searchParams.get('token') ?? '';
  const email = verifyUnsubscribeToken(token, secret());
  if (!email) return invalid();

  // Confirmation page — one button, one action, no login (CAN-SPAM allows a
  // single page visit; the button keeps prefetchers from unsubscribing you).
  return page(
    `<h1 style="font-size:20px;margin:0 0 12px;">Stop these emails?</h1>
     <p style="line-height:1.6;margin:0 0 20px;">One click and we stop emailing <strong>${esc(email)}</strong>. Your grove keeps growing in the app either way.</p>
     <form method="post" action="/api/email/unsubscribe?token=${encodeURIComponent(token)}">
       <button type="submit" style="background:#44601F;color:#FFFFFF;border:0;border-radius:4px;padding:11px 20px;font-size:14px;font-weight:700;cursor:pointer;">Unsubscribe</button>
     </form>`,
  );
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const token = req.nextUrl.searchParams.get('token') ?? '';
  const email = verifyUnsubscribeToken(token, secret());
  if (!email) return invalid();

  const { error } = await serviceClient()
    .from('email_suppressions')
    .upsert({ email, reason: 'unsubscribe' }, { onConflict: 'email', ignoreDuplicates: true });
  if (error) {
    return page(
      `<h1 style="font-size:20px;margin:0 0 12px;">That didn't take</h1>
       <p style="line-height:1.6;margin:0;">Something went wrong on our side — try the link once more, or write to hello@nibbin.com and a person will sort it.</p>`,
      500,
    );
  }

  // No resubscribe promise: suppression is permanent by design (the list is
  // the CAN-SPAM record), and no settings toggle exists yet. Copy must not
  // claim more than the architecture delivers (claims-auditor M5 finding).
  return page(
    `<h1 style="font-size:20px;margin:0 0 12px;">Done — no more emails</h1>
     <p style="line-height:1.6;margin:0;">We won't email you again. Your grove keeps growing in the app either way.</p>`,
  );
}
