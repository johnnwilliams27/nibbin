/**
 * Planner validators (Slice 3a, design §5) — the trust boundary, applied twice:
 * fail-closed on the PlanSpec up front, AND fail-closed on every runtime pick.
 */
import { describe, expect, it } from 'vitest';
import {
  validatePlanSpec,
  validatePick,
  type PlanSpec,
} from '../src/index';

const GMAIL = ['gmail'];
const GMAIL_GCAL_STRIPE = ['gmail', 'google-calendar', 'stripe'];

function plan(overrides: Partial<PlanSpec> = {}): PlanSpec {
  return {
    kind: 'plan',
    ephemeral: true,
    goal: 'tell me what needs attention today',
    intendedSteps: ['read the inbox', 'summarize'],
    toolsAllowlist: ['email.read', 'memory.retrieve', 'done'],
    requiredConnectors: ['gmail'],
    weightClass: 'frontier',
    ceilings: { maxSteps: 60, maxTokens: 8000, maxWallClockMs: 60_000, maxIterations: 12 },
    ...overrides,
  };
}

describe('validatePlanSpec — fail-closed on the provisioned surface', () => {
  it('accepts a plan whose allowlist is connector cap + utility + done, with gmail granted', () => {
    const problems = validatePlanSpec(plan(), GMAIL, { webSearchEnabled: false });
    expect(problems).toEqual([]);
  });

  it('(a) rejects an allowlist entry that is neither a registry capability nor a utility id', () => {
    const problems = validatePlanSpec(
      plan({ toolsAllowlist: ['email.read', 'totally.bogus', 'done'] }),
      GMAIL,
      { webSearchEnabled: false },
    );
    expect(problems.join(' ')).toMatch(/totally\.bogus/);
  });

  it('(b) rejects an ungranted required connector', () => {
    const problems = validatePlanSpec(
      plan({ toolsAllowlist: ['payments.read', 'done'], requiredConnectors: ['stripe'] }),
      GMAIL, // stripe NOT granted
      { webSearchEnabled: false },
    );
    expect(problems.join(' ')).toMatch(/stripe/);
  });

  it('(c) rejects maxIterations over the bound (>30)', () => {
    const problems = validatePlanSpec(
      plan({ ceilings: { maxSteps: 60, maxTokens: 8000, maxWallClockMs: 60_000, maxIterations: 31 } }),
      GMAIL,
      { webSearchEnabled: false },
    );
    expect(problems.join(' ')).toMatch(/maxIterations/);
  });

  it('(d) rejects a web.* tool when no search provider is configured', () => {
    const problems = validatePlanSpec(
      plan({ toolsAllowlist: ['email.read', 'web.search', 'done'] }),
      GMAIL,
      { webSearchEnabled: false },
    );
    expect(problems.join(' ')).toMatch(/web\.search/);
  });

  it('accepts a web.* tool when the search provider IS configured', () => {
    const problems = validatePlanSpec(
      plan({ toolsAllowlist: ['email.read', 'web.search', 'done'] }),
      GMAIL,
      { webSearchEnabled: true },
    );
    expect(problems).toEqual([]);
  });

  it('accepts the richer surface with all three connectors granted', () => {
    const problems = validatePlanSpec(
      plan({
        toolsAllowlist: ['email.read', 'calendar.read', 'payments.read', 'memory.retrieve', 'done'],
        requiredConnectors: ['gmail', 'google-calendar', 'stripe'],
      }),
      GMAIL_GCAL_STRIPE,
      { webSearchEnabled: false },
    );
    expect(problems).toEqual([]);
  });
});

describe('validatePick — fail-closed per iteration', () => {
  const p = plan({ toolsAllowlist: ['email.read', 'memory.retrieve', 'done'] });
  const conns = GMAIL;

  it('accepts an in-allowlist connector read with a safe path', () => {
    const v = validatePick(
      { tool: 'email.read', args: { path: '/gmail/v1/users/me/messages?q=x' } },
      p,
      conns,
    );
    expect(v.ok).toBe(true);
  });

  it('accepts an in-allowlist utility with valid args', () => {
    const v = validatePick({ tool: 'memory.retrieve', args: { query: 'invoices', k: 5 } }, p, conns);
    expect(v.ok).toBe(true);
  });

  it('accepts a done pick', () => {
    const v = validatePick({ done: true, artifact: { summary: 'all clear' } }, p, conns);
    expect(v.ok).toBe(true);
  });

  it('(e) rejects a tool not in the plan allowlist', () => {
    const v = validatePick(
      { tool: 'email.send', args: { to: 'x@y.com' } },
      p,
      conns,
    );
    expect(v.ok).toBe(false);
  });

  it('(f) rejects args failing the schema (memory.retrieve k:99 over max)', () => {
    const v = validatePick({ tool: 'memory.retrieve', args: { query: 'x', k: 99 } }, p, conns);
    expect(v.ok).toBe(false);
  });

  it('(g) rejects a connector cap whose connector is not granted', () => {
    const stripePlan = plan({ toolsAllowlist: ['payments.read', 'done'], requiredConnectors: ['stripe'] });
    const v = validatePick(
      { tool: 'payments.read', args: { path: '/v1/invoices' } },
      stripePlan,
      GMAIL, // stripe not granted
    );
    expect(v.ok).toBe(false);
  });

  it('(h) rejects a read path failing assertSafeReadPath (traversal)', () => {
    const v = validatePick(
      { tool: 'email.read', args: { path: '../x' } },
      p,
      conns,
    );
    expect(v.ok).toBe(false);
  });

  it('rejects an ask_human pick with a bad kind', () => {
    const v = validatePick({ ask_human: true, kind: 'nonsense' as never, question: 'q' }, p, conns);
    expect(v.ok).toBe(false);
  });

  it('accepts an ask_human pick with a valid kind', () => {
    const v = validatePick({ ask_human: true, kind: 'value', question: 'what email?' }, p, conns);
    expect(v.ok).toBe(true);
  });
});
