import 'server-only';

/**
 * Durable frontier-budget store (#24) — the real cap behind §6.3's
 * "T2 access from chat is budgeted per user per day".
 *
 * Backed by the frontier_budget table + frontier_budget_take RPC
 * (migration 20260612120000): grant-and-increment is ONE atomic statement
 * in Postgres, so the cap holds across every Vercel instance — the
 * in-memory store this replaces capped per-process only (cost-auditor M2
 * P1; the loud warning that lived in grove/router.ts).
 *
 * Fail-closed: any RPC error DENIES the grant. A database hiccup must
 * degrade a chat turn to T1 (transparent notice), never hand out
 * unmetered frontier calls.
 */
import type { BudgetStore } from '@nibbin/router';
import { serviceClient } from '../supabase/service';

export function pgBudgetStore(): BudgetStore {
  return {
    async take(userId, dayKey, limit) {
      const svc = serviceClient();
      const { data, error } = await svc.rpc('frontier_budget_take', {
        p_user: userId,
        p_day: dayKey,
        p_limit: limit,
      });
      if (error || !Array.isArray(data) || data.length === 0) {
        console.error('[budget] frontier_budget_take failed — denying grant (fail closed)', error?.message);
        return { granted: false, used: limit };
      }
      const row = data[0] as { granted: boolean; used: number };
      return { granted: row.granted, used: row.used };
    },

    async used(userId, dayKey) {
      const svc = serviceClient();
      const { data, error } = await svc.rpc('frontier_budget_used', {
        p_user: userId,
        p_day: dayKey,
      });
      if (error) {
        console.error('[budget] frontier_budget_used failed', error.message);
        return 0;
      }
      return typeof data === 'number' ? data : 0;
    },
  };
}
