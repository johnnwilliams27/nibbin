import 'server-only';
import { verifyGooglePubSubOidc, type VerifyResult, type OidcClaims } from '@nibbin/connectors';

export async function verifyPubSubRequest(
  authorizationHeader: string,
): Promise<VerifyResult & { claims?: OidcClaims }> {
  // Fail closed: the service-account identity is the real authentication factor
  // (the audience is just the public push-endpoint URL). If PUBSUB_SA_EMAIL is
  // unset, verifyGooglePubSubOidc would skip the email check entirely and accept
  // any Google-minted token with the right audience — so reject up front rather
  // than authenticate on the public URL alone.
  const expectedEmail = process.env.PUBSUB_SA_EMAIL;
  if (!expectedEmail?.trim()) {
    return { valid: false, reason: 'PUBSUB_SA_EMAIL not configured' };
  }
  return verifyGooglePubSubOidc(authorizationHeader, {
    expectedAudience: process.env.PUBSUB_PUSH_AUDIENCE ?? '',
    expectedEmail,
  });
}
