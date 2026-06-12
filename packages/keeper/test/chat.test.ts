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

  it('without a model wired, the scripted floor consumes no budget and never claims degradation', async () => {
    // Gate finding #25: budget consumption and the degradation notice must be
    // gated on an actual model dispatch. With no `generate`, every reply is the
    // zero-cost scripted floor — burning a frontier unit or telling the user
    // "doing this the simple way today" would both be lies.
    let takes = 0;
    const store = {
      take: async () => {
        takes += 1;
        return { granted: false, used: 0 };
      },
      used: async () => 0,
    };
    const router = createRouter({ dailyFrontierBudget: 0, budgetStore: store });
    const reply = await keeperChat(T2_TEXT, ctx, { route: (r) => router.route(r) });
    expect(takes).toBe(0);
    expect(reply.decision.degraded).toBe(false);
    expect(reply.decision.tier).toBe('t0');
    if (reply.message.card.kind !== 'prose') throw new Error('expected prose');
    expect(reply.message.card.text.startsWith(DEGRADATION_NOTICE)).toBe(false);
  });

  it('with a model wired, a degraded decision leads the reply with the transparent notice', async () => {
    const router = createRouter({ dailyFrontierBudget: 0 });
    const seen: string[] = [];
    const reply = await keeperChat(T2_TEXT, ctx, {
      route: (r) => router.route(r),
      generate: async (model) => {
        seen.push(model);
        return 'A plan, the simple way.';
      },
    });
    expect(reply.decision.degraded).toBe(true);
    expect(seen).toEqual([router.config.models.t1]);
    if (reply.message.card.kind !== 'prose') throw new Error('expected prose');
    expect(reply.message.card.text.startsWith(DEGRADATION_NOTICE)).toBe(true);
  });

  it('with a model wired, a granted frontier request consumes exactly one budget unit', async () => {
    const takes: string[] = [];
    const store = {
      take: async (userId: string) => {
        takes.push(userId);
        return { granted: true, used: 1 };
      },
      used: async () => 1,
    };
    const router = createRouter({ dailyFrontierBudget: 5, budgetStore: store });
    const reply = await keeperChat(T2_TEXT, ctx, {
      route: (r) => router.route(r),
      generate: async () => 'On it.',
    });
    expect(takes).toEqual(['user-1']);
    expect(reply.decision.tier).toBe('t2');
    expect(reply.decision.degraded).toBe(false);
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

  it('a model failure after routing falls back honestly: no tier claim, no degradation notice', async () => {
    // #25 on the real path: the decision reported to the surface must
    // describe what the user actually received. If the model call dies and
    // the scripted floor answers, claiming t1/t2 service or prepending the
    // degradation notice would both misreport the turn. (The spent budget
    // unit is kept in `budget` — the attempt happened and telemetry should
    // say so.)
    const router = createRouter({ dailyFrontierBudget: 0 });
    const reply = await keeperChat(T2_TEXT, ctx, {
      route: (r) => router.route(r),
      generate: async () => null, // provider outage / empty completion
    });
    expect(reply.decision.model).toBe('scripted-floor');
    expect(reply.decision.tier).toBe('t0');
    expect(reply.decision.degraded).toBe(false);
    expect(reply.decision.budget).toBeDefined(); // the consult is still reported
    if (reply.message.card.kind !== 'prose') throw new Error('expected prose');
    expect(reply.message.card.text.startsWith(DEGRADATION_NOTICE)).toBe(false);
  });

  it('caps input length before routing', async () => {
    const router = createRouter();
    let routedText = '';
    await keeperChat('x'.repeat(CHAT_INPUT_MAX * 3), ctx, {
      route: (r) => {
        routedText = r.text ?? '';
        return router.route(r);
      },
      generate: async () => null,
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
