import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { TesterAllowlist } from '@nibbin/connectors';
import { serviceClient } from '../supabase/service';

/** Pure, sync allowlist over a pre-loaded set (satisfies the connectors interface). */
export function makeTesterAllowlist(emails: string[]): TesterAllowlist {
  const set = new Set(emails.map((e) => e.trim().toLowerCase()));
  return {
    isAllowed: (email: string) => set.has(email.trim().toLowerCase()),
    count: () => set.size,
  };
}

/** Load the provider's tester allowlist from the service-role table. */
export async function loadTesterAllowlist(
  provider: string,
  svc: SupabaseClient = serviceClient(),
): Promise<TesterAllowlist> {
  const { data, error } = await svc.from('tester_allowlist').select('email').eq('provider', provider);
  if (error) throw new Error(`tester allowlist load failed: ${error.message}`);
  return makeTesterAllowlist((data ?? []).map((r) => r.email as string));
}
