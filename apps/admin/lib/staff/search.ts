import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AccountHit {
  id: string;
  name: string;
}

export interface AccountListRow {
  id: string;
  name: string;
  created_at: string;
  tier: string | null;
  sub_status: string | null;
  member_count: number;
  spend_usd: number | null; // 30-day LLM spend in USD (null = no calls)
}

export interface AccountListFilters {
  tier?: string;
  status?: string;
  from?: string;
  to?: string;
}

/**
 * Aggregate 30-day per-account LLM spend in a single query (efficient — one
 * scan of model_calls, NOT one RPC call per account row).
 */
async function fetchSpendMap(
  admin: SupabaseClient,
): Promise<Map<string, number>> {
  const { data } = await admin
    .from('model_calls')
    .select('account_id, cost_microusd')
    .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());
  const map = new Map<string, number>();
  for (const row of data ?? []) {
    const prev = map.get(row.account_id) ?? 0;
    map.set(row.account_id, prev + Number(row.cost_microusd));
  }
  return map;
}

/**
 * Filterable account list for the staff accounts index. Returns up to 100
 * accounts ordered by created_at DESC, with tier/status/member-count and
 * the 30-day LLM spend joined in memory.
 */
export async function listAccounts(
  admin: SupabaseClient,
  filters: AccountListFilters,
): Promise<AccountListRow[]> {
  // 1. Pull accounts with their subscription + membership count.
  let q = admin
    .from('accounts')
    .select(
      `id, name, created_at,
       subscriptions(tier, status),
       memberships(count)`,
    )
    .order('created_at', { ascending: false })
    .limit(100);

  if (filters.from) q = q.gte('created_at', filters.from);
  if (filters.to) {
    // Treat "to" as end-of-day by appending T23:59:59 if no time component.
    const toTs = filters.to.includes('T') ? filters.to : `${filters.to}T23:59:59Z`;
    q = q.lte('created_at', toTs);
  }

  const { data: accountRows } = await q;
  if (!accountRows || accountRows.length === 0) return [];

  // 2. Filter by tier/status (done in JS so we keep a single query path).
  type RawRow = {
    id: string;
    name: string;
    created_at: string;
    subscriptions: { tier: string; status: string }[] | { tier: string; status: string } | null;
    // Supabase returns the embedded count aggregate as [{ count: number }].
    memberships: { count: number }[] | { count: number } | null;
  };

  let rows = accountRows as unknown as RawRow[];

  if (filters.tier) {
    rows = rows.filter((r) => {
      const sub = Array.isArray(r.subscriptions) ? r.subscriptions[0] : r.subscriptions;
      return sub?.tier === filters.tier;
    });
  }
  if (filters.status) {
    rows = rows.filter((r) => {
      const sub = Array.isArray(r.subscriptions) ? r.subscriptions[0] : r.subscriptions;
      return sub?.status === filters.status;
    });
  }

  // 3. Fetch spend map once for all accounts.
  const spendMap = await fetchSpendMap(admin);

  return rows.map((r) => {
    const sub = Array.isArray(r.subscriptions) ? r.subscriptions[0] : r.subscriptions;
    // Supabase embedded count aggregate: memberships(count) → [{ count: N }].
    // Read the first element's count; handle both array and object shapes.
    const memberships = r.memberships;
    const memberCount = Array.isArray(memberships)
      ? (memberships[0]?.count ?? 0)
      : (memberships?.count ?? 0);
    const microusd = spendMap.get(r.id);
    return {
      id: r.id,
      name: r.name,
      created_at: r.created_at,
      tier: sub?.tier ?? null,
      sub_status: sub?.status ?? null,
      member_count: memberCount,
      spend_usd: microusd != null ? microusd / 1_000_000 : null,
    };
  });
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
