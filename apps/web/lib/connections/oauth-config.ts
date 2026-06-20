const SITE = () => (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://nibbin.com').replace(/\/$/, '');

export interface OAuthClientConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/** The URL path segment a provider's OAuth callback lands on. Gmail predates
 *  the per-provider scheme and keeps its historical /google/ path; every other
 *  provider uses its own connector id as the segment. */
export function callbackPathFor(provider: string): string {
  return provider === 'gmail' ? 'google' : provider;
}

/** Which env vars hold a provider's OAuth client creds. Google-family providers
 *  (gmail, google-calendar, ...) all share the one Google OAuth app. */
function credEnvFor(provider: string): { id: string; secret: string } {
  if (provider.startsWith('google') || provider === 'gmail') {
    return { id: 'GOOGLE_OAUTH_CLIENT_ID', secret: 'GOOGLE_OAUTH_CLIENT_SECRET' };
  }
  // Future providers map here (e.g. stripe → STRIPE_OAUTH_*). Not used this slice.
  const up = provider.replace(/-/g, '_').toUpperCase();
  return { id: `${up}_OAUTH_CLIENT_ID`, secret: `${up}_OAUTH_CLIENT_SECRET` };
}

export function getOAuthConfigFor(provider: string): OAuthClientConfig {
  const env = credEnvFor(provider);
  const clientId = process.env[env.id];
  const clientSecret = process.env[env.secret];
  if (!clientId || !clientSecret) {
    throw new Error(`Missing ${env.id} / ${env.secret} (see apps/web/.env.local)`);
  }
  return { clientId, clientSecret, redirectUri: `${SITE()}/api/connect/${callbackPathFor(provider)}/callback` };
}
