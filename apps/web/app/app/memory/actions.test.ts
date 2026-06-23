/**
 * Task 5 — `actions.ts` unit tests.
 *
 * Scope (per plan §Task 5):
 *  - Verify `toRpcPayload` produces the exact argument shape `save_grove_memory` expects.
 *    (This is the pure core already tested in fields.test.ts; we re-assert here to prove
 *    the action uses it correctly rather than reimplementing inline logic.)
 *  - Verify `saveReference` trims and clamps its input to ≤8000 chars before calling
 *    the RPC; verify it surfaces an error object (not a full-page redirect) on per-field
 *    mode failures.
 *
 * What we do NOT test here:
 *  - The 'use server' redirect path itself (Next.js redirect() throws inside vitest).
 *  - The actual Supabase round-trip or network calls.
 *
 * Mock strategy (mirrors diagnosis/actions.test.ts and planner/actions.test.ts):
 *  - vi.mock appSession to return a fixed accountId + Supabase stub.
 *  - The Supabase stub captures `.rpc(name, args)` calls so we can assert on the payload.
 *  - vi.mock next/navigation so `redirect()` is a no-op spy (not a throwing sentinel).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock: next/navigation — redirect throws by default in Next.js RSC and would
// break tests; replace it with a spy that we can assert on.
// ---------------------------------------------------------------------------
const redirectSpy = vi.fn();
vi.mock('next/navigation', () => ({
  redirect: (...args: unknown[]) => redirectSpy(...args),
}));

// ---------------------------------------------------------------------------
// Mock: appSession — fixed account, captures supabase.rpc calls
// ---------------------------------------------------------------------------
const rpcSpy = vi.fn(async () => ({ data: null, error: null }));
const supabaseStub = { rpc: rpcSpy };

vi.mock('../../../lib/auth/app-session', () => ({
  appSession: vi.fn(async () => ({
    supabase: supabaseStub,
    accountId: 'acct-test-1',
    user: { id: 'user-test-1', email: 'test@example.com' },
  })),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks are declared)
// ---------------------------------------------------------------------------
import { toRpcPayload } from './fields';
import type { ValuesRecord } from './fields';

// ---------------------------------------------------------------------------
// toRpcPayload ↔ save_grove_memory arg shape contract
//
// These tests assert that toRpcPayload (the pure core the action calls) produces
// EXACTLY the args that save_grove_memory expects: { sections, hard_rules, notes }.
// The action must not pass a partial sections object — it always sends the full mirror.
// ---------------------------------------------------------------------------

describe('toRpcPayload → save_grove_memory arg shape', () => {
  it('produces the exact three top-level keys save_grove_memory expects', () => {
    const values: ValuesRecord = {
      facts: 'Location: Portland',
      pricing: '$400 session',
      policies: '48hr cancel',
      faq: 'Travel? Yes.',
      voice: 'Warm and direct',
      hard_rules: 'No alcohol\nNo after midnight',
      notes: 'Misc context here.',
    };
    const payload = toRpcPayload(values);
    // Exactly these three keys — no extra keys that could confuse the RPC
    expect(Object.keys(payload)).toEqual(['sections', 'hard_rules', 'notes']);
  });

  it('sections is an object (not an array); hard_rules is an array; notes is string|null', () => {
    const values: ValuesRecord = {
      facts: 'Facts here',
      hard_rules: 'Rule one',
      notes: 'Notes here',
    };
    const payload = toRpcPayload(values);
    expect(typeof payload.sections).toBe('object');
    expect(!Array.isArray(payload.sections)).toBe(true);
    expect(Array.isArray(payload.hard_rules)).toBe(true);
    expect(payload.notes === null || typeof payload.notes === 'string').toBe(true);
  });

  it('never includes hard_rules or notes inside sections (they are separate RPC params)', () => {
    const values: ValuesRecord = {
      facts: 'Business type: Consulting',
      hard_rules: 'No cold calls',
      notes: 'Extra context',
    };
    const payload = toRpcPayload(values);
    expect(payload.sections).not.toHaveProperty('hard_rules');
    expect(payload.sections).not.toHaveProperty('notes');
  });

  it('transmits all neutral section keys when all are present', () => {
    const values: ValuesRecord = {
      about: 'About us',
      offering: 'Offering',
      how: 'How we work',
      pricing: 'Pricing',
      policies: 'Policies',
      faq: 'FAQ',
      voice: 'Voice',
      hard_rules: '',
      notes: '',
    };
    const payload = toRpcPayload(values);
    expect(payload.sections).toHaveProperty('about', 'About us');
    expect(payload.sections).toHaveProperty('offering', 'Offering');
    expect(payload.sections).toHaveProperty('how', 'How we work');
    expect(payload.sections).toHaveProperty('pricing', 'Pricing');
    expect(payload.sections).toHaveProperty('policies', 'Policies');
    expect(payload.sections).toHaveProperty('faq', 'FAQ');
    expect(payload.sections).toHaveProperty('voice', 'Voice');
  });

  it('sending an empty mirror produces sections:{}, hard_rules:[], notes:null (safe no-op write)', () => {
    const payload = toRpcPayload({});
    expect(payload.sections).toEqual({});
    expect(payload.hard_rules).toEqual([]);
    expect(payload.notes).toBeNull();
  });

  it('partial mirror (only one section changed) still transmits the other sections present', () => {
    // When MemoryClient saves via per-field mode it must send the FULL mirror,
    // not just the one changed key. This test confirms that toRpcPayload
    // faithfully includes whatever is in the mirror passed to it.
    const mirrorAfterPricingEdit: ValuesRecord = {
      about: 'Design studio in Portland',
      pricing: 'UPDATED: $500/month', // the changed field
      policies: 'Net-30 terms',
      faq: 'Travel? Yes.',
      voice: 'Warm and direct',
      hard_rules: 'No alcohol',
      notes: '',
    };
    const payload = toRpcPayload(mirrorAfterPricingEdit);
    // The changed field is present
    expect(payload.sections.pricing).toBe('UPDATED: $500/month');
    // The unchanged fields are also present (the RPC replaces the whole object)
    expect(payload.sections.about).toBe('Design studio in Portland');
    expect(payload.sections.policies).toBe('Net-30 terms');
  });
});

// ---------------------------------------------------------------------------
// saveGroveMemory — per-field save via FormData (full mirror path)
// ---------------------------------------------------------------------------

describe('saveGroveMemory — per-field save via FormData', () => {
  beforeEach(() => {
    rpcSpy.mockClear();
    redirectSpy.mockClear();
  });

  it('calls save_grove_memory RPC with the full mirror payload', async () => {
    const { saveGroveMemory } = await import('./actions');

    const fd = new FormData();
    fd.set('facts', 'Location: Portland');
    fd.set('pricing', '$400 session');
    fd.set('policies', '48hr cancel');
    fd.set('faq', 'Travel? Yes.');
    fd.set('voice', 'Warm and direct');
    fd.set('hard_rules', 'No alcohol');
    fd.set('notes', 'Misc notes');

    await saveGroveMemory(fd);

    expect(rpcSpy).toHaveBeenCalledTimes(1);
    const call0 = rpcSpy.mock.calls[0] as unknown as [string, Record<string, unknown>];
    const [rpcName, rpcArgs] = call0;
    expect(rpcName).toBe('save_grove_memory');
    expect(rpcArgs).toHaveProperty('target_account', 'acct-test-1');
    expect(rpcArgs).toHaveProperty('new_sections');
    expect(rpcArgs).toHaveProperty('new_hard_rules');
    expect(rpcArgs).toHaveProperty('new_notes');
  });

  it('redirects to ?saved=1 on success', async () => {
    const { saveGroveMemory } = await import('./actions');
    const fd = new FormData();
    await saveGroveMemory(fd);
    expect(redirectSpy).toHaveBeenCalledWith('/app/memory?saved=1');
  });

  it('redirects to ?error=1 when the RPC returns an error', async () => {
    rpcSpy.mockResolvedValueOnce({ data: null, error: { message: 'db error' } as unknown as null });
    const { saveGroveMemory } = await import('./actions');
    const fd = new FormData();
    await saveGroveMemory(fd);
    expect(redirectSpy).toHaveBeenCalledWith('/app/memory?error=1');
  });
});

// ---------------------------------------------------------------------------
// saveSectionMeta — section create/rename/reorder/hide (Task 5)
// ---------------------------------------------------------------------------

describe('saveSectionMeta — upsert_section_meta RPC', () => {
  beforeEach(() => {
    rpcSpy.mockClear();
    redirectSpy.mockClear();
  });

  it('calls upsert_section_meta with EXACTLY the right arg keys (bidirectional)', async () => {
    const { saveSectionMeta } = await import('./actions');

    const fd = new FormData();
    fd.set('field_key', 'voice');
    fd.set('label', 'House voice');
    fd.set('sort_order', '1');
    fd.set('is_custom', 'false');
    fd.set('is_hidden', 'false');

    await saveSectionMeta(fd);

    expect(rpcSpy).toHaveBeenCalledTimes(1);
    const [rpcName, rpcArgs] = rpcSpy.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(rpcName).toBe('upsert_section_meta');

    const actualKeys = Object.keys(rpcArgs).sort();
    const expectedKeys = [
      'p_field_key',
      'p_is_custom',
      'p_is_hidden',
      'p_label',
      'p_sort_order',
      'target_account',
    ].sort();
    expect(actualKeys).toEqual(expectedKeys);
  });

  it('passes the correct values for an existing key (rename/reorder/hide of default)', async () => {
    const { saveSectionMeta } = await import('./actions');

    const fd = new FormData();
    fd.set('field_key', 'voice');
    fd.set('label', 'House voice');
    fd.set('sort_order', '50');
    fd.set('is_custom', 'false');
    fd.set('is_hidden', 'false');

    await saveSectionMeta(fd);

    const [, rpcArgs] = rpcSpy.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(rpcArgs['target_account']).toBe('acct-test-1');
    expect(rpcArgs['p_field_key']).toBe('voice');
    expect(rpcArgs['p_label']).toBe('House voice');
    expect(rpcArgs['p_sort_order']).toBe(50);
    expect(rpcArgs['p_is_custom']).toBe(false);
    expect(rpcArgs['p_is_hidden']).toBe(false);
  });

  it('server-slugs label to p_field_key for a NEW custom section (is_custom=true, no field_key)', async () => {
    const { saveSectionMeta } = await import('./actions');

    const fd = new FormData();
    // No field_key → server must generate from label
    fd.set('label', 'Brand Guidelines!');
    fd.set('sort_order', '500');
    fd.set('is_custom', 'true');
    fd.set('is_hidden', 'false');

    await saveSectionMeta(fd);

    const [rpcName, rpcArgs] = rpcSpy.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(rpcName).toBe('upsert_section_meta');
    expect(rpcArgs['p_field_key']).toBe('c_brand_guidelines');
    expect(rpcArgs['p_is_custom']).toBe(true);
  });

  it('slug: label of all symbols produces a safe fallback key c_section', async () => {
    const { saveSectionMeta } = await import('./actions');

    const fd = new FormData();
    fd.set('label', '!!!');
    fd.set('sort_order', '500');
    fd.set('is_custom', 'true');
    fd.set('is_hidden', 'false');

    await saveSectionMeta(fd);

    const [, rpcArgs] = rpcSpy.mock.calls[0] as unknown as [string, Record<string, unknown>];
    // When the slug body is empty after sanitization, falls back to 'c_section'
    expect(rpcArgs['p_field_key']).toBe('c_section');
  });

  it('slug: collapses multiple underscores and trims leading/trailing', async () => {
    const { saveSectionMeta } = await import('./actions');

    const fd = new FormData();
    fd.set('label', '  Brand   &   Voice  ');
    fd.set('sort_order', '200');
    fd.set('is_custom', 'true');
    fd.set('is_hidden', 'false');

    await saveSectionMeta(fd);

    const [, rpcArgs] = rpcSpy.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(rpcArgs['p_field_key']).toBe('c_brand_voice');
  });

  it('slug: clamps body to 40 chars after c_ prefix', async () => {
    const { saveSectionMeta } = await import('./actions');

    const fd = new FormData();
    fd.set('label', 'A very long section name that exceeds the forty character limit for field keys');
    fd.set('sort_order', '300');
    fd.set('is_custom', 'true');
    fd.set('is_hidden', 'false');

    await saveSectionMeta(fd);

    const [, rpcArgs] = rpcSpy.mock.calls[0] as unknown as [string, Record<string, unknown>];
    const key = rpcArgs['p_field_key'] as string;
    expect(key.startsWith('c_')).toBe(true);
    // body is the part after 'c_'
    expect(key.slice(2).length).toBeLessThanOrEqual(40);
    expect(/^c_[a-z0-9_]{1,40}$/.test(key)).toBe(true);
  });

  it('returns { ok: true } on success (no redirect)', async () => {
    const { saveSectionMeta } = await import('./actions');

    const fd = new FormData();
    fd.set('field_key', 'voice');
    fd.set('label', 'House voice');
    fd.set('sort_order', '1');
    fd.set('is_custom', 'false');
    fd.set('is_hidden', 'false');

    const result = await saveSectionMeta(fd);
    expect(result).toEqual({ ok: true });
    expect(redirectSpy).not.toHaveBeenCalled();
  });

  it('returns { ok: false, error: string } on RPC error (no redirect)', async () => {
    rpcSpy.mockResolvedValueOnce({ data: null, error: { message: 'section limit reached' } as unknown as null });
    const { saveSectionMeta } = await import('./actions');

    const fd = new FormData();
    fd.set('field_key', 'voice');
    fd.set('label', 'House voice');
    fd.set('sort_order', '1');
    fd.set('is_custom', 'false');
    fd.set('is_hidden', 'false');

    const result = await saveSectionMeta(fd);
    expect(result).toHaveProperty('ok', false);
    expect((result as { ok: false; error: string }).error).toBeTruthy();
    expect(redirectSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// deleteSection — delete_custom_section RPC (Task 5)
// ---------------------------------------------------------------------------

describe('deleteSection — delete_custom_section RPC', () => {
  beforeEach(() => {
    rpcSpy.mockClear();
    redirectSpy.mockClear();
  });

  it('calls delete_custom_section with EXACTLY the right arg keys (bidirectional)', async () => {
    const { deleteSection } = await import('./actions');

    const fd = new FormData();
    fd.set('field_key', 'c_brand_guidelines');

    await deleteSection(fd);

    expect(rpcSpy).toHaveBeenCalledTimes(1);
    const [rpcName, rpcArgs] = rpcSpy.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(rpcName).toBe('delete_custom_section');

    const actualKeys = Object.keys(rpcArgs).sort();
    const expectedKeys = ['p_field_key', 'target_account'].sort();
    expect(actualKeys).toEqual(expectedKeys);
  });

  it('passes the correct field_key and account values', async () => {
    const { deleteSection } = await import('./actions');

    const fd = new FormData();
    fd.set('field_key', 'c_brand_guidelines');

    await deleteSection(fd);

    const [, rpcArgs] = rpcSpy.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(rpcArgs['target_account']).toBe('acct-test-1');
    expect(rpcArgs['p_field_key']).toBe('c_brand_guidelines');
  });

  it('returns { ok: true } on success (no redirect)', async () => {
    const { deleteSection } = await import('./actions');

    const fd = new FormData();
    fd.set('field_key', 'c_brand_guidelines');

    const result = await deleteSection(fd);
    expect(result).toEqual({ ok: true });
    expect(redirectSpy).not.toHaveBeenCalled();
  });

  it('returns { ok: false, error: string } on RPC error (no redirect)', async () => {
    rpcSpy.mockResolvedValueOnce({ data: null, error: { message: 'not a custom section' } as unknown as null });
    const { deleteSection } = await import('./actions');

    const fd = new FormData();
    fd.set('field_key', 'voice'); // not a custom key — RPC would reject it

    const result = await deleteSection(fd);
    expect(result).toHaveProperty('ok', false);
    expect((result as { ok: false; error: string }).error).toBeTruthy();
    expect(redirectSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// labelToFieldKey — slug helper (Task 5, exported from registry.ts)
// ---------------------------------------------------------------------------

describe('labelToFieldKey — slug helper', () => {
  it('lowercases and replaces non-alphanumeric with underscores', async () => {
    const { labelToFieldKey } = await import('./registry');
    expect(labelToFieldKey('Brand Guidelines!')).toBe('c_brand_guidelines');
  });

  it('collapses repeated underscores', async () => {
    const { labelToFieldKey } = await import('./registry');
    expect(labelToFieldKey('Brand   &   Voice')).toBe('c_brand_voice');
  });

  it('trims leading and trailing underscores from the body', async () => {
    const { labelToFieldKey } = await import('./registry');
    expect(labelToFieldKey('  !!!Hello!!!')).toBe('c_hello');
  });

  it('falls back to c_section when no alphanumeric chars remain', async () => {
    const { labelToFieldKey } = await import('./registry');
    expect(labelToFieldKey('!!!')).toBe('c_section');
  });

  it('clamps the body to 40 characters', async () => {
    const { labelToFieldKey } = await import('./registry');
    const key = labelToFieldKey('A very long section name that exceeds the forty character limit for field keys');
    expect(key.startsWith('c_')).toBe(true);
    expect(key.slice(2).length).toBeLessThanOrEqual(40);
    expect(/^c_[a-z0-9_]{1,40}$/.test(key)).toBe(true);
  });

  it('handles numeric-only labels', async () => {
    const { labelToFieldKey } = await import('./registry');
    const key = labelToFieldKey('2024');
    expect(key).toBe('c_2024');
  });
});

// ---------------------------------------------------------------------------
// saveReference — per-field save for reference_text (Sources tab)
// ---------------------------------------------------------------------------

describe('saveReference — input trimming + clamping', () => {
  beforeEach(() => {
    rpcSpy.mockClear();
    redirectSpy.mockClear();
  });

  it('calls save_reference RPC with the trimmed reference text', async () => {
    const { saveReference } = await import('./actions');

    const fd = new FormData();
    fd.set('reference', '  Some reference material  ');
    await saveReference(fd);

    expect(rpcSpy).toHaveBeenCalledTimes(1);
    const call0r = rpcSpy.mock.calls[0] as unknown as [string, Record<string, unknown>];
    const [rpcName, rpcArgs] = call0r;
    expect(rpcName).toBe('save_reference');
    expect(rpcArgs).toHaveProperty('target_account', 'acct-test-1');
    const text = rpcArgs['new_reference_text'] as string;
    expect(text).toBe('Some reference material');
  });

  it('clamps reference text to ≤8000 chars before calling the RPC', async () => {
    const { saveReference } = await import('./actions');

    const longText = 'x'.repeat(9000);
    const fd = new FormData();
    fd.set('reference', longText);
    await saveReference(fd);

    expect(rpcSpy).toHaveBeenCalledTimes(1);
    const [, rpcArgs] = rpcSpy.mock.calls[0] as unknown as [string, Record<string, unknown>];
    const text = rpcArgs['new_reference_text'] as string;
    expect(typeof text === 'string' || text === null).toBe(true);
    if (typeof text === 'string') {
      expect(text.length).toBeLessThanOrEqual(8000);
    }
  });

  it('passes null when reference is blank/empty', async () => {
    const { saveReference } = await import('./actions');

    const fd = new FormData();
    fd.set('reference', '   ');
    await saveReference(fd);

    expect(rpcSpy).toHaveBeenCalledTimes(1);
    const [, rpcArgs] = rpcSpy.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(rpcArgs['new_reference_text']).toBeNull();
  });

  it('passes null when reference field is absent from FormData', async () => {
    const { saveReference } = await import('./actions');

    const fd = new FormData(); // no 'reference' key
    await saveReference(fd);

    expect(rpcSpy).toHaveBeenCalledTimes(1);
    const [, rpcArgs] = rpcSpy.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(rpcArgs['new_reference_text']).toBeNull();
  });

  it('returns { ok: true } on success (no redirect — per-field inline save, §5.3)', async () => {
    const { saveReference } = await import('./actions');
    const fd = new FormData();
    fd.set('reference', 'Some context');
    const result = await saveReference(fd);
    expect(result).toEqual({ ok: true });
    // saveReference must NOT trigger a full-page redirect in per-field mode
    expect(redirectSpy).not.toHaveBeenCalled();
  });

  it('returns { ok: false, error: string } on RPC error (inline error, no redirect)', async () => {
    rpcSpy.mockResolvedValueOnce({ data: null, error: { message: 'RPC failed' } as unknown as null });
    const { saveReference } = await import('./actions');
    const fd = new FormData();
    fd.set('reference', 'Some context');
    const result = await saveReference(fd);
    expect(result).toHaveProperty('ok', false);
    expect((result as { ok: false; error: string }).error).toBeTruthy();
    // must not redirect on per-field save failure
    expect(redirectSpy).not.toHaveBeenCalled();
  });
});
