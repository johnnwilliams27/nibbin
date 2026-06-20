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
    postConnect: async (svc, pending, connectionId) => {
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
