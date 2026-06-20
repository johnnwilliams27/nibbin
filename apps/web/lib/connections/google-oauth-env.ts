import { getOAuthConfigFor, type OAuthClientConfig } from './oauth-config';

export type GoogleOAuthConfig = OAuthClientConfig;

/** @deprecated use getOAuthConfigFor('gmail'). Kept so existing imports resolve. */
export function getGoogleOAuthConfig(): GoogleOAuthConfig {
  return getOAuthConfigFor('gmail');
}
