'use server';

import { redirect } from 'next/navigation';
import { appSession } from '../../../lib/auth/app-session';
import { toRpcPayload } from './fields';

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
