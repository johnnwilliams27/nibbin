import 'server-only';
import Stripe from 'stripe';

/**
 * Server-only Stripe client. `import 'server-only'` fails the build if pulled
 * into a client component, so the secret key can never reach the browser.
 */
let cached: Stripe | null = null;

export function stripe(): Stripe {
  if (cached) return cached;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('Missing STRIPE_SECRET_KEY');
  // Use the SDK's pinned API version (matches its types); bump the SDK to move it.
  cached = new Stripe(key);
  return cached;
}

export function webhookSecret(): string {
  const v = process.env.STRIPE_WEBHOOK_SECRET;
  if (!v) throw new Error('Missing STRIPE_WEBHOOK_SECRET');
  return v;
}
