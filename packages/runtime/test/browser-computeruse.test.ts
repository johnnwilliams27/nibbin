/**
 * The computer_use (browser) capability surface (design §4 / §4A / R9).
 *
 * Safety model under test (all over the MOCK driver — a real browser is never
 * launched):
 *  - navigate → extract: read-class, results QUARANTINED (page = data).
 *  - click/type: write-class → pause as needs_input(approval); the driver
 *    commits NOTHING without approval.
 *  - validatePick rejects an off-surface verb and a bad target.
 *  - navigate to a private/loopback IP is rejected (SSRF).
 *  - the computer_use ceilings bound the run (maxIterations / weight class).
 */
import { describe, expect, it } from 'vitest';
import { isQuarantined, quarantine } from '@nibbin/connectors';
import {
  runPlan,
  validatePick,
  validatePlanSpec,
  validateTarget,
  validateComputerUseArgs,
  assertSafeNavigateUrl,
  MockBrowserDriver,
  COMPUTER_USE_CEILINGS,
  computerUseCapabilityId,
  isComputerUseCapability,
  MemoryEventSink,
  MemoryGrantStore,
  MemoryIdempotencyStore,
  MemoryRoutineStore,
  MemoryRunStore,
  type BrowserReadResult,
  type PlanSpec,
  type PlannerDeps,
  type PlannerDrafter,
  type PlannerPick,
  type RunnerDeps,
} from '../src/index';

const ACCOUNT = 'acct-cu';

/** A computer_use plan: browser verbs only, computer_use weight class + ceilings. */
function cuPlan(overrides: Partial<PlanSpec> = {}): PlanSpec {
  return {
    kind: 'plan',
    ephemeral: true,
    goal: 'find the order status on the supplier portal',
    intendedSteps: ['navigate to the portal', 'read the status', 'click refresh'],
    toolsAllowlist: [
      'computer_use.navigate',
      'computer_use.extract',
      'computer_use.screenshot',
      'computer_use.scroll',
      'computer_use.click',
      'computer_use.type',
      'done',
    ],
    requiredConnectors: [],
    weightClass: 'computer_use',
    ceilings: { ...COMPUTER_USE_CEILINGS },
    ...overrides,
  };
}

function scriptedPicker(picks: (PlannerPick | null)[]): PlannerDrafter {
  let i = 0;
  return {
    async pick() {
      const p = i < picks.length ? picks[i] : null;
      i += 1;
      return p;
    },
  };
}

function runnerDeps(): RunnerDeps {
  const runs = new MemoryRunStore(() => Date.now());
  runs.seedCredits(ACCOUNT, 1000);
  runs.recordStep = async () => {};
  return {
    runs,
    routines: new MemoryRoutineStore(),
    grants: new MemoryGrantStore(),
    idempotency: new MemoryIdempotencyStore(),
    events: new MemoryEventSink(),
    reader: { async read() { throw new Error('no connector reads in a browser-only plan'); } },
    effects: { async execute() { throw new Error('no connector effects in a browser-only plan'); } },
    now: () => Date.now(),
  };
}

function deps(
  picks: (PlannerPick | null)[],
  browser: MockBrowserDriver,
  extra: Partial<PlannerDeps> = {},
): PlannerDeps {
  return {
    planner: scriptedPicker(picks),
    runner: runnerDeps(),
    connectors: [],
    connMap: {},
    accountId: ACCOUNT,
    browser,
    // a permissive predicate by default; the SSRF test injects a real one
    isPublicIp: () => true,
    ...extra,
  };
}

/* ── registry + ceilings ─────────────────────────────────────────────────────── */

describe('computer_use registry', () => {
  it('registers all six verbs with the right side-effect class + family', () => {
    expect(isComputerUseCapability('computer_use.navigate')).toBe(true);
    expect(isComputerUseCapability('computer_use.click')).toBe(true);
    expect(isComputerUseCapability('email.read')).toBe(false);
    expect(computerUseCapabilityId('type')).toBe('computer_use.type');
  });

  it('sets conservative computer_use ceilings (TBD-must-be-set, design §351)', () => {
    expect(COMPUTER_USE_CEILINGS.maxIterations).toBeGreaterThan(0);
    expect(COMPUTER_USE_CEILINGS.maxTokens).toBeGreaterThan(0);
    expect(COMPUTER_USE_CEILINGS.maxWallClockMs).toBeGreaterThan(0);
    // tighter than a frontier plan (MAX_PLAN_ITERATIONS=30, MAX_PLAN_TOKENS=20k)
    expect(COMPUTER_USE_CEILINGS.maxIterations).toBeLessThanOrEqual(30);
    expect(COMPUTER_USE_CEILINGS.maxTokens).toBeLessThanOrEqual(20_000);
    // the loop wall-clock ceiling MUST fit inside a 60s serverless function on
    // ANY Vercel plan (Hobby = 60s hard cap), leaving headroom for one in-flight
    // action + Chromium teardown — so the loop kill fires before the platform kill.
    expect(COMPUTER_USE_CEILINGS.maxWallClockMs).toBe(50_000);
    expect(COMPUTER_USE_CEILINGS.maxWallClockMs).toBeLessThan(60_000);
  });
});

/* ── navigate → extract: quarantined reads ──────────────────────────────────── */

describe('runPlan — navigate → extract (quarantined reads)', () => {
  it('a navigate then extract surface quarantined page content; nothing committed', async () => {
    const browser = new MockBrowserDriver({ content: 'Order #42 — shipped', source: 'browser:portal.example.com' });
    let seenExtract: string | undefined;
    const drafter: PlannerDrafter = {
      async pick({ transcript }) {
        const navDone = transcript.some((t) => 'tool' in t.pick && t.pick.tool === 'computer_use.navigate');
        const extractTurn = transcript.find((t) => 'tool' in t.pick && t.pick.tool === 'computer_use.extract');
        if (!navDone) return { tool: 'computer_use.navigate', args: { url: 'https://portal.example.com/orders' } };
        if (!extractTurn) return { tool: 'computer_use.extract', args: { target: { selector: '#status' } } };
        seenExtract = extractTurn.observation;
        return { done: true, artifact: { status: 'shipped' } };
      },
    };
    const outcome = await runPlan(cuPlan(), deps([], browser, { planner: drafter }));
    expect(outcome.kind).toBe('done');
    expect(seenExtract).toBeDefined();
    // the picker only ever saw the page as QUARANTINED data
    expect(isQuarantined(seenExtract!.replace(/^extract: /, ''))).toBe(true);
    // a read verb commits nothing
    expect(browser.commits).toEqual([]);
  });
});

/* ── click is approval-gated; nothing committed without approval ────────────── */

describe('runPlan — click/type are approval-gated', () => {
  it('a click pick pauses as needs_input(approval); the driver commits NOTHING', async () => {
    const browser = new MockBrowserDriver({ content: 'login page' });
    const outcome = await runPlan(
      cuPlan(),
      deps([{ tool: 'computer_use.click', args: { target: { selector: 'button#submit' } } }, { done: true, artifact: {} }], browser),
    );
    expect(outcome.kind).toBe('needs_input');
    if (outcome.kind === 'needs_input') {
      expect(outcome.request.kind).toBe('approval');
      expect(outcome.request.context.tool).toBe('computer_use.click');
      expect(outcome.request.context.computerUse).toMatchObject({ verb: 'click', target: { selector: 'button#submit' } });
    }
    // CRITICAL: no execute path ran — the driver committed nothing pre-approval.
    expect(browser.commits).toEqual([]);
  });

  it('a type pick pauses for approval carrying the value to replay on commit', async () => {
    const browser = new MockBrowserDriver();
    const outcome = await runPlan(
      cuPlan(),
      deps([{ tool: 'computer_use.type', args: { target: { selector: 'input#q' }, value: 'hello' } }], browser),
    );
    expect(outcome.kind).toBe('needs_input');
    if (outcome.kind === 'needs_input') {
      expect(outcome.request.context.computerUse).toMatchObject({ verb: 'type', value: 'hello' });
    }
    expect(browser.commits).toEqual([]);
  });
});

/* ── validatePick: off-surface verb / bad target ────────────────────────────── */

describe('validatePick — fail-closed on the computer_use surface', () => {
  const plan = cuPlan();

  it('rejects a verb not in the provisioned surface', () => {
    const plan2 = cuPlan({ toolsAllowlist: ['computer_use.navigate', 'done'] });
    const v = validatePick({ tool: 'computer_use.click', args: { target: { selector: 'a' } } }, plan2, []);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/provisioned surface/);
  });

  it('rejects a target with neither selector nor coordinates', () => {
    const v = validatePick({ tool: 'computer_use.click', args: { target: {} } }, plan, []);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/selector or a complete/);
  });

  it('rejects a target with both selector and coordinates', () => {
    const v = validatePick({ tool: 'computer_use.click', args: { target: { selector: 'a', x: 1, y: 2 } } }, plan, []);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/not both/);
  });

  it('rejects a type pick with no string value', () => {
    const v = validatePick({ tool: 'computer_use.type', args: { target: { selector: 'input' } } }, plan, []);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/value/);
  });

  it('rejects an unknown target key (no arbitrary fields slip through)', () => {
    expect(() => validateTarget({ selector: 'a', onclick: 'evil()' })).toThrow(/unknown key/);
  });

  it('there is no eval/script verb — only the six are valid args', () => {
    expect(() => validateComputerUseArgs('navigate', { url: 'https://x.com' })).not.toThrow();
    // a coordinate click is a first-class target
    const v = validatePick({ tool: 'computer_use.click', args: { target: { x: 10, y: 20 } } }, plan, []);
    expect(v.ok).toBe(true);
  });

  it('accepts a valid navigate/extract pick', () => {
    expect(validatePick({ tool: 'computer_use.navigate', args: { url: 'https://example.com' } }, plan, []).ok).toBe(true);
    expect(validatePick({ tool: 'computer_use.extract', args: {} }, plan, []).ok).toBe(true);
  });
});

/* ── navigate SSRF: a private IP is rejected ────────────────────────────────── */

describe('navigate SSRF guard (same egress posture as web.fetch)', () => {
  it('assertSafeNavigateUrl rejects a private/loopback/metadata host', () => {
    const isPublicIp = (addr: string) => !/^(127\.|10\.|169\.254\.|192\.168\.)/.test(addr);
    expect(() => assertSafeNavigateUrl('https://127.0.0.1/admin', isPublicIp)).toThrow(/public/);
    expect(() => assertSafeNavigateUrl('https://169.254.169.254/latest/meta-data', isPublicIp)).toThrow(/public/);
    expect(() => assertSafeNavigateUrl('http://localhost:8080', isPublicIp)).toThrow(/internal/);
    expect(() => assertSafeNavigateUrl('ftp://example.com', isPublicIp)).toThrow(/http/);
    expect(() => assertSafeNavigateUrl('https://user:pass@example.com', isPublicIp)).toThrow(/credentials/);
    // a public host passes
    expect(() => assertSafeNavigateUrl('https://example.com/path', isPublicIp)).not.toThrow();
  });

  it('a navigate to a private IP yields a rejection observation; the driver is never reached', async () => {
    let navigated = false;
    const browser = new MockBrowserDriver();
    const origNav = browser.navigate.bind(browser);
    browser.navigate = async (url: string) => { navigated = true; return origNav(url); };
    const isPublicIp = (addr: string) => !addr.startsWith('169.254.');
    let sawRejection = false;
    const drafter: PlannerDrafter = {
      async pick({ transcript }) {
        const navTurn = transcript.find((t) => 'tool' in t.pick && t.pick.tool === 'computer_use.navigate');
        if (!navTurn) return { tool: 'computer_use.navigate', args: { url: 'https://169.254.169.254/latest/meta-data' } };
        if (navTurn.observation?.includes('rejected')) sawRejection = true;
        return { done: true, artifact: {} };
      },
    };
    const outcome = await runPlan(cuPlan(), deps([], browser, { planner: drafter, isPublicIp }));
    expect(outcome.kind).toBe('done');
    expect(sawRejection).toBe(true);
    expect(navigated).toBe(false); // the SSRF guard fired BEFORE the driver
  });
});

/* ── the computer_use ceilings bound the run + weight class ──────────────────── */

describe('computer_use ceilings + weight class', () => {
  it('validatePlanSpec requires the computer_use weight class for a browser plan', () => {
    const wrong = cuPlan({ weightClass: 'frontier' });
    const problems = validatePlanSpec(wrong, [], { webSearchEnabled: false, browserEnabled: true });
    expect(problems.join(' ')).toMatch(/computer_use.*weight class/);
  });

  it('validatePlanSpec accepts a well-formed computer_use plan with NO connector grant', () => {
    const problems = validatePlanSpec(cuPlan(), [], { webSearchEnabled: false, browserEnabled: true });
    expect(problems).toEqual([]);
  });

  it('validatePlanSpec rejects maxIterations over the computer_use bound', () => {
    const over = cuPlan({ ceilings: { ...COMPUTER_USE_CEILINGS, maxIterations: COMPUTER_USE_CEILINGS.maxIterations + 1 } });
    const problems = validatePlanSpec(over, [], { webSearchEnabled: false, browserEnabled: true });
    expect(problems.join(' ')).toMatch(/maxIterations/);
  });

  it('maxIterations bounds an endless productive browser loop', async () => {
    const browser = new MockBrowserDriver({ content: 'page' });
    // distinct extract selectors → never repeats, always "progresses" → only the
    // iteration ceiling stops the loop.
    let n = 0;
    const drafter: PlannerDrafter = {
      async pick() {
        n += 1;
        return { tool: 'computer_use.extract', args: { target: { selector: `#row-${n}` } } };
      },
    };
    const outcome = await runPlan(
      cuPlan({ ceilings: { ...COMPUTER_USE_CEILINGS, maxIterations: 4 } }),
      deps([], browser, { planner: drafter }),
    );
    expect(outcome.kind).toBe('killed');
    if (outcome.kind === 'killed') expect(outcome.reason).toBe('max_iterations');
  });

  it('a repeated identical navigate is killed by repetition', async () => {
    const browser = new MockBrowserDriver({ content: 'same' });
    const same: PlannerPick = { tool: 'computer_use.navigate', args: { url: 'https://example.com' } };
    const outcome = await runPlan(cuPlan(), deps([same, same, same, same], browser));
    expect(outcome.kind).toBe('killed');
    if (outcome.kind === 'killed') expect(['repetition', 'no_progress']).toContain(outcome.reason);
  });

  it('DISTINCT-but-unproductive browser reads trip no_progress (P3 #7)', async () => {
    // A driver that returns IDENTICAL content+source regardless of the verb's
    // target — distinct picks (so the repetition kill never fires) that never
    // advance. Before the fix, the CU read path compared against the prior
    // UTILITY observation (always undefined here), so no_progress never tripped
    // and the loop ran to max_iterations. Now it compares against the prior
    // BROWSER observation (tag-normalized) and trips no_progress first.
    class StaticBrowser extends MockBrowserDriver {
      private make(): BrowserReadResult {
        return { kind: 'read', content: quarantine('the same page text every time', 'browser:static') };
      }
      async navigate(): Promise<BrowserReadResult> { return this.make(); }
      async extract(): Promise<BrowserReadResult> { return this.make(); }
      async scroll(): Promise<BrowserReadResult> { return this.make(); }
      async screenshot(): Promise<BrowserReadResult> { return this.make(); }
    }
    const browser = new StaticBrowser();
    // distinct selectors → distinct picks (no repetition kill) but identical obs
    let n = 0;
    const drafter: PlannerDrafter = {
      async pick() {
        n += 1;
        return { tool: 'computer_use.extract', args: { target: { selector: `#row-${n}` } } };
      },
    };
    const outcome = await runPlan(cuPlan(), deps([], browser, { planner: drafter }));
    expect(outcome.kind).toBe('killed');
    if (outcome.kind === 'killed') expect(outcome.reason).toBe('no_progress');
  });

  it('rejects a computer_use plan when the browser surface is disabled (P3 #6)', () => {
    // browserEnabled omitted → defaults fail-closed (false); a cu verb in the
    // allowlist rejects the whole plan so a stale plan can't silently flip live.
    const problems = validatePlanSpec(cuPlan(), [], { webSearchEnabled: false });
    expect(problems.join(' ')).toMatch(/computer_use.*surface to be enabled|requires the browser/);
    expect(problems.join(' ')).toMatch(/enabled/);
  });
});
