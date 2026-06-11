import { describe, expect, it } from 'vitest';
import { createRouter, DEGRADATION_NOTICE } from '@nibbin/router';
import { CHAT_INPUT_MAX, keeperChat } from '../src/index';

const T2_TEXT = `Plan a complete end-to-end overhaul of my booking workflow. First, audit the current intake.
  Then design the new flow step by step:
  1. capture
  2. qualify
  3. follow up
  Finally, summarize the strategy.`;

const ctx = { userId: 'user-1', keeperName: 'Bramble' };

describe('keeperChat routes through §6.3 before replying', () => {
  it('smalltalk routes t0 and replies in keeper voice', async () => {
    const router = createRouter();
    const reply = await keeperChat('hi there', ctx, { route: (r) => router.route(r) });
    expect(reply.decision.tier).toBe('t0');
    expect(reply.message.card.kind).toBe('prose');
    expect(reply.message.card.transcript.length).toBeGreaterThan(0);
  });

  it('a degraded decision leads the reply with the transparent notice', async () => {
    const router = createRouter({ dailyFrontierBudget: 0 });
    const reply = await keeperChat(T2_TEXT, ctx, { route: (r) => router.route(r) });
    expect(reply.decision.degraded).toBe(true);
    if (reply.message.card.kind !== 'prose') throw new Error('expected prose');
    expect(reply.message.card.text.startsWith(DEGRADATION_NOTICE)).toBe(true);
  });

  it('uses the generate hook when provided, scripted floor when it returns null', async () => {
    const router = createRouter();
    const seen: string[] = [];
    const withModel = await keeperChat('draft a thank-you note for my client', ctx, {
      route: (r) => router.route(r),
      generate: async (model) => {
        seen.push(model);
        return 'A drafted note.';
      },
    });
    expect(seen).toEqual([router.config.models.t1]);
    if (withModel.message.card.kind !== 'prose') throw new Error('expected prose');
    expect(withModel.message.card.text).toBe('A drafted note.');

    const fallback = await keeperChat('hello', ctx, {
      route: (r) => router.route(r),
      generate: async () => null,
    });
    expect(fallback.message.card.transcript.length).toBeGreaterThan(0);
  });

  it('caps input length before routing', async () => {
    const router = createRouter();
    let routedText = '';
    await keeperChat('x'.repeat(CHAT_INPUT_MAX * 3), ctx, {
      route: (r) => {
        routedText = r.text ?? '';
        return router.route(r);
      },
    });
    expect(routedText.length).toBe(CHAT_INPUT_MAX);
  });

  it('answers the money question in plain terms', async () => {
    const router = createRouter();
    const reply = await keeperChat('what do credits cost me?', ctx, { route: (r) => router.route(r) });
    if (reply.message.card.kind !== 'prose') throw new Error('expected prose');
    expect(reply.message.card.text).toMatch(/credits/i);
  });
});
