import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AccountHit {
  id: string;
  name: string;
}

/** Escape LIKE metacharacters so a staff query can't inject extra wildcards (red-team P3). */
function likeLiteral(s: string): string {
  return s.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * Staff account search. A UUID matches an account directly; otherwise we match
 * by member email (users.email) → memberships → accounts, plus account name.
 * Runs on the service-role client (cross-account is the whole point of staff).
 */
export async function searchAccounts(admin: SupabaseClient, query: string): Promise<AccountHit[]> {
  const q = query.trim();
  if (q === '') return [];

  if (UUID_RE.test(q)) {
    const { data } = await admin.from('accounts').select('id, name').eq('id', q).limit(1);
    return data ?? [];
  }

  const ids = new Set<string>();
  const term = likeLiteral(q);

  // by member email
  const { data: users } = await admin.from('users').select('id').ilike('email', `%${term}%`).limit(25);
  const userIds = (users ?? []).map((u) => u.id);
  if (userIds.length) {
    const { data: memberships } = await admin
      .from('memberships')
      .select('account_id')
      .in('user_id', userIds)
      .limit(50);
    for (const m of memberships ?? []) ids.add(m.account_id);
  }

  // by account name
  const { data: byName } = await admin.from('accounts').select('id').ilike('name', `%${term}%`).limit(25);
  for (const a of byName ?? []) ids.add(a.id);

  if (ids.size === 0) return [];
  const { data } = await admin
    .from('accounts')
    .select('id, name')
    .in('id', [...ids])
    .order('name')
    .limit(50);
  return data ?? [];
}
