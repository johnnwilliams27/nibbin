import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Routing-reinforcement Slice A — the staff model-performance scoreboard read
 * layer (design 2026-06-18-routing-reinforcement-sliceA-design.md §4).
 *
 * PURE OBSERVABILITY. This reads the aggregate-only `model_task_performance`
 * view via the staff-gated `model_task_performance_read` RPC (service-role only;
 * the page asserts staff first). It changes nothing about routing — it just
 * surfaces per-(model × task) quality/cost/outcome counts so the team's manual,
 * eval-gated model choices are informed (and provider model churn is visible).
 *
 * The view returns raw COUNTS; rates are derived HERE (so the view stays a
 * simple count substrate). Division is null-safe: a task with no decided calls
 * yields null quality rates, never a divide-by-zero.
 */

/** One row of the aggregate view (raw counts; snake_case from Postgres). */
export interface PerformanceRow {
  model: string;
  task: string;
  tier: string;
  calls: number;
  decided_calls: number;
  approved_unedited: number;
  edited: number;
  rejected: number;
  avg_edit_distance: number | null;
  refusals: number;
  errors: number;
  degraded_calls: number;
  avg_cost_microusd: number | null;
  total_cost_microusd: number | null;
  avg_latency_ms: number | null;
  last_call_at: string | null;
}

/** A row with the derived rates the scoreboard renders. */
export interface ScoreboardRow extends PerformanceRow {
  /** approved_unedited / decided_calls — null when no decided calls. */
  approvedUneditedRate: number | null;
  /** edited / decided_calls — null when no decided calls. */
  editedRate: number | null;
  /** rejected / decided_calls — null when no decided calls. */
  rejectedRate: number | null;
  /** refusals / calls — null when no calls. */
  refusalRate: number | null;
  /** errors / calls — null when no calls. */
  errorRate: number | null;
  /** degraded_calls / calls — null when no calls. */
  degradationRate: number | null;
}

/** The count columns the rate math divides on — if any is missing/non-numeric
 *  the RPC shape has drifted and the derived rates would be NaN. */
const REQUIRED_NUMERIC_KEYS = [
  'calls',
  'decided_calls',
  'approved_unedited',
  'edited',
  'rejected',
  'refusals',
  'errors',
  'degraded_calls',
] as const;

/**
 * Shape guard for one RPC row (replaces an unchecked `as PerformanceRow[]`):
 * a row is valid iff it is an object whose count columns are all finite numbers
 * and whose model/task/tier are strings. A drifted view shape thus yields a
 * clean rejection (loadScoreboard throws), never NaN rates from a bad cast.
 */
function isPerformanceRow(row: unknown): row is PerformanceRow {
  if (!row || typeof row !== 'object') return false;
  const r = row as Record<string, unknown>;
  if (typeof r.model !== 'string' || typeof r.task !== 'string' || typeof r.tier !== 'string') {
    return false;
  }
  return REQUIRED_NUMERIC_KEYS.every((k) => typeof r[k] === 'number' && Number.isFinite(r[k]));
}

/** Null-safe ratio: numerator / denominator, or null when the denominator is 0. */
function rate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

/** Derive the rendered rates from one raw-count view row. Pure + null-safe. */
export function deriveRates(row: PerformanceRow): ScoreboardRow {
  return {
    ...row,
    approvedUneditedRate: rate(row.approved_unedited, row.decided_calls),
    editedRate: rate(row.edited, row.decided_calls),
    rejectedRate: rate(row.rejected, row.decided_calls),
    refusalRate: rate(row.refusals, row.calls),
    errorRate: rate(row.errors, row.calls),
    degradationRate: rate(row.degraded_calls, row.calls),
  };
}

/**
 * Load the scoreboard rows via the staff-gated RPC. The caller MUST be a staff
 * service-role client (the page asserts staff identity first; the RPC is granted
 * to service_role only, so a non-staff product user can never reach this data).
 * Aggregate-only — the rows carry no message or per-user content.
 */
export async function loadScoreboard(admin: SupabaseClient): Promise<ScoreboardRow[]> {
  const { data, error } = await admin.rpc('model_task_performance_read');
  if (error) throw new Error(`model_task_performance_read failed: ${error.message}`);
  const raw = Array.isArray(data) ? data : [];
  // Validate the RPC shape instead of an unchecked cast: a drifted view (renamed
  // or retyped count column) yields a clean error here, never NaN rates from
  // arithmetic on undefined.
  const rows: PerformanceRow[] = [];
  for (const row of raw) {
    if (!isPerformanceRow(row)) {
      throw new Error('model_task_performance_read returned an unexpected row shape');
    }
    rows.push(row);
  }
  return rows.map(deriveRates);
}
