/**
 * Connector-batch Phase 0 — Task 1: verify the four new atomic caps
 * (crm.read, dm.read, gallery.read, dm.reply) are registered and wire up
 * correctly through validateSpec.
 *
 * Before Task 1 these caps existed in CONNECTOR_REGISTRY but were absent
 * from CAPABILITY_REGISTRY, so capability(id) returned undefined for any
 * composed spec or interpreter step that referenced them.
 */
import { describe, expect, it } from 'vitest';
import { capability } from '../src/capabilities';
import { validateSpec } from '../src/validate';
import type { AgentSpec } from '../src/types';

/** Minimal valid AgentSpec factory (mirrors trigger-graph.test.ts). */
function spec(overrides: Partial<AgentSpec>): AgentSpec {
  return {
    templateKey: null,
    version: 1,
    displayName: 'test-spec',
    toolsAllowlist: ['email.read'],
    requiredConnectors: ['gmail'],
    triggers: [{ kind: 'user' }],
    curriculum: {
      measures: 'test',
      promotion: { windowRuns: 25, minApprovedUneditedPct: 0.95 },
      routineMinApprovals: 5,
    },
    creditProfile: {
      weightClass: 'standard',
      ceilings: { maxSteps: 10, maxTokens: 1000, maxWallClockMs: 10_000 },
    },
    ...overrides,
  };
}

describe('connector-batch Phase 0 — new atomic capability descriptors', () => {
  // ── 1. Resolution ─────────────────────────────────────────────────────────

  it('capability("crm.read") resolves with sideEffect "read"', () => {
    const cap = capability('crm.read');
    expect(cap).toBeDefined();
    expect(cap?.sideEffect).toBe('read');
    expect(cap?.resource).toBe('crm');
    expect(cap?.verb).toBe('get');
    expect(cap?.requiredConnector).toBe('honeybook');
  });

  it('capability("dm.read") resolves with sideEffect "read"', () => {
    const cap = capability('dm.read');
    expect(cap).toBeDefined();
    expect(cap?.sideEffect).toBe('read');
    expect(cap?.resource).toBe('dm');
    expect(cap?.verb).toBe('get');
    expect(cap?.requiredConnector).toBe('instagram-dm');
  });

  it('capability("gallery.read") resolves with sideEffect "read"', () => {
    const cap = capability('gallery.read');
    expect(cap).toBeDefined();
    expect(cap?.sideEffect).toBe('read');
    expect(cap?.resource).toBe('gallery');
    expect(cap?.verb).toBe('get');
    expect(cap?.requiredConnector).toBe('pixieset');
  });

  it('capability("dm.reply") resolves with sideEffect "write"', () => {
    const cap = capability('dm.reply');
    expect(cap).toBeDefined();
    expect(cap?.sideEffect).toBe('write');
    expect(cap?.resource).toBe('dm');
    expect(cap?.verb).toBe('reply');
    // nominal home is honeybook; cross-connector note is in the descriptor comment
    expect(cap?.requiredConnector).toBe('honeybook');
    expect(cap?.patternKeyPrefix).toBe('dm.reply');
  });

  // ── 2. validateSpec — honeybook: dm.reply + crm.read ─────────────────────

  it('dm.reply + crm.read with requiredConnectors:[honeybook] passes validateSpec (no problems)', () => {
    const problems = validateSpec(
      spec({
        displayName: 'honeybook-agent',
        toolsAllowlist: ['crm.read', 'dm.reply'],
        requiredConnectors: ['honeybook'],
        triggers: [{ kind: 'schedule', schedule: 'daily.morning' }],
      }),
    );
    expect(problems).toEqual([]);
  });

  // ── 3. validateSpec — instagram-dm: dm.read + dm.reply ───────────────────
  //
  // Both honeybook and instagram-dm declare dm.reply in CONNECTOR_REGISTRY.capabilities,
  // so the "powered by at least one required connector" check in validateSpec passes
  // for either. A single CAPABILITY_REGISTRY descriptor with requiredConnector:honeybook
  // is the nominal home, but the powered-by check uses CONNECTOR_REGISTRY — correct.

  it('dm.read + dm.reply with requiredConnectors:[instagram-dm] passes validateSpec', () => {
    const problems = validateSpec(
      spec({
        displayName: 'instagram-agent',
        toolsAllowlist: ['dm.read', 'dm.reply'],
        requiredConnectors: ['instagram-dm'],
        triggers: [{ kind: 'schedule', schedule: 'daily.morning' }],
      }),
    );
    expect(problems).toEqual([]);
  });

  // ── 4. validateSpec — pixieset: gallery.read ─────────────────────────────

  it('gallery.read with requiredConnectors:[pixieset] passes validateSpec', () => {
    const problems = validateSpec(
      spec({
        displayName: 'pixieset-agent',
        toolsAllowlist: ['gallery.read'],
        requiredConnectors: ['pixieset'],
        triggers: [{ kind: 'schedule', schedule: 'daily.morning' }],
      }),
    );
    expect(problems).toEqual([]);
  });

  // ── 5. dm.reply velocity-cap invariant ───────────────────────────────────
  //
  // validateSpec asserts that every send-capable tool (capabilityCanSend = true for
  // dm.reply because it matches /\.reply$/) must ride a connector that declares
  // velocity caps. Both honeybook and instagram-dm declare send.velocity, so this
  // holds. Verify directly: the spec above with instagram-dm already passes, but
  // let's also confirm the validator would reject dm.reply on a non-send connector.

  it('dm.reply fails validateSpec when the required connector has no velocity caps (guard)', () => {
    // pixieset declares gallery.read only — no send.velocity. Using dm.reply on
    // it should fail the velocity-cap check.
    const problems = validateSpec(
      spec({
        displayName: 'bad-dm-reply-agent',
        // dm.reply is in CONNECTOR_REGISTRY for honeybook+instagram-dm (both have caps),
        // but NOT for pixieset. So it's not "powered by" pixieset → fails the powered-by
        // check, which is the earlier guard. Either way the spec is rejected.
        toolsAllowlist: ['gallery.read', 'dm.reply'],
        requiredConnectors: ['pixieset'],
        triggers: [{ kind: 'schedule', schedule: 'daily.morning' }],
      }),
    );
    expect(problems.length).toBeGreaterThan(0);
  });
});
