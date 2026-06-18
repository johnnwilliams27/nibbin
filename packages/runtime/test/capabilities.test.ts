/**
 * Capability conformance (design §3.2): the registry binds the existing
 * imperative programs + the shop templates to a typed abstraction WITHOUT
 * rewriting them. Every capability the templates' `toolsAllowlist` declares —
 * and every capability the six hand-written programs yield — must be a
 * registry id (no orphans). This is the wall that keeps the registry complete
 * as Composer (Slice 2) starts composing over it.
 */
import { describe, expect, it } from 'vitest';
import { CAPABILITY_REGISTRY, SHOP_TEMPLATES, capability } from '../src/index';

describe('capability registry — conformance', () => {
  it('every template toolsAllowlist entry is a registry id (no orphans)', () => {
    const orphans: string[] = [];
    for (const t of SHOP_TEMPLATES) {
      for (const cap of t.spec.toolsAllowlist) {
        if (!capability(cap)) orphans.push(`${t.key}:${cap}`);
      }
    }
    expect(orphans).toEqual([]);
  });

  it('covers every capability the six hand-written programs yield', () => {
    // The programs live in apps/web (can't import here without a cross-package
    // edge), so this is the canonical hard-coded set the web-side program grep
    // surfaces: email.read / email.draft / calendar.read / payments.read /
    // invoice.nudge. Plus email.send — the grant capability the runner gates at
    // Senior (engine.maybeInsertSendGrant). If a program adds a capability,
    // this list and the registry must grow together.
    const usedByPrograms = [
      'email.read',
      'email.draft',
      'calendar.read',
      'payments.read',
      'invoice.nudge',
      'email.send',
    ];
    const missing = usedByPrograms.filter((id) => !capability(id));
    expect(missing).toEqual([]);
  });

  it('each descriptor is internally consistent (id matches key, sideEffect valid)', () => {
    const valid = new Set(['read', 'draft', 'write']);
    for (const [id, d] of Object.entries(CAPABILITY_REGISTRY)) {
      expect(d.id).toBe(id);
      expect(valid.has(d.sideEffect)).toBe(true);
      expect(d.resource.length).toBeGreaterThan(0);
      expect(d.verb.length).toBeGreaterThan(0);
      expect(d.requiredConnector.length).toBeGreaterThan(0);
      // draft/write capabilities carry a routine-matching prefix (§4.7);
      // reads do not (they have no patternKey).
      if (d.sideEffect === 'read') expect(d.patternKeyPrefix).toBeUndefined();
      else expect(d.patternKeyPrefix).toBeTruthy();
    }
  });

  it('connector mappings match what the programs requireConn', () => {
    expect(capability('email.read')?.requiredConnector).toBe('gmail');
    expect(capability('email.draft')?.requiredConnector).toBe('gmail');
    expect(capability('email.send')?.requiredConnector).toBe('gmail');
    expect(capability('calendar.read')?.requiredConnector).toBe('google-calendar');
    expect(capability('payments.read')?.requiredConnector).toBe('stripe');
    expect(capability('invoice.nudge')?.requiredConnector).toBe('stripe');
  });
});
