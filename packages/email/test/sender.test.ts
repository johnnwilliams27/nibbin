/**
 * Sender pipeline: suppression always wins, the warm-up ramp caps daily
 * volume (and an unconfigured ramp sends NOTHING — §6.8 says warm-up and
 * webhooks precede the first send), sends are logged, unsubscribe tokens
 * round-trip, and the provider webhook maps to suppressions.
 */
import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import type { BeatEmail } from '@nibbin/drip';
import { createBeatMailer } from '../src/sender';
import { unsubscribeToken, verifyUnsubscribeToken } from '../src/unsubscribe';
import { DEFAULT_WARMUP_SCHEDULE, warmupDailyCap } from '../src/warmup';
import { suppressionFromEvent, verifyWebhook } from '../src/webhook';
import type { MailerConfig, OutboundEmail } from '../src/types';

const CONFIG: MailerConfig = {
  from: 'Nibbin <keeper@mail.nibbin.com>',
  siteUrl: 'https://nibbin.com',
  postalAddress: '548 Market St PMB 00000, San Francisco, CA 94104',
  unsubscribeSecret: 'test-secret',
  warmupStart: new Date('2026-05-01T00:00:00Z'),
};

function beatEmail(to = 'casey@example.com'): BeatEmail {
  return {
    accountId: 'acct-1',
    to,
    beat: 'species',
    content: {
      key: 'species',
      title: 'Meet the six species',
      body: 'Every Nibbin is one of six species.',
      cards: [],
      celebration: null,
      ctaPath: '/app',
      ctaLabel: 'Wander the grove',
    },
  };
}

function harness(over: Partial<MailerConfig> = {}, sentToday = 0) {
  const suppressed = new Set<string>();
  const sent: OutboundEmail[] = [];
  const logged: { to: string }[] = [];
  const mailer = createBeatMailer({
    config: { ...CONFIG, ...over },
    suppressions: {
      isSuppressed: async (e) => suppressed.has(e),
      add: async (e) => void suppressed.add(e),
    },
    log: {
      countForUtcDay: async () => sentToday + logged.length,
      record: async (entry) => void logged.push(entry),
    },
    provider: {
      send: async (msg) => {
        sent.push(msg);
        return { id: `prov-${sent.length}` };
      },
    },
    clock: () => new Date('2026-06-11T12:00:00Z'),
  });
  return { mailer, suppressed, sent, logged };
}

describe('createBeatMailer', () => {
  it('sends, logs, and normalizes the address', async () => {
    const h = harness();
    const outcome = await h.mailer.sendBeatDetailed({ ...beatEmail('  Casey@Example.com ') });
    expect(outcome.sent).toBe(true);
    expect(h.sent[0].to).toBe('casey@example.com');
    expect(h.logged).toHaveLength(1);
  });

  it('a suppressed address never receives mail', async () => {
    const h = harness();
    h.suppressed.add('casey@example.com');
    const outcome = await h.mailer.sendBeatDetailed(beatEmail());
    expect(outcome).toEqual({ sent: false, withheld: 'suppressed' });
    expect(h.sent).toHaveLength(0);
    expect(h.logged).toHaveLength(0);
  });

  it('sends NOTHING when warm-up was never configured', async () => {
    const h = harness({ warmupStart: null });
    const outcome = await h.mailer.sendBeatDetailed(beatEmail());
    expect(outcome).toEqual({ sent: false, withheld: 'warmup_unconfigured' });
    expect(h.sent).toHaveLength(0);
  });

  it('withholds at the warm-up daily cap', async () => {
    // 2026-06-11 is 41 days after warm-up start → week 5 → cap lifted; pin
    // the clock into week 0 instead.
    const h = harness({ warmupStart: new Date('2026-06-10T00:00:00Z') }, 20);
    const outcome = await h.mailer.sendBeatDetailed(beatEmail());
    expect(outcome).toEqual({ sent: false, withheld: 'warmup_cap' });
  });

  it('warm-up schedule ramps and then lifts', () => {
    const start = new Date('2026-05-01T00:00:00Z');
    expect(warmupDailyCap(start, new Date('2026-05-02T00:00:00Z'))).toBe(DEFAULT_WARMUP_SCHEDULE[0]);
    expect(warmupDailyCap(start, new Date('2026-05-10T00:00:00Z'))).toBe(DEFAULT_WARMUP_SCHEDULE[1]);
    expect(warmupDailyCap(start, new Date('2026-07-01T00:00:00Z'))).toBe(Number.POSITIVE_INFINITY);
    // A ramp set in the future sends nothing yet.
    expect(warmupDailyCap(start, new Date('2026-04-30T00:00:00Z'))).toBe(0);
  });

  it('rejects garbage addresses without calling the provider', async () => {
    const h = harness();
    const outcome = await h.mailer.sendBeatDetailed(beatEmail('not-an-address'));
    expect(outcome).toEqual({ sent: false, withheld: 'invalid_address' });
    expect(h.sent).toHaveLength(0);
  });
});

describe('unsubscribe tokens', () => {
  it('round-trips and normalizes', () => {
    const token = unsubscribeToken(' Casey@Example.com ', 's3cret');
    expect(verifyUnsubscribeToken(token, 's3cret')).toBe('casey@example.com');
  });

  it('rejects tampering, wrong secrets, and garbage', () => {
    const token = unsubscribeToken('casey@example.com', 's3cret');
    expect(verifyUnsubscribeToken(token, 'other')).toBeNull();
    expect(verifyUnsubscribeToken(`${token}x`, 's3cret')).toBeNull();
    expect(verifyUnsubscribeToken('....', 's3cret')).toBeNull();
    expect(verifyUnsubscribeToken('', 's3cret')).toBeNull();
    const [payload] = token.split('.');
    expect(verifyUnsubscribeToken(`${payload}.AAAA`, 's3cret')).toBeNull();
  });
});

describe('provider webhook', () => {
  const secret = `whsec_${Buffer.from('webhook-test-key').toString('base64')}`;

  function sign(id: string, ts: string, payload: string): string {
    const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
    const mac = createHmac('sha256', key).update(`${id}.${ts}.${payload}`).digest('base64');
    return `v1,${mac}`;
  }

  it('verifies a signed payload and rejects tampering + replays', () => {
    const now = new Date('2026-06-11T12:00:00Z');
    const ts = String(Math.floor(now.getTime() / 1000));
    const payload = JSON.stringify({ type: 'email.bounced', data: { to: ['x@example.com'] } });
    const headers = { id: 'msg_1', timestamp: ts, signature: sign('msg_1', ts, payload) };

    expect(verifyWebhook(secret, payload, headers, now)).toBe(true);
    expect(verifyWebhook(secret, payload + ' ', headers, now)).toBe(false);
    // Stale timestamp = replay.
    const old = new Date(now.getTime() + 10 * 60 * 1000);
    expect(verifyWebhook(secret, payload, headers, old)).toBe(false);
    expect(verifyWebhook(secret, payload, { ...headers, signature: 'v1,AAAA' }, now)).toBe(false);
  });

  it('maps bounces and complaints to suppressions, ignores the rest', () => {
    expect(suppressionFromEvent({ type: 'email.bounced', data: { to: ['A@Example.com'] } })).toEqual({
      email: 'a@example.com',
      reason: 'bounce',
    });
    expect(suppressionFromEvent({ type: 'email.complained', data: { to: 'b@example.com' } })).toEqual({
      email: 'b@example.com',
      reason: 'complaint',
    });
    expect(suppressionFromEvent({ type: 'email.delivered', data: { to: ['c@example.com'] } })).toBeNull();
    expect(suppressionFromEvent({ type: 'email.bounced', data: { to: [42] } })).toBeNull();
    expect(suppressionFromEvent('junk')).toBeNull();
  });
});
