import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { TesterAllowlist } from '@nibbin/connectors';
import { serviceClient } from '../supabase/service';

/**
 * Pure, sync allowlist over a pre-loaded set (satisfies the connectors interface).
 *
 * `isAllowed` gates on allowlist membership. `count()` is the number that the
 * platform's unverified-user cap (Google's 100) is measured against, so it must
 * reflect users who have actually completed a consent — `consentedUsers`, the
 * count of distinct accounts with an active connection for this provider — NOT
 * the number of allowlist rows (an allowlisted tester who never connects does
 * not consume a slot).
 */
export function makeTesterAllowlist(emails: string[], consentedUsers = 0): TesterAllowlist {
  const set = new Set(emails.map((e) => e.trim().toLowerCase()));
  return {
    isAllowed: (email: string) => set.has(email.trim().toLowerCase()),
    count: () => consentedUsers,
  };
}

/**
 * Load the provider's tester allowlist (the membership gate) and the count of
 * accounts that have actually consented (an active connection for this
 * provider) — the latter is what the unverified-user cap is enforced against.
 */
export async function loadTesterAllowlist(
  provider: string,
  svc: SupabaseClient = serviceClient(),
): Promise<TesterAllowlist> {
  const { data, error } = await svc.from('tester_allowlist').select('email').eq('provider', provider);
  if (error) throw new Error(`tester allowlist load failed: ${error.message}`);

  const { data: connRows, error: connError } = await svc
    .from('connections')
    .select('account_id')
    .eq('provider', provider)
    .eq('status', 'active');
  if (connError) throw new Error(`consented-user count load failed: ${connError.message}`);
  const consentedUsers = new Set((connRows ?? []).map((r) => r.account_id as string)).size;

  return makeTesterAllowlist((data ?? []).map((r) => r.email as string), consentedUsers);
}
