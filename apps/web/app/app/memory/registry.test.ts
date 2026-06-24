/**
 * Task 4 — Dynamic field registry tests (pure, no DOM, no DB).
 *
 * TDD: written BEFORE registry.ts exists — all cases fail until the module is
 * implemented.
 *
 * Covers:
 *  - buildSectionRegistry: defaults, rename, reorder, hide, custom rows
 *  - hard_rules/notes never emitted as sections
 *  - forwardMapLegacy: facts→about migration
 */
import { describe, it, expect } from 'vitest';
import { buildSectionRegistry, forwardMapLegacy, type FieldMetaRow } from './registry';
import { DEFAULT_SECTIONS } from '../../../lib/grove/memory-sections';

// ---------------------------------------------------------------------------
// DEFAULT_SECTIONS sanity
// ---------------------------------------------------------------------------

describe('DEFAULT_SECTIONS', () => {
  it('contains exactly the 7 neutral section keys', () => {
    const keys = DEFAULT_SECTIONS.map((s) => s.key);
    expect(keys).toEqual(expect.arrayContaining(['about', 'offering', 'how', 'pricing', 'policies', 'voice', 'faq']));
    expect(keys).toHaveLength(7);
  });

  it('does NOT contain hard_rules or notes', () => {
    const keys = DEFAULT_SECTIONS.map((s) => s.key);
    expect(keys).not.toContain('hard_rules');
    expect(keys).not.toContain('notes');
  });

  it('does NOT contain photographer-specific keys (facts)', () => {
    const keys = DEFAULT_SECTIONS.map((s) => s.key);
    expect(keys).not.toContain('facts');
  });

  it('does NOT contain photography-specific copy in placeholders', () => {
    for (const s of DEFAULT_SECTIONS) {
      const combined = `${s.label} ${s.placeholder ?? ''}`.toLowerCase();
      expect(combined).not.toContain('deposit');
      expect(combined).not.toContain('session');
      expect(combined).not.toContain('photography');
      expect(combined).not.toContain('shoot');
    }
  });

  it('has label, key, kind, and placeholder on every entry', () => {
    for (const s of DEFAULT_SECTIONS) {
      expect(typeof s.key).toBe('string');
      expect(s.key.length).toBeGreaterThan(0);
      expect(typeof s.label).toBe('string');
      expect(s.label.length).toBeGreaterThan(0);
      expect(typeof s.kind).toBe('string');
      expect(typeof s.placeholder).toBe('string');
      expect(s.placeholder.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// buildSectionRegistry
// ---------------------------------------------------------------------------

describe('buildSectionRegistry', () => {
  it('returns defaults in canonical order when no meta rows', () => {
    const result = buildSectionRegistry([]);
    const keys = result.map((s) => s.key);
    expect(keys).toEqual(['about', 'offering', 'how', 'pricing', 'policies', 'voice', 'faq']);
  });

  it('renames and moves a default section via meta row', () => {
    const meta: FieldMetaRow[] = [
      { field_key: 'voice', label: 'House voice', sort_order: 1, is_custom: false, is_hidden: false },
    ];
    const result = buildSectionRegistry(meta);
    const voiceEntry = result.find((s) => s.key === 'voice');
    expect(voiceEntry).toBeDefined();
    expect(voiceEntry!.label).toBe('House voice');
    // sort_order:1 means it should be first
    expect(result[0].key).toBe('voice');
  });

  it('hides a default section when is_hidden:true', () => {
    const meta: FieldMetaRow[] = [
      { field_key: 'policies', label: null, sort_order: 1000, is_custom: false, is_hidden: true },
    ];
    const result = buildSectionRegistry(meta);
    const keys = result.map((s) => s.key);
    expect(keys).not.toContain('policies');
  });

  it('appends a custom row with its label and key', () => {
    const meta: FieldMetaRow[] = [
      { field_key: 'c_brand', label: 'Brand guidelines', sort_order: 500, is_custom: true, is_hidden: false },
    ];
    const result = buildSectionRegistry(meta);
    const custom = result.find((s) => s.key === 'c_brand');
    expect(custom).toBeDefined();
    expect(custom!.label).toBe('Brand guidelines');
  });

  it('never emits hard_rules as a section', () => {
    const meta: FieldMetaRow[] = [
      { field_key: 'hard_rules', label: 'Hard rules', sort_order: 1, is_custom: false, is_hidden: false },
    ];
    const result = buildSectionRegistry(meta);
    const keys = result.map((s) => s.key);
    expect(keys).not.toContain('hard_rules');
  });

  it('never emits notes as a section', () => {
    const meta: FieldMetaRow[] = [
      { field_key: 'notes', label: 'Notes', sort_order: 1, is_custom: false, is_hidden: false },
    ];
    const result = buildSectionRegistry(meta);
    const keys = result.map((s) => s.key);
    expect(keys).not.toContain('notes');
  });

  it('custom rows ordered by sort_order relative to defaults', () => {
    const meta: FieldMetaRow[] = [
      { field_key: 'c_brand', label: 'Brand', sort_order: 500, is_custom: true, is_hidden: false },
      { field_key: 'c_other', label: 'Other', sort_order: 100, is_custom: true, is_hidden: false },
    ];
    const result = buildSectionRegistry(meta);
    const brandIdx = result.findIndex((s) => s.key === 'c_brand');
    const otherIdx = result.findIndex((s) => s.key === 'c_other');
    // c_other has lower sort_order so should come before c_brand
    expect(otherIdx).toBeLessThan(brandIdx);
  });

  it('hidden custom row does not appear', () => {
    const meta: FieldMetaRow[] = [
      { field_key: 'c_hidden', label: 'Hidden', sort_order: 500, is_custom: true, is_hidden: true },
    ];
    const result = buildSectionRegistry(meta);
    const keys = result.map((s) => s.key);
    expect(keys).not.toContain('c_hidden');
  });

  it('returns SectionDescriptor objects with key, label, kind, and placeholder', () => {
    const result = buildSectionRegistry([]);
    for (const s of result) {
      expect(typeof s.key).toBe('string');
      expect(typeof s.label).toBe('string');
      expect(typeof s.kind).toBe('string');
      // placeholder may be undefined for custom rows — that's fine
    }
  });
});

// ---------------------------------------------------------------------------
// forwardMapLegacy
// ---------------------------------------------------------------------------

describe('forwardMapLegacy', () => {
  it('copies facts→about when about is absent', () => {
    const result = forwardMapLegacy({ facts: 'My business description' });
    expect(result['about']).toBe('My business description');
    // facts key is still retained
    expect(result['facts']).toBe('My business description');
  });

  it('copies facts→about when about is empty string', () => {
    const result = forwardMapLegacy({ facts: 'Some facts', about: '' });
    expect(result['about']).toBe('Some facts');
  });

  it('does NOT overwrite about when already set', () => {
    const result = forwardMapLegacy({ facts: 'Old facts', about: 'Existing about' });
    expect(result['about']).toBe('Existing about');
    expect(result['facts']).toBe('Old facts');
  });

  it('is a no-op when no facts key present', () => {
    const input = { pricing: '$100' };
    const result = forwardMapLegacy(input);
    expect(result).toEqual(input);
    expect(result['about']).toBeUndefined();
  });

  it('does not mutate the input object', () => {
    const input = { facts: 'Test', about: '' };
    const result = forwardMapLegacy(input);
    expect(result).not.toBe(input);
    // input.about should still be ''
    expect(input['about']).toBe('');
  });

  it('copies facts→about when about is whitespace-only', () => {
    const result = forwardMapLegacy({ facts: 'My description', about: '   ' });
    expect(result['about']).toBe('My description');
  });
});
