'use server';

import { redirect } from 'next/navigation';
import { appSession } from '../../../../lib/auth/app-session';

/**
 * Schedule account deletion. Owner-only is enforced in the RPC; here we add the
 * type-to-confirm gate, re-reading the canonical account name server-side rather
 * than trusting a hidden field. The RPC starts the 30-day clock and revokes
 * every live connection immediately (which purges their derived scans).
 */
export async function requestDeletion(formData: FormData) {
  const confirm = String(formData.get('confirm') ?? '').trim();
  const { supabase, accountId } = await appSession();

  const { data: acct } = await supabase.from('accounts').select('name').eq('id', accountId).single();
  const name = (acct?.name ?? '').trim();
  if (!name || confirm !== name) {
    redirect('/app/settings/account?error=confirm');
  }

  const { error } = await supabase.rpc('request_account_deletion', { p_account: accountId });
  if (error) redirect('/app/settings/account?error=failed');
  redirect('/app/settings/account?state=scheduled');
}

/** Cancel a pending deletion while still inside the grace window. Owner-only (RPC). */
export async function cancelDeletion() {
  const { supabase, accountId } = await appSession();
  const { error } = await supabase.rpc('cancel_account_deletion', { p_account: accountId });
  if (error) redirect('/app/settings/account?error=failed');
  redirect('/app/settings/account?state=cancelled');
}
