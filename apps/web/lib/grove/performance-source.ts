import 'server-only';

/**
 * Routing Reinforcement Slice B — the web app's real PerformanceSource.
 *
 * Backs the router's reinforcement policy with the Slice-A
 * `model_task_performance` substrate (read via the staff/service-role RPC
 * `model_task_performance_read`). This is INTERNAL TELEMETRY — derived,
 * aggregate-only counts, no message or per-user content — so the service-role
 * read is the right surface (mirrors pgBudgetStore's service read; the RPC is
 * already revoked from anon/authenticated, so no product user can reach it).
 *
 * The router consults `getPerformance` SYNCHRONOUSLY (route() stays cheap and
 * deterministic), so this serves from an in-memory SNAPSHOT refreshed
 * out-of-band on a TTL. A cold or failed snapshot returns undefined for every
 * key ⇒ the policy falls back to the configured default — fail-safe: a bad read
 * NEVER reweights, it just serves today's static model. The snapshot refresh is
 * fire-and-forget; route() never awaits the DB.
 */
import type { PerfStat, PerformanceSource, RoutedTask, Tier } from '@nibbin/router';
import { serviceClient } from '../supabase/service';

/** Shape of one `model_task_performance` row (raw counts; rates derived here). */
interface PerfRow {
  model: string;
  task: string;
  tier: string;
  calls: number | null;
  decided_calls: number | null;
  approved_unedited: number | null;
  refusals: number | null;
  errors: number | null;
  avg_cost_microusd: number | null;
}

/** Default snapshot freshness — internal telemetry tolerates minutes of lag. */
const DEFAULT_TTL_MS = 5 * 60 * 1000;

function key(model: string, task: string, tier: string): string {
  return `${model}|${task}|${tier}`;
}

/** Derive the policy's PerfStat from a raw count row (rates pre-divided here). */
function toStat(row: PerfRow): PerfStat {
  const calls = row.calls ?? 0;
  const decided = row.decided_calls ?? 0;
  const approved = row.approved_unedited ?? 0;
  const refusals = row.refusals ?? 0;
  const errors = row.errors ?? 0;
  return {
    calls,
    decidedCalls: decided,
    approvedUneditedRate: decided > 0 ? approved / decided : 0,
    refusalErrorRate: calls > 0 ? (refusals + errors) / calls : 0,
    avgCostMicroUsd: row.avg_cost_microusd ?? 0,
  };
}

export interface PgPerformanceSourceOptions {
  /** Snapshot freshness; defaults to 5 minutes. */
  ttlMs?: number;
  /** Injectable clock for tests. */
  now?: () => number;
}

/**
 * Construct the durable PerformanceSource. The snapshot starts EMPTY (every
 * key → undefined), so until the first successful refresh — and until a 2nd
 * eval-cleared candidate is configured — the router behaves exactly as the
 * static config. The first `getPerformance` call triggers an async refresh; the
 * call itself reads the (still empty) snapshot, fail-safe.
 */
export function pgPerformanceSource(opts: PgPerformanceSourceOptions = {}): PerformanceSource {
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  const now = opts.now ?? (() => Date.now());

  let snapshot: Map<string, PerfStat> = new Map();
  let loadedAt = Number.NEGATIVE_INFINITY;
  let refreshing: Promise<void> | null = null;

  async function refresh(): Promise<void> {
    try {
      const svc = serviceClient();
      const { data, error } = await svc.rpc('model_task_performance_read');
      if (error || !Array.isArray(data)) {
        // Keep the previous snapshot on a transient failure (don't blank good
        // data on one bad read); never throw into route()'s path.
        console.error('[reinforce] model_task_performance_read failed — keeping prior snapshot', error?.message);
        loadedAt = now(); // back off the retry until the next TTL
        return;
      }
      const next = new Map<string, PerfStat>();
      for (const raw of data as PerfRow[]) {
        if (!raw.model || !raw.task || !raw.tier) continue;
        next.set(key(raw.model, raw.task, raw.tier), toStat(raw));
      }
      snapshot = next;
      loadedAt = now();
    } catch (err) {
      console.error('[reinforce] performance snapshot refresh threw — keeping prior snapshot', err);
      loadedAt = now();
    }
  }

  function maybeRefresh(): void {
    if (now() - loadedAt < ttlMs) return;
    if (refreshing) return; // a refresh is already in flight; don't pile on
    // Fire-and-forget: route() reads the current (possibly stale/empty)
    // snapshot now; the fresh one lands for the next request.
    refreshing = refresh().finally(() => {
      refreshing = null;
    });
  }

  return {
    getPerformance(model: string, task: RoutedTask, tier: Tier): PerfStat | undefined {
      maybeRefresh();
      return snapshot.get(key(model, task, tier));
    },
  };
}
