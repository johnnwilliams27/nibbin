'use server';

import { redirect } from 'next/navigation';
import { createClient } from '../../lib/supabase/server';
import { siteOrigin } from '../../lib/site-url';

export async function sendMagicLink(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim();
  if (!email) redirect('/login?error=email');

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    // Pinned origin (never the Host header) so the link can't be redirected
    // to an attacker domain. Supabase's redirect allow-list is the second gate.
    options: { emailRedirectTo: `${siteOrigin()}/auth/callback` },
  });
  if (error) redirect('/login?error=send');

  redirect(`/login?sent=${encodeURIComponent(email)}`);
}
