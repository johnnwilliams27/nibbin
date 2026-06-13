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
    options: {
      // Pinned origin (never the Host header) so the link can't be redirected to
      // an attacker domain. Supabase's redirect allow-list is the second gate.
      emailRedirectTo: `${siteOrigin()}/auth/callback`,
      // Invite-only during the Founding Grove: a sign-in attempt must never MINT a
      // new account. Admin-issued invites create the user first; this only links an
      // existing one. An unknown email therefore gets no mail.
      shouldCreateUser: false,
    },
  });
  // No account-existence oracle: an unknown / non-invited email returns an auth
  // error (422 / "signups not allowed"), but we render the same neutral "sent"
  // state as a real send. Only a genuine infrastructure failure asks them to retry.
  if (error && error.status !== 422 && !/signup|not allowed|otp/i.test(error.message ?? '')) {
    redirect('/login?error=send');
  }

  redirect(`/login?sent=${encodeURIComponent(email)}`);
}
