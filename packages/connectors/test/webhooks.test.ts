/**
 * Webhook signature verification + replay/idempotency (SPEC §6.5).
 * Positive vectors are constructed with the same crypto the providers use;
 * negative cases cover tampering, replay windows, and malformed headers.
 */
import { describe, it, expect } from 'vitest';
import { createHmac, generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import {
  verifyHmacSha256,
  verifyStripeSignature,
  verifyMetaSignature,
  verifySlackSignature,
  verifyGoogleChannelToken,
  verifyGooglePubSubOidc,
  type Jwk,
} from '../src/webhooks/verify';
import { MemoryWebhookEventStore, isWithinReplayWindow } from '../src/webhooks/idempotency';

const hmac = (secret: string, payload: string) => createHmac('sha256', secret).update(payload).digest('hex');

describe('generic HMAC-SHA256', () => {
  it('accepts a correct signature and rejects tampering', () => {
    const body = '{"event":"gallery.published"}';
    const sig = hmac('whsec_abc', body);
    expect(verifyHmacSha256(body, sig, 'whsec_abc').valid).toBe(true);
    expect(verifyHmacSha256(body + ' ', sig, 'whsec_abc').valid).toBe(false);
    expect(verifyHmacSha256(body, sig, 'whsec_other').valid).toBe(false);
    expect(verifyHmacSha256(body, 'zz-not-hex', 'whsec_abc').valid).toBe(false);
    expect(verifyHmacSha256(body, sig, '').valid).toBe(false);
  });
});

describe('Stripe scheme (t=,v1= over `${t}.${body}`)', () => {
  const secret = 'whsec_stripe';
  const body = '{"id":"evt_1"}';
  const make = (t: number) => `t=${t},v1=${hmac(secret, `${t}.${body}`)}`;

  it('accepts a fresh, correctly signed event', () => {
    expect(verifyStripeSignature(body, make(1000), secret, { nowSecs: 1100 }).valid).toBe(true);
  });

  it('rejects outside the replay window', () => {
    const r = verifyStripeSignature(body, make(1000), secret, { nowSecs: 1000 + 301 });
    expect(r).toEqual({ valid: false, reason: 'outside replay window' });
  });

  it('rejects tampered bodies and missing parts', () => {
    expect(verifyStripeSignature('{"id":"evt_2"}', make(1000), secret, { nowSecs: 1100 }).valid).toBe(false);
    expect(verifyStripeSignature(body, `v1=${hmac(secret, `1000.${body}`)}`, secret, { nowSecs: 1100 }).valid).toBe(false);
    expect(verifyStripeSignature(body, 't=1000', secret, { nowSecs: 1100 }).valid).toBe(false);
  });

  it('accepts when any v1 matches (key rotation)', () => {
    const header = `t=1000,v1=${'0'.repeat(64)},v1=${hmac(secret, `1000.${body}`)}`;
    expect(verifyStripeSignature(body, header, secret, { nowSecs: 1100 }).valid).toBe(true);
  });
});

describe('Meta X-Hub-Signature-256', () => {
  it('verifies sha256= over the raw body', () => {
    const body = '{"object":"instagram"}';
    expect(verifyMetaSignature(body, `sha256=${hmac('app-secret', body)}`, 'app-secret').valid).toBe(true);
    expect(verifyMetaSignature(body, hmac('app-secret', body), 'app-secret').valid).toBe(false); // no prefix
    expect(verifyMetaSignature(body, `sha256=${hmac('wrong', body)}`, 'app-secret').valid).toBe(false);
  });
});

describe('Slack v0', () => {
  const secret = 'slack-signing';
  const body = 'payload=%7B%7D';
  const make = (ts: number) => `v0=${hmac(secret, `v0:${ts}:${body}`)}`;

  it('verifies and replay-bounds', () => {
    expect(verifySlackSignature(body, make(5000), '5000', secret, { nowSecs: 5010 }).valid).toBe(true);
    expect(verifySlackSignature(body, make(5000), '5000', secret, { nowSecs: 5000 + 400 }).valid).toBe(false);
    expect(verifySlackSignature(body, make(5000), '5001', secret, { nowSecs: 5010 }).valid).toBe(false);
    expect(verifySlackSignature(body, make(5000), 'NaN', secret, { nowSecs: 5010 }).valid).toBe(false);
  });
});

describe('Google channel token (Calendar/Drive push)', () => {
  it('timing-safe token compare', () => {
    expect(verifyGoogleChannelToken('tok-1', 'tok-1').valid).toBe(true);
    expect(verifyGoogleChannelToken('tok-2', 'tok-1').valid).toBe(false);
    expect(verifyGoogleChannelToken('tok-1', '').valid).toBe(false);
  });
});

describe('Google Pub/Sub OIDC (Gmail watch)', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' }) as Jwk;
  const jwks: { keys: Jwk[] } = { keys: [{ ...jwk, kid: 'test-key', alg: 'RS256' }] };

  const makeJwt = (claims: Record<string, unknown>, header: Record<string, unknown> = { alg: 'RS256', kid: 'test-key' }) => {
    const h = Buffer.from(JSON.stringify(header)).toString('base64url');
    const c = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const sig = cryptoSign('RSA-SHA256', Buffer.from(`${h}.${c}`), privateKey).toString('base64url');
    return `${h}.${c}.${sig}`;
  };

  const baseClaims = {
    iss: 'https://accounts.google.com',
    aud: 'https://nibbin.com/api/webhooks/gmail',
    exp: 10_000,
    iat: 9000,
    email: 'push@nibbin-project.iam.gserviceaccount.com',
    email_verified: true,
  };
  const opts = {
    expectedAudience: 'https://nibbin.com/api/webhooks/gmail',
    expectedEmail: 'push@nibbin-project.iam.gserviceaccount.com',
    nowSecs: 9500,
    jwks,
  };

  it('accepts a valid push JWT', async () => {
    const r = await verifyGooglePubSubOidc(`Bearer ${makeJwt(baseClaims)}`, opts);
    expect(r.valid).toBe(true);
  });

  it('rejects wrong audience / issuer / expiry / service account', async () => {
    expect((await verifyGooglePubSubOidc(`Bearer ${makeJwt({ ...baseClaims, aud: 'https://evil' })}`, opts)).valid).toBe(false);
    expect((await verifyGooglePubSubOidc(`Bearer ${makeJwt({ ...baseClaims, iss: 'https://evil' })}`, opts)).valid).toBe(false);
    expect((await verifyGooglePubSubOidc(`Bearer ${makeJwt({ ...baseClaims, exp: 9000 })}`, opts)).valid).toBe(false);
    expect(
      (await verifyGooglePubSubOidc(`Bearer ${makeJwt({ ...baseClaims, email: 'evil@x.iam.gserviceaccount.com' })}`, opts)).valid,
    ).toBe(false);
  });

  it('fails closed when expectedAudience is empty, even if the token aud is also empty', async () => {
    // An unset PUBSUB_PUSH_AUDIENCE reaches the verifier as '' — it must never
    // satisfy the audience check, even against a token carrying an empty aud.
    const r = await verifyGooglePubSubOidc(`Bearer ${makeJwt({ ...baseClaims, aud: '' })}`, {
      ...opts,
      expectedAudience: '',
    });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.reason).toBe('bad audience');
  });

  it('rejects alg confusion and tampered signatures', async () => {
    expect(
      (await verifyGooglePubSubOidc(`Bearer ${makeJwt(baseClaims, { alg: 'none', kid: 'test-key' })}`, opts)).valid,
    ).toBe(false);
    const jwt = makeJwt(baseClaims);
    const tampered = jwt.slice(0, -4) + 'AAAA';
    expect((await verifyGooglePubSubOidc(`Bearer ${tampered}`, opts)).valid).toBe(false);
    expect((await verifyGooglePubSubOidc('Bearer not.a.jwt', opts)).valid).toBe(false);
    expect((await verifyGooglePubSubOidc('Basic abc', opts)).valid).toBe(false);
  });
});

describe('idempotency + replay windows (§6.9)', () => {
  it('records an event exactly once', async () => {
    const store = new MemoryWebhookEventStore();
    expect(await store.recordOnce('stripe', 'evt_1')).toBe(true);
    expect(await store.recordOnce('stripe', 'evt_1')).toBe(false);
    expect(await store.recordOnce('square', 'evt_1')).toBe(true); // provider-scoped
  });

  it('hasRecord reads without claiming (#113)', async () => {
    const store = new MemoryWebhookEventStore();
    // Unseen key: read returns false and does NOT claim it.
    expect(await store.hasRecord('gmail', 'k:nib-1')).toBe(false);
    expect(await store.recordOnce('gmail', 'k:nib-1')).toBe(true); // still first-fire
    // Now seen: read returns true; recordOnce reports it as a duplicate.
    expect(await store.hasRecord('gmail', 'k:nib-1')).toBe(true);
    expect(await store.recordOnce('gmail', 'k:nib-1')).toBe(false);
    // Provider-scoped, like recordOnce.
    expect(await store.hasRecord('square', 'k:nib-1')).toBe(false);
  });

  it('replay window helper bounds both directions', () => {
    expect(isWithinReplayWindow(10_000, 300, 10_000 + 299_000)).toBe(true);
    expect(isWithinReplayWindow(10_000, 300, 10_000 + 301_000)).toBe(false);
    expect(isWithinReplayWindow(10_000 + 301_000, 300, 10_000)).toBe(false);
  });
});
