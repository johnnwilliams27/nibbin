'use server';

import { redirect } from 'next/navigation';
import { createClient } from '../../../lib/supabase/server';

/**
 * Set (or reset) the password for the currently-authenticated session. Reached
 * only with a valid session established by an invite or recovery link (the
 * /auth/callback verifyOtp step). Min 8 chars, must match the confirmation.
 */
export async function setPassword(formData: FormData) {
  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirm') ?? '');
  if (password.length < 8) redirect('/auth/set-password?error=short');
  if (password !== confirm) redirect('/auth/set-password?error=mismatch');

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { error } = await supabase.auth.updateUser({ password });
  if (error) redirect('/auth/set-password?error=failed');

  redirect('/app');
}
