import { type NextRequest } from 'next/server';
import {
  handleConnectionCallback,
  makeCreateActiveConnection,
  exchangeViaEngine,
} from '../../../../../lib/connections/callback-core';
import { siteOrigin } from '../../../../../lib/site-url';
import { onGmailConnected } from '../../../../../lib/sweep/dispatch';

export const dynamic = 'force-dynamic';

// Re-exported so the existing unit test import path (connect-callback.test.ts)
// continues to resolve without change.
export { makeCreateActiveConnection, exchangeViaEngine };

export async function GET(request: NextRequest): Promise<Response> {
  return handleConnectionCallback(request, {
    // Gmail's pending.provider is 'gmail' but the path segment is 'google'.
    // No expectedProvider guard here — the dedicated route only handles Gmail.
    provider: 'gmail',
    postConnect: async (svc, pending, connectionId) => {
      // siteOrigin() (not request.url) is used so the internal HMAC-bearing sweep
      // worker POST targets our pinned origin — request.url derives from the
      // attacker-influenceable Host header on Vercel (RT-2 / SSRF).
      await onGmailConnected(
        svc,
        siteOrigin(),
        connectionId,
        pending.sweepConsent ?? false,
        pending.userId,
      );
    },
  });
}
