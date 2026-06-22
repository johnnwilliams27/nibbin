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
    // surfaces: email.read / email.send / calendar.read / payments.read.
    // email.send is the single email write capability (Task 3: email.draft
    // retired — the action level decides draft-vs-act). NOTE: the tally invoice
    // nudge now sends via email.send (2026-06-22 personalized-email decision),
    // so no program yields invoice.nudge anymore — it stays vestigial in the
    // registry (router eval fixtures), but is no longer in this used-by set.
    // If a program adds a capability, this list and the registry must grow together.
    const usedByPrograms = [
      'email.read',
      'email.send',
      'calendar.read',
      'payments.read',
    ];
    const missing = usedByPrograms.filter((id) => !capability(id));
    expect(missing).toEqual([]);
  });

  // Task 3 — single email write capability
  it('email.draft is NOT in the registry (retired; email.send is the sole email write)', () => {
    expect(capability('email.draft')).toBeUndefined();
  });

  it('email.send has nativeDraft: true (action level decides draft-vs-act)', () => {
    const c = capability('email.send');
    expect(c).toBeDefined();
    expect(c?.nativeDraft).toBe(true);
    expect(c?.sideEffect).toBe('write');
  });

  it('calendar.event-create has nativeDraft: false', () => {
    const c = capability('calendar.event-create');
    expect(c).toBeDefined();
    expect(c?.nativeDraft).toBe(false);
  });

  it('each descriptor is internally consistent (id matches key, sideEffect valid)', () => {
    const valid = new Set(['read', 'write']); // 'draft' retired in Task 3
    for (const [id, d] of Object.entries(CAPABILITY_REGISTRY)) {
      expect(d.id).toBe(id);
      expect(valid.has(d.sideEffect)).toBe(true);
      expect(d.resource.length).toBeGreaterThan(0);
      expect(d.verb.length).toBeGreaterThan(0);
      expect(d.requiredConnector.length).toBeGreaterThan(0);
      // write capabilities carry a routine-matching prefix (§4.7). Atomic
      // reads do not (they yield no patternKey). The one exception is a
      // PRESENTATION primitive (Slice 2c digest/summarize shape): its sideEffect
      // is 'read' (no real side effect — the runner gates it as a draft always),
      // yet it yields a presentation DRAFT carrying a routine-matching patternKey,
      // so it legitimately declares a patternKeyPrefix.
      const isPresentationPrimitive = d.sideEffect === 'read' && d.kind === 'primitive';
      if (d.sideEffect === 'read' && !isPresentationPrimitive) {
        expect(d.patternKeyPrefix).toBeUndefined();
      } else {
        expect(d.patternKeyPrefix).toBeTruthy();
      }
    }
  });

  it('connector mappings match what the programs requireConn', () => {
    expect(capability('email.read')?.requiredConnector).toBe('gmail');
    expect(capability('email.send')?.requiredConnector).toBe('gmail');
    expect(capability('calendar.read')?.requiredConnector).toBe('google-calendar');
    expect(capability('payments.read')?.requiredConnector).toBe('stripe');
    expect(capability('invoice.nudge')?.requiredConnector).toBe('stripe');
  });
});
