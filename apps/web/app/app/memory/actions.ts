'use server';

import { redirect } from 'next/navigation';
import { appSession } from '../../../lib/auth/app-session';
import { MEMORY_SECTIONS } from '../../../lib/grove/memory';

const MAX_FIELD = 6000;

/**
 * Save the account's Grove Memory through the security-definer RPC (which
 * re-checks membership). Sections come from per-field textareas; hard rules are
 * one-per-line. The client never writes the table directly.
 */
export async function saveGroveMemory(formData: FormData) {
  const { supabase, accountId } = await appSession();

  const sections: Record<string, string> = {};
  for (const { key } of MEMORY_SECTIONS) {
    const v = String(formData.get(key) ?? '')
      .trim()
      .slice(0, MAX_FIELD);
    if (v) sections[key] = v;
  }

  const hardRules = String(formData.get('hard_rules') ?? '')
    .split('\n')
    .map((r) => r.trim())
    .filter(Boolean)
    .slice(0, 50);

  const notes = String(formData.get('notes') ?? '')
    .trim()
    .slice(0, 8000);

  const { error } = await supabase.rpc('save_grove_memory', {
    target_account: accountId,
    new_sections: sections,
    new_hard_rules: hardRules,
    new_notes: notes || null,
  });
  if (error) redirect('/app/memory?error=1');

  redirect('/app/memory?saved=1');
}
