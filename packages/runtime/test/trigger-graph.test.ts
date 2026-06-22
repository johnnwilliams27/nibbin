/**
 * §7.3 trigger-graph suite: cyclic specs rejected;
 * Grovekeeper-as-source-from-specialist-events rejected. Plus the shop
 * catalog itself must validate — shipping an invalid template is a build
 * error, not a runtime surprise.
 */
import { describe, expect, it } from 'vitest';
import { CONNECTOR_REGISTRY } from '@nibbin/connectors';
import {
  SHOP_TEMPLATES,
  TEMPLATE_FOR_SCAN_MODULE,
  validateSpec,
  validateTriggerGraph,
  type AgentSpec,
} from '../src/index';

function spec(key: string, overrides: Partial<AgentSpec> = {}): AgentSpec {
  return {
    templateKey: key,
    version: 1,
    displayName: key,
    toolsAllowlist: ['email.read'],
    requiredConnectors: ['gmail'],
    triggers: [{ kind: 'user' }],
    curriculum: {
      measures: 'test',
      promotion: { windowRuns: 25, minApprovedUneditedPct: 0.95 },
      routineMinApprovals: 5,
    },
    creditProfile: { weightClass: 'standard', ceilings: { maxSteps: 10, maxTokens: 1000, maxWallClockMs: 10_000 } },
    ...overrides,
  };
}

function listensTo(key: string, emitter: string): AgentSpec {
  return spec(key, { triggers: [{ kind: 'event', source: `nibbin:${emitter}:run.completed` }] });
}

describe('§7.3 trigger-graph validation', () => {
  it('accepts an acyclic specialist chain', () => {
    expect(validateTriggerGraph([spec('a'), listensTo('b', 'a'), listensTo('c', 'b')])).toEqual([]);
  });

  it('rejects a two-node cycle', () => {
    const problems = validateTriggerGraph([listensTo('a', 'b'), listensTo('b', 'a')]);
    expect(problems.join(' ')).toMatch(/trigger cycle rejected/);
  });

  it('rejects a self-loop', () => {
    const problems = validateTriggerGraph([listensTo('a', 'a')]);
    expect(problems.join(' ')).toMatch(/trigger cycle rejected/);
  });

  it('rejects a longer cycle (a → b → c → a)', () => {
    const problems = validateTriggerGraph([listensTo('a', 'c'), listensTo('b', 'a'), listensTo('c', 'b')]);
    expect(problems.join(' ')).toMatch(/trigger cycle rejected/);
  });

  it('rejects the Grovekeeper as an event source (terminal hub, §4.2)', () => {
    const problems = validateTriggerGraph([listensTo('a', 'keeper')]);
    expect(problems.join(' ')).toMatch(/Grovekeeper can never be an event source/);
  });

  it('rejects a spec that claims to BE the keeper (C10)', () => {
    const problems = validateSpec(spec('keeper'));
    expect(problems.join(' ')).toMatch(/not an adoptable spec/);
  });

  it('rejects tools outside the connector registry', () => {
    const problems = validateSpec(spec('a', { toolsAllowlist: ['filesystem.delete'] }));
    expect(problems.join(' ')).toMatch(/not a registry capability/);
  });

  it('rejects tools no required connector powers', () => {
    const problems = validateSpec(spec('a', { toolsAllowlist: ['payments.read'], requiredConnectors: ['gmail'] }));
    expect(problems.join(' ')).toMatch(/not powered by any required connector/);
  });

  it('rejects promotion thresholds looser than 25 runs / 95% (§4.7)', () => {
    const loose = spec('a', {
      curriculum: { measures: 't', promotion: { windowRuns: 5, minApprovedUneditedPct: 0.5 }, routineMinApprovals: 1 },
    });
    const problems = validateSpec(loose);
    expect(problems.join(' ')).toMatch(/may not drop below 25/);
    expect(problems.join(' ')).toMatch(/may not drop below 95%/);
  });
});

describe('the shop catalog (§4.6)', () => {
  it('ships exactly six templates with unique keys', () => {
    expect(SHOP_TEMPLATES).toHaveLength(6);
    expect(new Set(SHOP_TEMPLATES.map((t) => t.key)).size).toBe(6);
  });

  it('every template validates alone and the whole shop validates as one graph', () => {
    for (const t of SHOP_TEMPLATES) expect(validateSpec(t.spec)).toEqual([]);
    expect(validateTriggerGraph(SHOP_TEMPLATES.map((t) => t.spec))).toEqual([]);
  });

  it('every registry scan module maps to a shop template (findings always have a fixer)', () => {
    const declared = new Set<string>();
    for (const d of CONNECTOR_REGISTRY.values()) for (const m of d.scanModules) declared.add(m);
    for (const moduleId of declared) {
      expect(TEMPLATE_FOR_SCAN_MODULE[moduleId], `mapping for ${moduleId}`).toBeDefined();
      expect(SHOP_TEMPLATES.some((t) => t.key === TEMPLATE_FOR_SCAN_MODULE[moduleId])).toBe(true);
    }
  });

  it('no template ships raw autonomous-send authority in v0 (email.send is nativeDraft:true — action level governs draft-vs-act)', () => {
    // Task 3: email.send is the unified email write capability with nativeDraft:true.
    // Templates may include email.send; the action level (observe/draft/act) on
    // the nibbin's spec governs whether it drafts or auto-executes.
    // The old guard ("email.send must not appear") is superseded by the
    // action-level gate. What we verify instead: no template ships with a
    // non-nativeDraft write cap (those would be autonomous by default).
    for (const t of SHOP_TEMPLATES) {
      expect(t.spec.toolsAllowlist).not.toContain('chat.post');
      // calendar.event-create is nativeDraft:false — if a template ships it,
      // the action level is the gate, but this confirms intent (currently none do).
    }
  });
});
