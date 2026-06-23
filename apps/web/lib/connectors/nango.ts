import 'server-only';
/**
 * Nango SDK singleton for server-side use (P4 Nango connector lane).
 * Never import @nangohq/node directly elsewhere in apps/web — use getNango().
 *
 * Uses the preferred `apiKey` constructor parameter (NANGO_SECRET_KEY env var).
 * The deprecated `secretKey` alias is intentionally NOT used — apiKey is the
 * stable API per @nangohq/node types.d.ts NangoProps discriminated union.
 *
 * webhookSigningKey is wired from NANGO_WEBHOOK_SIGNING_KEY so that
 * nango.verifyIncomingWebhookRequest() works in the callback route (Task 9).
 * This key differs from the API key — set it from the Nango dashboard under
 * Settings → Webhooks → Signing key. Without it, all webhook callbacks
 * will return 401 (fail-closed by design).
 */
import { Nango } from '@nangohq/node';

let _nango: Nango | null = null;

export function getNango(): Nango {
  if (!_nango) {
    const apiKey = process.env.NANGO_SECRET_KEY;
    if (!apiKey) throw new Error('NANGO_SECRET_KEY is not set');
    _nango = new Nango({
      apiKey,
      host: process.env.NANGO_HOST,
      // webhookSigningKey: required for verifyIncomingWebhookRequest() in the
      // callback route. When absent, Nango SDK returns false for all webhooks.
      webhookSigningKey: process.env.NANGO_WEBHOOK_SIGNING_KEY,
    });
  }
  return _nango;
}
