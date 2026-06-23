'use server';

import { redirect } from 'next/navigation';
import { appSession } from '../../../lib/auth/app-session';
import { toRpcPayload } from './fields';
import { labelToFieldKey } from './registry';

const MAX_REFERENCE = 8000;

/**
 * Save the account's Grove Memory through the security-definer RPC (which
 * re-checks membership). Accepts the full per-field mirror as FormData;
 * delegates to toRpcPayload() for the exact RPC arg shape.
 *
 * Per-field mode: the caller passes the FULL mirror (all 7 fields) so the
 * sections object in the RPC is never partial — the RPC replaces the whole
 * sections JSONB column on each call.
 *
 * Legacy non-JS fallback: the ?saved=1 redirect still fires after a full-form
 * submit. Per-field JS callers ignore the redirect (it does not resolve in
 * component context) and use the thrown redirect sentinel or inline response.
 */
export async function saveGroveMemory(formData: FormData) {
  const { supabase, accountId } = await appSession();

  // Build a values mirror from FormData and delegate to the pure payload builder.
  const values: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === 'string') values[key] = value;
  }

  const { sections, hard_rules, notes } = toRpcPayload(values);

  const { error } = await supabase.rpc('save_grove_memory', {
    target_account: accountId,
    new_sections: sections,
    new_hard_rules: hard_rules,
    new_notes: notes,
  });
  if (error) redirect('/app/memory?error=1');

  redirect('/app/memory?saved=1');
}

/**
 * Save the Reference catch-all field (Sources tab) through the
 * `save_reference` security-definer RPC.
 *
 * Unlike saveGroveMemory this is a pure per-field save: it returns
 * `{ ok: true }` on success or `{ ok: false, error: string }` on failure
 * so the client can surface an inline error without a full-page redirect
 * (spec §5.3 — per-field mode never redirects).
 */
export async function saveReference(
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { supabase, accountId } = await appSession();

  const raw = String(formData.get('reference') ?? '').trim().slice(0, MAX_REFERENCE);
  const reference_text = raw || null;

  const { error } = await supabase.rpc('save_reference', {
    target_account: accountId,
    new_reference_text: reference_text,
  });

  if (error) {
    const msg = typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message: unknown }).message)
      : 'Save failed';
    return { ok: false, error: msg };
  }

  return { ok: true };
}

/**
 * Create or update a section's metadata (label, sort order, visibility) via
 * the `upsert_section_meta` security-definer RPC (Task 2).
 *
 * For a NEW custom section (`is_custom=true` and no `field_key` in FormData),
 * the `p_field_key` is SERVER-SLUGGED from the label: lowercase, non-alphanumeric→`_`,
 * collapse repeats, trim underscores, clamp body to 40 chars, prefix `c_`.
 * This matches `^c_[a-z0-9_]{1,40}$`.
 *
 * For an existing key (rename/reorder/hide of a default or known custom section),
 * the `field_key` from FormData is passed through unchanged.
 *
 * Always returns `{ ok: true }` or `{ ok: false, error }` — never redirects
 * (per-field inline save, spec §5.3).
 */
export async function saveSectionMeta(
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { supabase, accountId } = await appSession();

  const rawFieldKey = formData.get('field_key');
  const label = String(formData.get('label') ?? '').trim() || null;
  const sortOrder = parseInt(String(formData.get('sort_order') ?? '1000'), 10);
  const isCustom = formData.get('is_custom') === 'true';
  const isHidden = formData.get('is_hidden') === 'true';

  // Determine the field key: pass through an existing key, or slug from label for new custom sections.
  let fieldKey: string;
  if (rawFieldKey && String(rawFieldKey).trim()) {
    fieldKey = String(rawFieldKey).trim();
  } else {
    // New custom section: generate key server-side from the label.
    fieldKey = labelToFieldKey(label ?? '');
  }

  const { error } = await supabase.rpc('upsert_section_meta', {
    target_account: accountId,
    p_field_key: fieldKey,
    p_label: label,
    p_sort_order: isNaN(sortOrder) ? 1000 : sortOrder,
    p_is_custom: isCustom,
    p_is_hidden: isHidden,
  });

  if (error) {
    const msg = typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message: unknown }).message)
      : 'Save failed';
    return { ok: false, error: msg };
  }

  return { ok: true };
}

/**
 * Delete a custom section via the `delete_custom_section` security-definer
 * RPC (Task 3). Only custom sections (`c_*` keys) may be deleted; the RPC
 * raises for default keys.
 *
 * Always returns `{ ok: true }` or `{ ok: false, error }` — never redirects
 * (per-field inline save, spec §5.3).
 */
export async function deleteSection(
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { supabase, accountId } = await appSession();

  const fieldKey = String(formData.get('field_key') ?? '').trim();

  const { error } = await supabase.rpc('delete_custom_section', {
    target_account: accountId,
    p_field_key: fieldKey,
  });

  if (error) {
    const msg = typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message: unknown }).message)
      : 'Delete failed';
    return { ok: false, error: msg };
  }

  return { ok: true };
}
