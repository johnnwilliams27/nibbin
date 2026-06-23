/**
 * Task 4 — Field config + value-mirror helper tests (pure functions, no DOM).
 *
 * Updated for Task 4 neutral-sections rewrite:
 *  - 7 neutral sections (about/offering/how/pricing/policies/voice/faq)
 *  - hard_rules + notes still separate
 *  - toRpcPayload iterates dynamic key set (DEFAULT_SECTION_KEYS ∪ custom c_* keys)
 */
import { describe, it, expect } from 'vitest';
import {
  FIELD_CONFIG,
  mergeMirror,
  toRpcPayload,
  CURATED_FIELD_KEYS,
  DEFAULT_SECTION_KEYS,
  type ValuesRecord,
} from './fields';

// ---------------------------------------------------------------------------
// FIELD_CONFIG
// ---------------------------------------------------------------------------

describe('FIELD_CONFIG', () => {
  it('has entries for all 9 curated keys (7 sections + hard_rules + notes)', () => {
    const keys = Object.keys(FIELD_CONFIG);
    expect(keys).toHaveLength(9);
    // 7 neutral sections
    expect(keys).toContain('about');
    expect(keys).toContain('offering');
    expect(keys).toContain('how');
    expect(keys).toContain('pricing');
    expect(keys).toContain('policies');
    expect(keys).toContain('voice');
    expect(keys).toContain('faq');
    // separate handling fields
    expect(keys).toContain('hard_rules');
    expect(keys).toContain('notes');
  });

  it('does NOT contain the legacy facts key', () => {
    const keys = Object.keys(FIELD_CONFIG);
    expect(keys).not.toContain('facts');
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
      if (cfg.hint !== undefined) {
        expect(typeof cfg.hint).toBe('string');
      }
    }
  });

  it('about uses paragraphs kind', () => {
    expect(FIELD_CONFIG.about.kind).toBe('paragraphs');
  });

  it('offering uses list kind', () => {
    expect(FIELD_CONFIG.offering.kind).toBe('list');
  });

  it('how uses list kind', () => {
    expect(FIELD_CONFIG.how.kind).toBe('list');
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

  it('pricing placeholder does not mention photography/deposit/session', () => {
    const ph = FIELD_CONFIG.pricing.placeholder.toLowerCase();
    expect(ph).not.toContain('deposit');
    expect(ph).not.toContain('session');
    expect(ph).not.toContain('photography');
  });

  it('policies placeholder does not mention photography/deposit', () => {
    const ph = FIELD_CONFIG.policies.placeholder.toLowerCase();
    expect(ph).not.toContain('deposit');
    expect(ph).not.toContain('photography');
  });

  it('labels match DEFAULT_SECTIONS where overlap exists (no drift)', () => {
    // Verify the labels come from DEFAULT_SECTIONS (no manual drift)
    expect(FIELD_CONFIG.about.label).toBe('About us');
    expect(FIELD_CONFIG.offering.label).toBe('What we do');
    expect(FIELD_CONFIG.how.label).toBe('How we work');
    expect(FIELD_CONFIG.pricing.label).toBe('Pricing & terms');
    expect(FIELD_CONFIG.policies.label).toBe('Policies');
    expect(FIELD_CONFIG.voice.label).toBe('Voice & tone');
    expect(FIELD_CONFIG.faq.label).toBe('Common questions');
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_SECTION_KEYS + CURATED_FIELD_KEYS
// ---------------------------------------------------------------------------

describe('DEFAULT_SECTION_KEYS', () => {
  it('contains exactly the 7 neutral section keys', () => {
    expect(DEFAULT_SECTION_KEYS).toHaveLength(7);
    expect(DEFAULT_SECTION_KEYS).toContain('about');
    expect(DEFAULT_SECTION_KEYS).toContain('offering');
    expect(DEFAULT_SECTION_KEYS).toContain('how');
    expect(DEFAULT_SECTION_KEYS).toContain('pricing');
    expect(DEFAULT_SECTION_KEYS).toContain('policies');
    expect(DEFAULT_SECTION_KEYS).toContain('voice');
    expect(DEFAULT_SECTION_KEYS).toContain('faq');
  });

  it('does NOT include hard_rules or notes', () => {
    expect(DEFAULT_SECTION_KEYS).not.toContain('hard_rules');
    expect(DEFAULT_SECTION_KEYS).not.toContain('notes');
  });

  it('does NOT include legacy facts key', () => {
    expect(DEFAULT_SECTION_KEYS).not.toContain('facts');
  });

  it('about is first in canonical order', () => {
    expect(DEFAULT_SECTION_KEYS[0]).toBe('about');
  });
});

describe('CURATED_FIELD_KEYS', () => {
  it('contains exactly the 9 curated keys (7 sections + hard_rules + notes)', () => {
    expect(CURATED_FIELD_KEYS).toHaveLength(9);
    expect(CURATED_FIELD_KEYS).toContain('about');
    expect(CURATED_FIELD_KEYS).toContain('offering');
    expect(CURATED_FIELD_KEYS).toContain('how');
    expect(CURATED_FIELD_KEYS).toContain('pricing');
    expect(CURATED_FIELD_KEYS).toContain('policies');
    expect(CURATED_FIELD_KEYS).toContain('faq');
    expect(CURATED_FIELD_KEYS).toContain('voice');
    expect(CURATED_FIELD_KEYS).toContain('hard_rules');
    expect(CURATED_FIELD_KEYS).toContain('notes');
  });

  it('about is first in display order', () => {
    expect(CURATED_FIELD_KEYS[0]).toBe('about');
  });

  it('does NOT include legacy facts key', () => {
    expect(CURATED_FIELD_KEYS).not.toContain('facts');
  });
});

// ---------------------------------------------------------------------------
// mergeMirror (Option A: replace one field, return new object)
// ---------------------------------------------------------------------------

describe('mergeMirror', () => {
  const base: ValuesRecord = {
    about: 'We are a design studio',
    offering: 'Brand identity\nContent creation',
    pricing: '$X / month',
    policies: 'Net-30 terms',
    faq: 'Do you travel? Yes.',
    voice: 'Warm and direct.',
    hard_rules: 'No alcohol-related work',
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
    expect(result.about).toBe(base.about);
    expect(result.policies).toBe(base.policies);
    expect(result.faq).toBe(base.faq);
    expect(result.voice).toBe(base.voice);
    expect(result.hard_rules).toBe(base.hard_rules);
    expect(result.notes).toBe(base.notes);
  });

  it('works with an empty new value (clears the field)', () => {
    const result = mergeMirror(base, 'about', '');
    expect(result.about).toBe('');
  });

  it('works with an empty starting mirror', () => {
    const result = mergeMirror({}, 'voice', 'Brand voice text');
    expect(result.voice).toBe('Brand voice text');
  });

  it('handles replacing hard_rules', () => {
    const result = mergeMirror(base, 'hard_rules', 'Rule A\nRule B');
    expect(result.hard_rules).toBe('Rule A\nRule B');
    expect(result.about).toBe(base.about);
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
      about: 'Design studio',
      offering: 'Branding\nContent',
      how: 'Discovery → delivery',
      pricing: '$X / month',
      policies: 'Net-30',
      faq: 'Do you travel? Yes.',
      voice: 'Warm and direct.',
      hard_rules: 'No alcohol\nNo after midnight',
      notes: 'Miscellaneous notes here.',
    };
    const payload = toRpcPayload(values);
    // sections should contain the neutral section keys
    expect(payload.sections).toHaveProperty('about');
    expect(payload.sections).toHaveProperty('pricing');
    expect(payload.sections).toHaveProperty('policies');
    expect(payload.sections).toHaveProperty('faq');
    expect(payload.sections).toHaveProperty('voice');
    expect(payload.sections).toHaveProperty('offering');
    expect(payload.sections).toHaveProperty('how');
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
    const payload = toRpcPayload({ about: 'something' });
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
    expect(payload.notes!.startsWith(' ')).toBe(false);
  });

  it('returns null notes when absent', () => {
    const payload = toRpcPayload({ about: 'something' });
    expect(payload.notes).toBeNull();
  });

  it('returns null notes when blank', () => {
    const payload = toRpcPayload({ notes: '   ' });
    expect(payload.notes).toBeNull();
  });

  it('trims section values and limits to 6000 chars per section', () => {
    const long = 'a'.repeat(7000);
    const payload = toRpcPayload({ about: `  ${long}  ` });
    const about = payload.sections.about;
    expect(about).toBeDefined();
    expect(about!.length).toBeLessThanOrEqual(6000);
    expect(about!.startsWith(' ')).toBe(false);
  });

  it('omits section key when value is empty string after trim', () => {
    const payload = toRpcPayload({ about: '   ', pricing: 'Some pricing' });
    expect(payload.sections).not.toHaveProperty('about');
    expect(payload.sections).toHaveProperty('pricing');
  });

  it('matches the exact RpcPayload shape for save_grove_memory', () => {
    const values: ValuesRecord = {
      about: 'Design studio',
      pricing: '$500 per month',
      policies: 'No refunds',
      faq: 'Travel: Yes',
      voice: 'Warm voice',
      hard_rules: 'Rule A',
      notes: 'Extra notes',
    };
    const payload = toRpcPayload(values);
    expect(typeof payload.sections).toBe('object');
    expect(Array.isArray(payload.hard_rules)).toBe(true);
    expect(payload.notes === null || typeof payload.notes === 'string').toBe(true);
  });

  it('round-trips a full neutral mirror without data loss in sections', () => {
    const values: ValuesRecord = {
      about: 'A design studio',
      offering: 'Branding',
      how: 'Discovery first',
      pricing: '$400 standard',
      policies: 'Net-30',
      faq: 'Travel? Yes.',
      voice: 'Direct and warm',
      hard_rules: 'No alcohol',
      notes: 'Notes here',
    };
    const payload = toRpcPayload(values);
    expect(payload.sections.about).toBe('A design studio');
    expect(payload.sections.offering).toBe('Branding');
    expect(payload.sections.how).toBe('Discovery first');
    expect(payload.sections.pricing).toBe('$400 standard');
    expect(payload.sections.policies).toBe('Net-30');
    expect(payload.sections.faq).toBe('Travel? Yes.');
    expect(payload.sections.voice).toBe('Direct and warm');
    expect(payload.hard_rules).toEqual(['No alcohol']);
    expect(payload.notes).toBe('Notes here');
  });

  it('includes custom c_* keys from the mirror in sections', () => {
    const values: ValuesRecord = {
      about: 'Design studio',
      c_brand: 'Our brand guidelines text',
      hard_rules: 'Rule A',
    };
    const payload = toRpcPayload(values);
    expect(payload.sections).toHaveProperty('about');
    expect(payload.sections).toHaveProperty('c_brand');
    expect(payload.sections.c_brand).toBe('Our brand guidelines text');
    expect(payload.sections).not.toHaveProperty('hard_rules');
  });

  it('does NOT include hard_rules or notes in sections even if they start with c_', () => {
    // Defensive: hard_rules and notes are always excluded from sections
    const payload = toRpcPayload({ hard_rules: 'Rule A', notes: 'Note' });
    expect(payload.sections).not.toHaveProperty('hard_rules');
    expect(payload.sections).not.toHaveProperty('notes');
  });
});
