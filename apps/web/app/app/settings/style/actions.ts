'use server';

import { redirect } from 'next/navigation';
import { appSession } from '../../../../lib/auth/app-session';

/** Save the user's freeform voice note (bounded to 1000 chars). */
export async function saveStyleNotes(formData: FormData) {
  const notes = String(formData.get('user_notes') ?? '').slice(0, 1000);
  const { supabase, accountId } = await appSession();
  const { error } = await supabase.rpc('update_style_notes', {
    p_account: accountId,
    p_notes: notes || null,
  });
  if (error) redirect('/app/settings/style?error=notes');
  redirect('/app/settings/style?state=saved');
}

/** Reset the style profile — clears everything, extraction starts fresh. */
export async function resetStyleProfile(formData: FormData) {
  void formData; // no body needed
  const { supabase, accountId } = await appSession();
  const { error } = await supabase.rpc('reset_style_profile', {
    p_account: accountId,
  });
  if (error) redirect('/app/settings/style?error=reset');
  redirect('/app/settings/style?state=reset');
}
