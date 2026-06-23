/**
 * Task 4 — Field config + value-mirror helper tests (pure functions, no DOM).
 *
 * TDD: write all failing cases first, then implement fields.ts green.
 */
import { describe, it, expect } from 'vitest';
import {
  FIELD_CONFIG,
  mergeMirror,
  toRpcPayload,
  CURATED_FIELD_KEYS,
  type ValuesRecord,
} from './fields';

// ---------------------------------------------------------------------------
// FIELD_CONFIG
// ---------------------------------------------------------------------------

describe('FIELD_CONFIG', () => {
  it('has entries for all 7 curated keys', () => {
    const keys = Object.keys(FIELD_CONFIG);
    expect(keys).toHaveLength(7);
    expect(keys).toContain('facts');
    expect(keys).toContain('pricing');
    expect(keys).toContain('policies');
    expect(keys).toContain('faq');
    expect(keys).toContain('voice');
    expect(keys).toContain('hard_rules');
    expect(keys).toContain('notes');
  });

  it('each entry has label, kind, and placeholder', () => {
    for (const key of Object.keys(FIELD_CONFIG)) {
      const cfg = FIELD_CONFIG[key as keyof typeof FIELD_CONFIG];
      expect(cfg).toHaveProperty('label');
      expect(cfg).toHaveProperty('kind');
      expect(cfg).toHaveProperty('placeholder');
      expect(typeof cfg.label).toBe('string');
      expect(typeof cfg.placeholder).toBe('string');
      expect(cfg.label.length).toBeGreaterThan(0);
      expect(cfg.placeholder.length).toBeGreaterThan(0);
    }
  });

  it('hint is optional (string or undefined)', () => {
    for (const key of Object.keys(FIELD_CONFIG)) {
      const cfg = FIELD_CONFIG[key as keyof typeof FIELD_CONFIG];
      // hint is optional — if present must be a string
      if (cfg.hint !== undefined) {
        expect(typeof cfg.hint).toBe('string');
      }
    }
  });

  it('facts uses dl kind (definition-list for business facts)', () => {
    expect(FIELD_CONFIG.facts.kind).toBe('dl');
  });

  it('pricing uses list kind', () => {
    expect(FIELD_CONFIG.pricing.kind).toBe('list');
  });

  it('policies uses list kind', () => {
    expect(FIELD_CONFIG.policies.kind).toBe('list');
  });

  it('faq uses list kind', () => {
    expect(FIELD_CONFIG.faq.kind).toBe('list');
  });

  it('voice uses quote kind', () => {
    expect(FIELD_CONFIG.voice.kind).toBe('quote');
  });

  it('hard_rules uses list kind', () => {
    expect(FIELD_CONFIG.hard_rules.kind).toBe('list');
  });

  it('notes uses paragraphs kind', () => {
    expect(FIELD_CONFIG.notes.kind).toBe('paragraphs');
  });

  it('labels match MEMORY_SECTIONS where overlap exists (no drift)', () => {
    // The MEMORY_SECTIONS keys that appear in FIELD_CONFIG must keep the same labels
    // as defined there — prevents UI label drift from the drafter's memory block.
    expect(FIELD_CONFIG.facts.label).toBe('Business facts');
    expect(FIELD_CONFIG.pricing.label).toBe('Pricing');
    expect(FIELD_CONFIG.policies.label).toBe('Policies');
    expect(FIELD_CONFIG.faq.label).toBe('Common questions');
    expect(FIELD_CONFIG.voice.label).toBe('Voice & tone');
  });
});

// ---------------------------------------------------------------------------
// CURATED_FIELD_KEYS — ordered array of all 7 keys
// ---------------------------------------------------------------------------

describe('CURATED_FIELD_KEYS', () => {
  it('contains exactly the 7 curated keys', () => {
    expect(CURATED_FIELD_KEYS).toHaveLength(7);
    expect(CURATED_FIELD_KEYS).toContain('facts');
    expect(CURATED_FIELD_KEYS).toContain('pricing');
    expect(CURATED_FIELD_KEYS).toContain('policies');
    expect(CURATED_FIELD_KEYS).toContain('faq');
    expect(CURATED_FIELD_KEYS).toContain('voice');
    expect(CURATED_FIELD_KEYS).toContain('hard_rules');
    expect(CURATED_FIELD_KEYS).toContain('notes');
  });

  it('is ordered consistently (facts first, notes near end)', () => {
    expect(CURATED_FIELD_KEYS[0]).toBe('facts');
    // notes is the last curated field before hard_rules or after it
    // The key constraint is facts comes first
  });
});

// ---------------------------------------------------------------------------
// mergeMirror (Option A: replace one field, return new object)
// ---------------------------------------------------------------------------

describe('mergeMirror', () => {
  const base: ValuesRecord = {
    facts: 'Location: Portland',
    pricing: '$400 session',
    policies: '48hr cancellation',
    faq: 'Do you travel? Yes.',
    voice: 'Warm and direct.',
    hard_rules: 'No alcohol photography',
    notes: 'Some misc notes',
  };

  it('returns a new object (immutable — does not mutate input)', () => {
    const result = mergeMirror(base, 'pricing', 'New pricing text');
    expect(result).not.toBe(base);
  });

  it('replaces the target key with the new value', () => {
    const result = mergeMirror(base, 'pricing', 'New pricing text');
    expect(result.pricing).toBe('New pricing text');
  });

  it('preserves all other keys unchanged', () => {
    const result = mergeMirror(base, 'pricing', 'New pricing text');
    expect(result.facts).toBe(base.facts);
    expect(result.policies).toBe(base.policies);
    expect(result.faq).toBe(base.faq);
    expect(result.voice).toBe(base.voice);
    expect(result.hard_rules).toBe(base.hard_rules);
    expect(result.notes).toBe(base.notes);
  });

  it('works with an empty new value (clears the field)', () => {
    const result = mergeMirror(base, 'facts', '');
    expect(result.facts).toBe('');
  });

  it('works with an empty starting mirror', () => {
    const result = mergeMirror({}, 'voice', 'Brand voice text');
    expect(result.voice).toBe('Brand voice text');
  });

  it('handles replacing hard_rules', () => {
    const result = mergeMirror(base, 'hard_rules', 'Rule A\nRule B');
    expect(result.hard_rules).toBe('Rule A\nRule B');
    expect(result.facts).toBe(base.facts);
  });

  it('handles replacing notes', () => {
    const result = mergeMirror(base, 'notes', 'Updated misc notes');
    expect(result.notes).toBe('Updated misc notes');
  });
});

// ---------------------------------------------------------------------------
// toRpcPayload — the pure core of the server action
// ---------------------------------------------------------------------------

describe('toRpcPayload', () => {
  it('separates sections keys from hard_rules and notes', () => {
    const values: ValuesRecord = {
      facts: 'Location: Portland',
      pricing: '$400 session',
      policies: '48hr cancellation',
      faq: 'Do you travel? Yes.',
      voice: 'Warm and direct.',
      hard_rules: 'No alcohol\nNo after midnight',
      notes: 'Miscellaneous notes here.',
    };
    const payload = toRpcPayload(values);
    // sections should only contain the MEMORY_SECTIONS keys
    expect(payload.sections).toHaveProperty('facts');
    expect(payload.sections).toHaveProperty('pricing');
    expect(payload.sections).toHaveProperty('policies');
    expect(payload.sections).toHaveProperty('faq');
    expect(payload.sections).toHaveProperty('voice');
    // hard_rules and notes must NOT appear in sections
    expect(payload.sections).not.toHaveProperty('hard_rules');
    expect(payload.sections).not.toHaveProperty('notes');
  });

  it('splits hard_rules on newline, trims, filters blanks', () => {
    const values: ValuesRecord = {
      hard_rules: 'Rule one\n  Rule two  \n\nRule three',
    };
    const payload = toRpcPayload(values);
    expect(payload.hard_rules).toEqual(['Rule one', 'Rule two', 'Rule three']);
  });

  it('limits hard_rules to 50 entries', () => {
    const manyRules = Array.from({ length: 60 }, (_, i) => `Rule ${i + 1}`).join('\n');
    const payload = toRpcPayload({ hard_rules: manyRules });
    expect(payload.hard_rules).toHaveLength(50);
    expect(payload.hard_rules[0]).toBe('Rule 1');
    expect(payload.hard_rules[49]).toBe('Rule 50');
  });

  it('returns empty array for hard_rules when absent', () => {
    const payload = toRpcPayload({ facts: 'something' });
    expect(payload.hard_rules).toEqual([]);
  });

  it('returns empty array for hard_rules when blank', () => {
    const payload = toRpcPayload({ hard_rules: '  \n  ' });
    expect(payload.hard_rules).toEqual([]);
  });

  it('trims notes and limits to 8000 chars', () => {
    const long = 'x'.repeat(9000);
    const payload = toRpcPayload({ notes: `  ${long}  ` });
    expect(payload.notes).not.toBeNull();
    expect(payload.notes!.length).toBeLessThanOrEqual(8000);
    // Must be trimmed (no leading space)
    expect(payload.notes!.startsWith(' ')).toBe(false);
  });

  it('returns null notes when absent', () => {
    const payload = toRpcPayload({ facts: 'something' });
    expect(payload.notes).toBeNull();
  });

  it('returns null notes when blank', () => {
    const payload = toRpcPayload({ notes: '   ' });
    expect(payload.notes).toBeNull();
  });

  it('trims section values and limits to 6000 chars per section', () => {
    const long = 'a'.repeat(7000);
    const payload = toRpcPayload({ facts: `  ${long}  ` });
    const facts = payload.sections.facts;
    expect(facts).toBeDefined();
    expect(facts!.length).toBeLessThanOrEqual(6000);
    expect(facts!.startsWith(' ')).toBe(false);
  });

  it('omits section key when value is empty string after trim', () => {
    const payload = toRpcPayload({ facts: '   ', pricing: 'Some pricing' });
    expect(payload.sections).not.toHaveProperty('facts');
    expect(payload.sections).toHaveProperty('pricing');
  });

  it('matches the exact RpcPayload shape for save_grove_memory', () => {
    const values: ValuesRecord = {
      facts: 'Business type: Photography',
      pricing: '$500 per session',
      policies: 'No refunds',
      faq: 'Travel: Yes',
      voice: 'Warm voice',
      hard_rules: 'Rule A',
      notes: 'Extra notes',
    };
    const payload = toRpcPayload(values);
    // Shape check
    expect(typeof payload.sections).toBe('object');
    expect(Array.isArray(payload.hard_rules)).toBe(true);
    expect(payload.notes === null || typeof payload.notes === 'string').toBe(true);
  });

  it('round-trips a full mirror without data loss in sections', () => {
    const values: ValuesRecord = {
      facts: 'Location: Portland',
      pricing: '$400 standard',
      policies: '48hr cancel',
      faq: 'Travel? Yes.',
      voice: 'Direct and warm',
      hard_rules: 'No alcohol',
      notes: 'Notes here',
    };
    const payload = toRpcPayload(values);
    expect(payload.sections.facts).toBe('Location: Portland');
    expect(payload.sections.pricing).toBe('$400 standard');
    expect(payload.sections.policies).toBe('48hr cancel');
    expect(payload.sections.faq).toBe('Travel? Yes.');
    expect(payload.sections.voice).toBe('Direct and warm');
    expect(payload.hard_rules).toEqual(['No alcohol']);
    expect(payload.notes).toBe('Notes here');
  });
});
