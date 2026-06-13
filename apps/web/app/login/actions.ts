'use server';

import { redirect } from 'next/navigation';
import { createClient } from '../../lib/supabase/server';

/**
 * Email + password sign-in against the shared Supabase identity (the same
 * account used by the web app, admin, and desktop — "staff" is a permission on
 * top, not a separate login). Sign-up is invite-only: the account is provisioned
 * by an admin invite and the user sets their password via that link, so there is
 * no self-registration here.
 */
export async function signIn(formData: FormData) {
  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase();
  const password = String(formData.get('password') ?? '');
  if (!email || !password) redirect('/login?error=missing');

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  // One neutral message for any failure — no "which part was wrong" oracle.
  if (error) redirect('/login?error=credentials');

  redirect('/app');
}
