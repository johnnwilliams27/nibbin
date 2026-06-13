'use server';

import { redirect } from 'next/navigation';
import { createClient } from '../../../../lib/supabase/server';

/** Change the signed-in user's password. Min 8 chars, must match confirmation. */
export async function changePassword(formData: FormData) {
  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirm') ?? '');
  if (password.length < 8) redirect('/app/settings/security?error=short');
  if (password !== confirm) redirect('/app/settings/security?error=mismatch');

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { error } = await supabase.auth.updateUser({ password });
  if (error) redirect('/app/settings/security?error=failed');

  redirect('/app/settings/security?pw=saved');
}

/** Revoke every session for this account (this device and all others), then land on login. */
export async function signOutEverywhere() {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: 'global' });
  redirect('/login');
}
