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

  // Seed browser-detected timezone/locale on first sign-up — but never clobber
  // values the user already has (this same flow handles password resets).
  const tz = String(formData.get('tz') ?? '').trim().slice(0, 64);
  const locale = String(formData.get('locale') ?? '').trim().slice(0, 20);
  if (tz || locale) {
    const { data: me } = await supabase
      .from('users')
      .select('tz, locale')
      .eq('id', user.id)
      .maybeSingle<{ tz: string | null; locale: string | null }>();
    const patch: { tz?: string; locale?: string } = {};
    if (tz && !me?.tz) patch.tz = tz;
    if (locale && !me?.locale) patch.locale = locale;
    if (Object.keys(patch).length > 0) {
      await supabase.from('users').update(patch).eq('id', user.id);
    }
  }

  redirect('/app');
}
