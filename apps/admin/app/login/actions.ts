'use server';

import { redirect } from 'next/navigation';
import { createClient } from '../../lib/supabase/server';
import { siteOrigin } from '../../lib/site-url';

export async function sendStaffLink(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim();
  if (!email) redirect('/login?error=email');

  const supabase = await createClient();
  // shouldCreateUser:false — staff don't self-register. Staff auth users are
  // provisioned out of band; the admin login must never mint auth users for
  // arbitrary emails (red-team P1).
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${siteOrigin()}/auth/callback`, shouldCreateUser: false },
  });
  if (error) redirect('/login?error=send');

  redirect(`/login?sent=${encodeURIComponent(email)}`);
}
