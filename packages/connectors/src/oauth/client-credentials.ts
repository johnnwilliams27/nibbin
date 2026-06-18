/**
 * Resolve the OAuth client credentials for a provider from the environment, so
 * the connector layer can refresh an expired access token on a 401 without
 * depending on app-side config. Google-family connectors (gmail + google-*)
 * share one OAuth client; other providers are added here as they gain OAuth.
 *
 * Returns null when credentials are not configured — the caller then surfaces
 * the original auth error (the user must reconnect) rather than silently failing.
 */
export function oauthClientCredentials(provider: string): { clientId: string; clientSecret: string } | null {
  if (provider === 'gmail' || provider.startsWith('google-')) {
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    if (clientId && clientSecret) return { clientId, clientSecret };
  }
  return null;
}
