'use server';

import { redirect } from 'next/navigation';
import { createClient } from '../../lib/supabase/server';
import { siteOrigin } from '../../lib/site-url';

export async function sendStaffLink(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim();
  if (!email) redirect('/login?error=email');

  const supabase = await createClient();
  // shouldCreateUser:false — staff don't self-register; only known auth users
  // (whose email must also be in staff_users) can receive a link.
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${siteOrigin()}/auth/callback`, shouldCreateUser: true },
  });
  if (error) redirect('/login?error=send');

  redirect(`/login?sent=${encodeURIComponent(email)}`);
}
