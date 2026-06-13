'use server';

import { redirect } from 'next/navigation';
import { createClient } from '../../lib/supabase/server';
import { adminClient } from '../../lib/supabase/admin';

/**
 * Staff sign-in. Same Supabase identity + password as the product app — "staff"
 * is a permission (staff_users, via staff_identity_for_email), not a separate
 * credential. Sign in, then require the staff gate; a valid NON-staff session is
 * signed out and denied, so admin never grants access to an ordinary product user.
 */
export async function signInStaff(formData: FormData) {
  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase();
  const password = String(formData.get('password') ?? '');
  if (!email || !password) redirect('/login?error=missing');

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user?.email) redirect('/login?error=credentials');

  // Exact, wildcard-free staff match via the RPC (red-team P0) — never .ilike().
  const { data: staffRows } = await adminClient().rpc('staff_identity_for_email', {
    p_email: data.user.email,
  });
  if (!Array.isArray(staffRows) || staffRows.length === 0) {
    await supabase.auth.signOut();
    redirect('/login?error=denied');
  }

  redirect('/accounts');
}
