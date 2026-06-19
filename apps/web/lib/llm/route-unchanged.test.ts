/**
 * Routing-reinforcement Slice A — the load-bearing "pure observability" guard.
 *
 * Slice A adds SIGNAL capture (outcome/degraded/latency) and a scoreboard; it
 * must NOT change which model route() picks for any task. This test pins the
 * resolved model for representative tasks across the tier table to their known
 * values — if a future Slice-A change accidentally perturbs routing, this fails.
 * (packages/router's own suite stays UNCHANGED, also proving no routing change;
 * this is the property restated from the Slice-A side.)
 */
import { describe, expect, it } from 'vitest';
import { createRouter } from '@nibbin/router';

// The router the web app builds (grove/router.ts) uses @nibbin/router defaults:
// T0/T1 Haiku, T2 Sonnet, Opus diagnosis pin (founder decision 2026-06-12). A
// generous budget so the T2 budget gate doesn't degrade the representative call.
function defaultRouter() {
  return createRouter({ dailyFrontierBudget: 1000 });
}

describe('route() is unchanged by Slice A (pure observability)', () => {
  it('specialist_draft → T1 Haiku', async () => {
    const d = await defaultRouter().route({ userId: 'u', task: 'specialist_draft', origin: 'pipeline' });
    expect(d.tier).toBe('t1');
    expect(d.model).toBe('claude-haiku-4-5-20251001');
    expect(d.degraded).toBe(false);
  });

  it('diagnosis_synthesis → T2 Opus pin (the deliberate splurge)', async () => {
    const d = await defaultRouter().route({ userId: 'u', task: 'diagnosis_synthesis', origin: 'pipeline' });
    expect(d.tier).toBe('t2');
    expect(d.model).toBe('claude-opus-4-8');
  });

  it('scan_synthesis → T1 Haiku', async () => {
    const d = await defaultRouter().route({ userId: 'u', task: 'scan_synthesis', origin: 'pipeline' });
    expect(d.tier).toBe('t1');
    expect(d.model).toBe('claude-haiku-4-5-20251001');
  });

  it('plan_synthesis (chat) → T2 Sonnet under budget', async () => {
    const d = await defaultRouter().route({ userId: 'u', task: 'plan_synthesis', origin: 'chat' });
    expect(d.tier).toBe('t2');
    expect(d.model).toBe('claude-sonnet-4-6');
    expect(d.degraded).toBe(false);
  });
});
