import { describe, expect, it } from 'vitest';
import {
  CHAT_CEILING_NOTICE,
  classifyComplexity,
  createRouter,
  dayKey,
  DEGRADATION_NOTICE,
  InMemoryBudgetStore,
  TIER_FOR_TASK,
  type RoutedTask,
  type RouteRequest,
  type Tier,
} from '../src/index';

const chat = (text: string, extra: Partial<RouteRequest> = {}): RouteRequest => ({
  userId: 'user-1',
  task: 'chat',
  origin: 'chat',
  text,
  ...extra,
});

describe('tier table (§6.3)', () => {
  const expectations: Array<[Exclude<RoutedTask, 'chat'>, Tier]> = [
    ['smalltalk', 't0'],
    ['intent_classification', 't0'],
    ['routing', 't0'],
    ['formatting', 't0'],
    ['field_notes_copy', 't0'],
    ['journal_phrasing', 't0'],
    ['style_extraction', 't0'],
    ['specialist_draft', 't1'],
    ['scan_synthesis', 't1'],
    ['training_feedback', 't1'],
    ['map_labeling', 't1'],
    ['diagnosis_synthesis', 't2'],
    ['custom_spec_draft', 't2'],
    ['nibbin_note', 't2'],
    ['complex_plan', 't2'],
  ];

  it.each(expectations)('%s routes to %s', async (task, tier) => {
    // generous budget so the tier mapping is what's under test here
    const router = createRouter({ dailyFrontierBudget: 100 });
    const decision = await router.route({ userId: 'u', task, origin: 'pipeline' });
    expect(decision.tier).toBe(tier);
    // task pins (the Opus diagnosis pin) override the tier default
    expect(decision.model).toBe(router.config.taskModels[task] ?? router.config.models[tier]);
    expect(decision.degraded).toBe(false);
    expect(decision.notice).toBeNull();
  });

  it('the diagnosis + nibbin note ride the Opus pin; plain t2 rides the tier default', async () => {
    const router = createRouter({ dailyFrontierBudget: 100 });
    const diagnosis = await router.route({ userId: 'u', task: 'diagnosis_synthesis', origin: 'pipeline' });
    expect(diagnosis.model).toBe('claude-opus-4-8');
    const note = await router.route({ userId: 'u', task: 'nibbin_note', origin: 'pipeline' });
    expect(note.model).toBe('claude-opus-4-8');
    const plan = await router.route({ userId: 'u', task: 'complex_plan', origin: 'pipeline' });
    expect(plan.model).toBe(router.config.models.t2);
  });

  it('the nibbin note runs unbudgeted from pipeline origin (its own staleness gate)', async () => {
    // dailyFrontierBudget 0 would degrade any budgeted t2; the note must still
    // serve t2 because it's a named pipeline splurge.
    const router = createRouter({ dailyFrontierBudget: 0 });
    const note = await router.route({ userId: 'u', task: 'nibbin_note', origin: 'pipeline' });
    expect(note.tier).toBe('t2');
    expect(note.degraded).toBe(false);
  });

  it('the table covers every task except chat', () => {
    // 15 base tasks + sweep_pass1/sweep_pass2 (Spec 4 history sweep)
    // + memory_extract (§12A agent memory) + plan_synthesis (Slice 3a)
    // + style_extraction (§4A style profile) = 20
    // + doc_extract + doc_vision_extract (P2 document ingestion) = 22
    // + synthesis (P5 §6b) = 23.
    expect(Object.keys(TIER_FOR_TASK)).toHaveLength(23);
  });
});

describe('complexity classifier', () => {
  it('routes smalltalk to t0', () => {
    for (const text of ['hi', 'Hey there!', 'thanks', 'good morning', 'ok cool']) {
      expect(classifyComplexity(text).tier).toBe('t0');
    }
  });

  it('routes short factual questions to t0', () => {
    expect(classifyComplexity('how many credits do I have left?').tier).toBe('t0');
  });

  it('routes drafting work to t1', () => {
    const c = classifyComplexity(
      'Can you draft a reply to the client who asked about rescheduling their shoot to next month? Keep it friendly.',
    );
    expect(c.tier).toBe('t1');
    expect(c.signals).toContain('drafting');
  });

  it('routes genuinely complex multi-step plans to t2', () => {
    const c = classifyComplexity(
      `I want to restructure how I handle inquiries end-to-end. First, audit where leads come from across email and Instagram.
       Then design a workflow so every inquiry gets a same-day reply, a follow-up after three days, and a final nudge.
       1. map the current flow
       2. plan the new one
       3. summarize what changes for me week to week.
       Finally, write the plan up so I can review it.`,
    );
    expect(c.tier).toBe('t2');
    expect(c.score).toBeGreaterThanOrEqual(0.7);
  });

  it('is deterministic', () => {
    const text = 'Draft a plan to migrate my invoices, then summarize it.';
    expect(classifyComplexity(text)).toEqual(classifyComplexity(text));
  });

  it('empty text is t0 with score 0', () => {
    expect(classifyComplexity('')).toEqual({ tier: 't0', score: 0, signals: [] });
  });
});

const T2_CHAT = `Plan a complete end-to-end overhaul of my booking workflow. First, audit the current intake.
  Then design the new flow step by step:
  1. capture
  2. qualify
  3. follow up
  Finally, summarize the strategy.`;

describe('frontier budget (per user per day)', () => {
  it('grants t2 from chat while budget remains, then degrades to t1 with the transparent notice', async () => {
    const router = createRouter({ dailyFrontierBudget: 2, now: () => new Date('2026-06-11T12:00:00Z') });

    const first = await router.route(chat(T2_CHAT));
    expect(first).toMatchObject({ tier: 't2', requestedTier: 't2', degraded: false, notice: null });
    expect(first.budget).toMatchObject({ limit: 2, used: 1, remaining: 1 });

    const second = await router.route(chat(T2_CHAT));
    expect(second.budget).toMatchObject({ used: 2, remaining: 0 });

    const third = await router.route(chat(T2_CHAT));
    expect(third.tier).toBe('t1');
    expect(third.requestedTier).toBe('t2');
    expect(third.degraded).toBe(true);
    expect(third.notice).toBe(DEGRADATION_NOTICE);
    expect(third.model).toBe(router.config.models.t1);
  });

  it('budgets are per user', async () => {
    const router = createRouter({ dailyFrontierBudget: 1 });
    await router.route(chat(T2_CHAT, { userId: 'a' }));
    const otherUser = await router.route(chat(T2_CHAT, { userId: 'b' }));
    expect(otherUser.degraded).toBe(false);
    const capped = await router.route(chat(T2_CHAT, { userId: 'a' }));
    expect(capped.degraded).toBe(true);
  });

  it('resets on the next UTC day', async () => {
    let now = new Date('2026-06-11T23:30:00Z');
    const router = createRouter({ dailyFrontierBudget: 1, now: () => now });
    await router.route(chat(T2_CHAT));
    expect((await router.route(chat(T2_CHAT))).degraded).toBe(true);

    now = new Date('2026-06-12T00:30:00Z');
    expect((await router.route(chat(T2_CHAT))).degraded).toBe(false);
  });

  it('keys the budget day to UTC, never the user timezone (#24/#52)', () => {
    // 23:30 UTC is already the next calendar day in Sydney, but the budget day
    // must not shift — tz is user-editable and must never move the window.
    expect(dayKey(new Date('2026-06-11T23:30:00Z'))).toBe('2026-06-11');
    expect(dayKey(new Date('2026-06-12T00:30:00Z'))).toBe('2026-06-12');
  });

  it('pipeline t2 (the diagnosis splurge) never draws the chat budget and is never degraded', async () => {
    const router = createRouter({ dailyFrontierBudget: 0 });
    const decision = await router.route({ userId: 'u', task: 'diagnosis_synthesis', origin: 'pipeline' });
    expect(decision.tier).toBe('t2');
    expect(decision.degraded).toBe(false);
    expect(decision.budget).toBeUndefined();
  });

  it('origin is not a budget bypass: complex_plan with origin pipeline is budgeted (#24)', async () => {
    const router = createRouter({ dailyFrontierBudget: 0 });
    const decision = await router.route({ userId: 'u', task: 'complex_plan', origin: 'pipeline' });
    expect(decision.tier).toBe('t1');
    expect(decision.degraded).toBe(true);
    expect(decision.notice).toBe(DEGRADATION_NOTICE);
    expect(decision.budget).toBeDefined();
  });

  it('the splurge tasks ARE budgeted when claimed from chat origin', async () => {
    const router = createRouter({ dailyFrontierBudget: 0 });
    const decision = await router.route({ userId: 'u', task: 'diagnosis_synthesis', origin: 'chat' });
    expect(decision.degraded).toBe(true);
    expect(decision.budget).toBeDefined();
    // degraded service never carries the requested-tier task pin
    expect(decision.model).toBe(router.config.models.t1);
  });

  it('chat t0/t1 never touches the budget', async () => {
    const store = new InMemoryBudgetStore();
    const router = createRouter({ budgetStore: store, dailyFrontierBudget: 1 });
    await router.route(chat('hi'));
    await router.route(chat('draft a quick thank-you note to a client'));
    expect(await store.used('user-1', dayKey(new Date()))).toBe(0);
  });

  it('a zero budget degrades every chat t2 — transparently', async () => {
    const router = createRouter({ dailyFrontierBudget: 0 });
    const decision = await router.route(chat(T2_CHAT));
    expect(decision.tier).toBe('t1');
    expect(decision.degraded).toBe(true);
    expect(decision.notice).toBe(DEGRADATION_NOTICE);
  });
});

describe('degradation is never silent', () => {
  it('every decision satisfies: degraded ⇔ notice present', async () => {
    const router = createRouter({ dailyFrontierBudget: 1 });
    const decisions = await Promise.all([
      router.route(chat('hi')),
      router.route(chat(T2_CHAT)),
      router.route(chat(T2_CHAT)),
      router.route({ userId: 'u', task: 'specialist_draft', origin: 'pipeline' }),
      router.route({ userId: 'u', task: 'diagnosis_synthesis', origin: 'pipeline' }),
    ]);
    for (const d of decisions) {
      if (d.degraded) {
        expect(d.notice).toBeTruthy();
      } else {
        expect(d.notice).toBeNull();
      }
    }
  });
});

describe('config', () => {
  it('rejects a missing model or negative budget', () => {
    expect(() => createRouter({ models: { t0: '', t1: 'x', t2: 'y' } })).toThrow(/missing model/);
    expect(() => createRouter({ dailyFrontierBudget: -1 })).toThrow(/non-negative/);
    expect(() => createRouter({ dailyFrontierBudget: 1.5 })).toThrow(/non-negative integer/);
  });

  it('hot-reloads models without dropping budget state', async () => {
    const router = createRouter({ dailyFrontierBudget: 1 });
    await router.route(chat(T2_CHAT)); // spend the day's budget
    router.reconfigure({ models: { ...router.config.models, t1: 'claude-sonnet-next' } });
    const degradedAfterReload = await router.route(chat(T2_CHAT));
    expect(degradedAfterReload.degraded).toBe(true); // budget survived the reload
    expect(degradedAfterReload.model).toBe('claude-sonnet-next');
  });

  it('reconfigure validates', () => {
    const router = createRouter();
    expect(() => router.reconfigure({ dailyFrontierBudget: -2 })).toThrow();
  });

  it('requires a userId', async () => {
    const router = createRouter();
    await expect(router.route(chat('hi', { userId: ' ' }))).rejects.toThrow(/userId/);
  });

  it('rejects an unvetted candidate model (never an unvetted model — fail-closed)', () => {
    // red-team P3 + logic-skeptic P3: an unknown id can never become eligible.
    expect(() =>
      createRouter({ taskCandidates: { specialist_draft: ['not-a-real-model'] } }),
    ).toThrow(/not a vetted model/);
  });

  it('rejects an empty-string candidate (logic-skeptic P3b)', () => {
    expect(() =>
      createRouter({ taskCandidates: { specialist_draft: [''] } }),
    ).toThrow(/empty candidate model/);
    expect(() =>
      createRouter({ taskCandidates: { specialist_draft: ['  '] } }),
    ).toThrow(/empty candidate model/);
  });

  it('accepts a candidate that is a known/vetted model', () => {
    // a configured tier model is always vetted...
    expect(() =>
      createRouter({ taskCandidates: { specialist_draft: ['claude-sonnet-4-6'] } }),
    ).not.toThrow();
    // ...and a claude-* challenger clears the structural shape gate.
    expect(() =>
      createRouter({ taskCandidates: { specialist_draft: ['claude-haiku-4-5-cheaper-variant'] } }),
    ).not.toThrow();
  });

  it('reconfigure also rejects an unvetted candidate', () => {
    const router = createRouter();
    expect(() =>
      router.reconfigure({ taskCandidates: { specialist_draft: ['nope'] } }),
    ).toThrow(/not a vetted model/);
  });
});

describe('daily chat ceiling (#230 — anti-runaway, all tiers)', () => {
  it('pauses chat for the day once the ceiling is reached — no spend past it', async () => {
    const router = createRouter({ now: () => new Date('2026-06-11T12:00:00Z') });
    const first = await router.route(chat('hi there', { dailyChatCeiling: 2 }));
    expect(first.paused).toBeFalsy();
    const second = await router.route(chat('hi again', { dailyChatCeiling: 2 }));
    expect(second.paused).toBeFalsy();

    const third = await router.route(chat('and again', { dailyChatCeiling: 2 }));
    expect(third).toMatchObject({ paused: true, degraded: false, notice: CHAT_CEILING_NOTICE });
    expect(third.budget).toMatchObject({ limit: 2, used: 2, remaining: 0 });
  });

  it('counts EVERY tier, not just T2 — a cheap T0 turn still draws the ceiling', async () => {
    const router = createRouter({ now: () => new Date('2026-06-11T12:00:00Z') });
    // two trivial T0 turns exhaust a ceiling of 2…
    await router.route(chat('hi', { dailyChatCeiling: 2 }));
    await router.route(chat('hello', { dailyChatCeiling: 2 }));
    // …so even a would-be T2 turn is paused, never reaching the model.
    const blocked = await router.route(chat(T2_CHAT, { dailyChatCeiling: 2 }));
    expect(blocked.paused).toBe(true);
  });

  it('no ceiling set → never pauses (unbounded — non-chat work, or tests)', async () => {
    const router = createRouter({ now: () => new Date('2026-06-11T12:00:00Z') });
    for (let i = 0; i < 50; i++) {
      const d = await router.route(chat('hi', {}));
      expect(d.paused).toBeFalsy();
    }
  });

  it('the chat ceiling and the T2 frontier budget are independent counters', async () => {
    // Generous ceiling, tight frontier budget: T2 degrades at the frontier cap
    // while the ceiling has room — separate 'kind' counters, no cross-talk.
    const router = createRouter({
      dailyFrontierBudget: 1,
      now: () => new Date('2026-06-11T12:00:00Z'),
    });
    const first = await router.route(chat(T2_CHAT, { dailyChatCeiling: 100 }));
    expect(first).toMatchObject({ tier: 't2' });
    expect(first.paused).toBeFalsy();
    const second = await router.route(chat(T2_CHAT, { dailyChatCeiling: 100 }));
    expect(second).toMatchObject({ tier: 't1', degraded: true });
    expect(second.paused).toBeFalsy();
  });
});
