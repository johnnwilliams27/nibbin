'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '../../../../lib/supabase/server';

/**
 * Self-update of the caller's own public.users row (RLS users_self_update).
 * Empty fields are stored as null so "cleared" is distinct from "never set".
 */
export async function saveProfile(formData: FormData) {
  const name = String(formData.get('name') ?? '').trim();
  const tz = String(formData.get('tz') ?? '').trim();
  const locale = String(formData.get('locale') ?? '').trim();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { error } = await supabase
    .from('users')
    .update({ name: name || null, tz: tz || null, locale: locale || null })
    .eq('id', user.id);
  if (error) redirect('/app/settings/profile?error=save');

  revalidatePath('/app/settings/profile');
  redirect('/app/settings/profile?saved=1');
}
