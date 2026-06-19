import { describe, it, expect } from 'vitest';
import { gateTurn, type TurnGateDeps } from '@nibbin/channels';

const cfg = { turnLimit: 50, smsSpendCapMicroUsd: 200_000, defaultSpendCapMicroUsd: 1_000_000 };

function deps(over: Partial<TurnGateDeps> = {}): TurnGateDeps {
  return {
    async take() { return { granted: true, turns: 1, channelSpent: 0, warn: false }; },
    async anomaly() { return false; },
    ...over,
  };
}

describe('gateTurn', () => {
  it('passes when under budget and not anomalous', async () => {
    expect(await gateTurn('a', 'telegram', deps(), cfg)).toEqual({ ok: true });
  });
  it('blocks (budget) with a brand-voice breather notice', async () => {
    const r = await gateTurn('a', 'sms', deps({ async take() { return { granted: false, turns: 50, channelSpent: 0, warn: false }; } }), cfg);
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.reason).toBe('budget'); expect(r.notice).toMatch(/breather/i); expect(r.notice).toMatch(/app/i); }
  });
  it('blocks (anomaly) before spending', async () => {
    let takeCalls = 0;
    const d = deps({
      async anomaly() { return true; },
      async take() { takeCalls++; return { granted: true, turns: 0, channelSpent: 0, warn: false }; },
    });
    const r = await gateTurn('a', 'telegram', d, cfg);
    expect(r).toMatchObject({ ok: false, reason: 'anomaly' });
    expect(takeCalls).toBe(0);
  });
  it('returns { ok: true, warn: { notice } } when take returns granted=true, warn=true', async () => {
    const r = await gateTurn('a', 'sms', deps({ async take() { return { granted: true, turns: 5, channelSpent: 160_001, warn: true }; } }), cfg);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warn).toBeDefined();
      expect(r.warn?.notice).toMatch(/close to today's messaging limit/i);
    }
  });
  it('returns { ok: true } (no warn) when take returns granted=true, warn=false', async () => {
    const r = await gateTurn('a', 'telegram', deps({ async take() { return { granted: true, turns: 3, channelSpent: 100, warn: false }; } }), cfg);
    expect(r).toEqual({ ok: true });
  });
});
