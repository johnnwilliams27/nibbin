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
 * Resolve a unique `c_*` field key for a new custom section.
 *
 * Slugs the label, then checks existing `field_meta` rows for the account.
 * If the base slug collides with an existing key, appends a numeric suffix
 * (`c_my_stuff_2`, `c_my_stuff_3`, …) until a key not already present in
 * the account is found.  The body (the part after `c_`) is clamped so the
 * suffix always fits within the 40-character body limit.
 *
 * @param supabase  - Member-scoped Supabase client (already auth-checked via appSession).
 * @param accountId - The target account whose field_meta rows to inspect.
 * @param label     - The raw label supplied by the user.
 * @returns A unique field key matching `^c_[a-z0-9_]{1,40}$`.
 */
async function resolveUniqueFieldKey(
  supabase: Awaited<ReturnType<typeof import('../../../lib/auth/app-session').appSession>>['supabase'],
  accountId: string,
  label: string,
): Promise<string> {
  const baseKey = labelToFieldKey(label);

  // Fetch all existing custom field_meta keys for this account so we can check
  // for collisions without a per-attempt round-trip.
  const { data } = await supabase
    .from('field_meta')
    .select('field_key')
    .eq('account_id', accountId);

  const existingKeys = new Set<string>((data ?? []).map((r: { field_key: string }) => r.field_key));

  // If the base key is already taken, find the smallest numeric suffix that isn't.
  if (!existingKeys.has(baseKey)) return baseKey;

  const body = baseKey.slice(2); // strip 'c_' prefix

  // Reserve enough room in the 40-char body limit for '_N', '_NN', '_NNN', etc.
  // The suffix at counter N is `_${N}` so its length is `String(N).length + 1`.
  // We clamp `baseBody` to leave room for the largest suffix we'll ever need.
  // In practice counters stay < 100 so 3 extra chars suffice, but we compute it.
  for (let counter = 2; counter <= 999; counter++) {
    const suffix = '_' + String(counter);
    // Clamp the body so body + suffix stays within 40 chars.
    const clampedBody = body.slice(0, 40 - suffix.length);
    const candidate = 'c_' + clampedBody + suffix;
    if (!existingKeys.has(candidate)) return candidate;
  }

  // Fallback (practically unreachable: user would need >997 colliding sections).
  return baseKey;
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

  // Determine the field key:
  //  - EDIT path (existing key supplied): pass through unchanged.
  //  - CREATE path (no field_key): slug from label and ensure uniqueness for this account.
  let fieldKey: string;
  if (rawFieldKey && String(rawFieldKey).trim()) {
    // Rename/reorder/hide of a default or already-known custom section — key unchanged.
    fieldKey = String(rawFieldKey).trim();
  } else {
    // New custom section: generate a unique key server-side from the label.
    // resolveUniqueFieldKey checks existing field_meta rows and appends a numeric
    // suffix (_2, _3, …) if the base slug is already taken, preventing the silent
    // upsert-overwrite that would merge two distinct sections under one key.
    fieldKey = await resolveUniqueFieldKey(supabase, accountId, label ?? '');
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
 * Resolve an open field_flags conflict (Task 8, C2 surface).
 *
 * The user's pick IS the approval: calls resolve_field_flag which writes the
 * chosen value to the curated field, marks the flag resolved, logs the audit
 * trail, and bumps source-authority weights.
 *
 * Arg-name contract (PostgREST resolves by name — must be exact):
 *   p_flag_id          uuid
 *   p_chosen_source_id uuid
 *   p_chosen_value     text
 *
 * Returns `{ ok: true }` on success or `{ ok: false, error }` on failure.
 * Never redirects (inline per-field action, §5.3).
 */
export async function resolveFieldFlag(
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { supabase } = await appSession();

  const p_flag_id = String(formData.get('p_flag_id') ?? '').trim();
  const p_chosen_source_id = String(formData.get('p_chosen_source_id') ?? '').trim();
  const p_chosen_value = String(formData.get('p_chosen_value') ?? '');

  const { error } = await supabase.rpc('resolve_field_flag', {
    p_flag_id,
    p_chosen_source_id,
    p_chosen_value,
  });

  if (error) {
    const msg = typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message: unknown }).message)
      : 'Resolve failed';
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
