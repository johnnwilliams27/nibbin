/**
 * Guards the load-time `email.draft` -> `email.send` shim in `specFromRow`
 * (the belt-and-suspenders half of gate fix P0-1). Already-adopted email
 * Nibbins carry the retired `email.draft` capability in their immutable
 * `agent_specs.tools_allowlist` (and possibly `steps[].capability`). Without
 * this normalization at spec load, the runner's allowlist gate
 * (`!toolsAllowlist.includes('email.send')`) kills every such run. These tests
 * drive a STORED `email.draft` row through `specFromRow` so a future refactor
 * that drops the shim fails here instead of silently bricking production
 * email Nibbins.
 */
import { describe, expect, it } from 'vitest';
import { specFromRow } from './engine';

type SpecRow = Parameters<typeof specFromRow>[0];
type SpecStep = NonNullable<SpecRow['steps']>[number];

function makeSpecRow(overrides: Partial<SpecRow> = {}): SpecRow {
  return {
    id: 'spec-1',
    template_key: 'echo',
    version: 1,
    display_name: 'Echo',
    tools_allowlist: ['email.read'],
    required_connectors: ['gmail'],
    triggers: [],
    curriculum: {},
    credit_profile: {},
    steps: [],
    persona_policy: {},
    ...overrides,
  } as SpecRow;
}

describe('specFromRow — retired email.draft normalization (shim for gate P0-1)', () => {
  it('rewrites a stored email.draft allowlist to email.send at spec load', () => {
    const spec = specFromRow(makeSpecRow({ tools_allowlist: ['email.read', 'email.draft'] }));
    expect(spec.toolsAllowlist).toContain('email.send');
    expect(spec.toolsAllowlist).not.toContain('email.draft');
  });

  it('dedups when both email.draft and email.send are stored', () => {
    const spec = specFromRow(
      makeSpecRow({ tools_allowlist: ['email.draft', 'email.send', 'email.read'] }),
    );
    expect(spec.toolsAllowlist.filter((cap) => cap === 'email.send')).toHaveLength(1);
    expect(spec.toolsAllowlist).not.toContain('email.draft');
  });

  it('rewrites email.draft in steps[].capability', () => {
    const draftStep = { capability: 'email.draft' } as unknown as SpecStep;
    const spec = specFromRow(
      makeSpecRow({ tools_allowlist: ['email.draft'], steps: [draftStep] }),
    );
    expect(spec.steps?.some((s) => s.capability === 'email.draft')).toBe(false);
    expect(spec.steps?.some((s) => s.capability === 'email.send')).toBe(true);
  });

  it('leaves an allowlist without email.draft untouched', () => {
    const spec = specFromRow(makeSpecRow({ tools_allowlist: ['email.read', 'email.send'] }));
    expect(spec.toolsAllowlist).toEqual(['email.read', 'email.send']);
  });
});
