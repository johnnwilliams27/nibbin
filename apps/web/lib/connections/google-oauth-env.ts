const SITE = () => (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://nibbin.com').replace(/\/$/, '');

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function getGoogleOAuthConfig(): GoogleOAuthConfig {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Missing GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET (see apps/web/.env.local)');
  }
  return { clientId, clientSecret, redirectUri: `${SITE()}/api/connect/google/callback` };
}
