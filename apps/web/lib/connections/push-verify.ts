import 'server-only';
import { verifyGooglePubSubOidc, type VerifyResult, type OidcClaims } from '@nibbin/connectors';

export async function verifyPubSubRequest(
  authorizationHeader: string,
): Promise<VerifyResult & { claims?: OidcClaims }> {
  return verifyGooglePubSubOidc(authorizationHeader, {
    expectedAudience: process.env.PUBSUB_PUSH_AUDIENCE ?? '',
    expectedEmail: process.env.PUBSUB_SA_EMAIL,
  });
}
