/**
 * OAuth endpoint configuration for hand-built [H] connectors. Aggregator [A]
 * connectors authenticate through the aggregator's hosted-auth session (see
 * src/aggregator.ts); generic [G] rails don't do OAuth at all (user-supplied
 * credentials go straight to the vault).
 *
 * Endpoints here must be covered by the connector's egress allowlist — the
 * registry test suite cross-checks that.
 */

export interface OAuthProviderConfig {
  authorizationUrl: string;
  tokenUrl: string;
  /** Static params some providers require on the authorization redirect. */
  extraAuthParams?: Record<string, string>;
  supportsPkce: boolean;
  /** Google-style `include_granted_scopes` incremental consent. */
  supportsIncrementalConsent: boolean;
}

const GOOGLE: OAuthProviderConfig = {
  authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  extraAuthParams: { access_type: 'offline', prompt: 'consent' },
  supportsPkce: true,
  supportsIncrementalConsent: true,
};

export const OAUTH_PROVIDERS: Record<string, OAuthProviderConfig> = {
  gmail: GOOGLE,
  'google-calendar': GOOGLE,
  'google-drive': GOOGLE,
  'google-sheets-docs': GOOGLE,
  stripe: {
    authorizationUrl: 'https://connect.stripe.com/oauth/authorize',
    tokenUrl: 'https://connect.stripe.com/oauth/token',
    supportsPkce: false,
    supportsIncrementalConsent: false,
  },
  honeybook: {
    authorizationUrl: 'https://api.honeybook.com/oauth/authorize',
    tokenUrl: 'https://api.honeybook.com/oauth/token',
    supportsPkce: true,
    supportsIncrementalConsent: false,
  },
  pixieset: {
    authorizationUrl: 'https://api.pixieset.com/oauth/authorize',
    tokenUrl: 'https://api.pixieset.com/oauth/token',
    supportsPkce: true,
    supportsIncrementalConsent: false,
  },
  'instagram-dm': {
    authorizationUrl: 'https://www.facebook.com/v23.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v23.0/oauth/access_token',
    supportsPkce: false,
    supportsIncrementalConsent: false,
  },
};
