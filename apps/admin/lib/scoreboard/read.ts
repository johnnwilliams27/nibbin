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

// ---------------------------------------------------------------------------
// Capability performance (fleet) — §capability_task_performance_read RPC
// ---------------------------------------------------------------------------

/** One row of the capability-performance aggregate view (raw counts; snake_case from Postgres). */
export interface CapabilityRow {
  capability: string;
  decided_calls: bigint | number;
  approved_unedited: bigint | number;
  edited: bigint | number;
  rejected: bigint | number;
  avg_edit_distance: number | null;
  contributing_accounts: bigint | number;
}

/** A capability row with derived null-safe rates the scoreboard renders. */
export interface CapabilityScoreboardRow extends CapabilityRow {
  /** approved_unedited / decided_calls — null when decided_calls is 0. */
  approvedUneditedRate: number | null;
  /** edited / decided_calls — null when decided_calls is 0. */
  editedRate: number | null;
  /** rejected / decided_calls — null when decided_calls is 0. */
  rejectedRate: number | null;
}

/** The count columns required on every capability row. */
const REQUIRED_CAPABILITY_NUMERIC_KEYS = [
  'decided_calls',
  'approved_unedited',
  'edited',
  'rejected',
  'contributing_accounts',
] as const;

/**
 * Shape guard for one capability_task_performance_read RPC row.
 * A row is valid iff capability is a string and all count columns are finite
 * numbers (Postgres bigint columns arrive as JS number via the JS client).
 * A drifted view shape yields a clean rejection (loadCapabilityScoreboard
 * throws), never NaN rates from arithmetic on undefined.
 */
export function isCapabilityRow(row: unknown): row is CapabilityRow {
  if (!row || typeof row !== 'object') return false;
  const r = row as Record<string, unknown>;
  if (typeof r.capability !== 'string') return false;
  // avg_edit_distance is number|null (rendered with .toFixed) — a drift that
  // drops it to undefined would throw at render, so reject it here too.
  if (r.avg_edit_distance !== null && typeof r.avg_edit_distance !== 'number') return false;
  return REQUIRED_CAPABILITY_NUMERIC_KEYS.every(
    (k) => typeof r[k] === 'number' && Number.isFinite(r[k]),
  );
}

/** Derive the rendered rates from one raw capability row. Pure + null-safe. */
export function deriveCapabilityRates(row: CapabilityRow): CapabilityScoreboardRow {
  const decided = Number(row.decided_calls);
  return {
    ...row,
    approvedUneditedRate: rate(Number(row.approved_unedited), decided),
    editedRate: rate(Number(row.edited), decided),
    rejectedRate: rate(Number(row.rejected), decided),
  };
}

/**
 * Load the capability-performance scoreboard rows via the staff-gated RPC.
 * The caller MUST be a staff service-role client (the RPC is granted to
 * service_role only, matching model_task_performance_read). Aggregate-only,
 * anonymized, and k-anonymous (≥5 contributing accounts) — no per-user content.
 */
export async function loadCapabilityScoreboard(
  admin: SupabaseClient,
): Promise<CapabilityScoreboardRow[]> {
  const { data, error } = await admin.rpc('capability_task_performance_read');
  if (error) throw new Error(`capability_task_performance_read failed: ${error.message}`);
  const raw = Array.isArray(data) ? data : [];
  const rows: CapabilityRow[] = [];
  for (const row of raw) {
    if (!isCapabilityRow(row)) {
      throw new Error('capability_task_performance_read returned an unexpected row shape');
    }
    rows.push(row);
  }
  return rows.map(deriveCapabilityRates);
}

// ---------------------------------------------------------------------------
// Shop template adoption (fleet) — §shop_template_performance_read RPC
// ---------------------------------------------------------------------------

/** One row of the shop-template-performance aggregate view (raw counts; snake_case from Postgres). */
export interface ShopTemplateRow {
  template_key: string;
  nibbins: number;
  contributing_accounts: number;
  active: number;
  dormant: number;
  senior_plus: number;
  graduated: number;
}

/** A shop-template row with derived null-safe rates the scoreboard renders. */
export interface ShopTemplateScoreboardRow extends ShopTemplateRow {
  /** active / nibbins — null when nibbins is 0. */
  activeRate: number | null;
  /** senior_plus / nibbins — null when nibbins is 0. */
  maturityRate: number | null;
}

/** The count columns required on every shop-template row. */
const REQUIRED_SHOP_TEMPLATE_NUMERIC_KEYS = [
  'nibbins',
  'contributing_accounts',
  'active',
  'dormant',
  'senior_plus',
  'graduated',
] as const;

/**
 * Shape guard for one shop_template_performance_read RPC row.
 * A row is valid iff template_key is a string and all count columns are finite
 * numbers (Postgres bigint columns arrive as JS number via the JS client).
 * A drifted view shape yields a clean rejection (loadShopScoreboard throws),
 * never NaN rates from arithmetic on undefined.
 */
export function isShopTemplateRow(row: unknown): row is ShopTemplateRow {
  if (!row || typeof row !== 'object') return false;
  const r = row as Record<string, unknown>;
  if (typeof r.template_key !== 'string') return false;
  return REQUIRED_SHOP_TEMPLATE_NUMERIC_KEYS.every(
    (k) => typeof r[k] === 'number' && Number.isFinite(r[k]),
  );
}

/** Derive the rendered rates from one raw shop-template row. Pure + null-safe. */
export function deriveShopTemplateRates(row: ShopTemplateRow): ShopTemplateScoreboardRow {
  return {
    ...row,
    activeRate: rate(row.active, row.nibbins),
    maturityRate: rate(row.senior_plus, row.nibbins),
  };
}

/**
 * Load the shop-template-adoption scoreboard rows via the staff-gated RPC.
 * The caller MUST be a staff service-role client (the RPC is granted to
 * service_role only, matching capability_task_performance_read). Aggregate-only,
 * anonymized, and k-anonymous (≥5 contributing accounts) — no per-user content.
 */
export async function loadShopScoreboard(
  admin: SupabaseClient,
): Promise<ShopTemplateScoreboardRow[]> {
  const { data, error } = await admin.rpc('shop_template_performance_read');
  if (error) throw new Error(`shop_template_performance_read failed: ${error.message}`);
  const raw = Array.isArray(data) ? data : [];
  const rows: ShopTemplateRow[] = [];
  for (const row of raw) {
    if (!isShopTemplateRow(row)) {
      throw new Error('shop_template_performance_read returned an unexpected row shape');
    }
    rows.push(row);
  }
  return rows.map(deriveShopTemplateRates);
}

// ---------------------------------------------------------------------------
// Demand gap signals (fleet) — §demand_gap_signals_read RPC
// ---------------------------------------------------------------------------

/**
 * One row of the demand_gap_signals aggregate view (raw counts; snake_case from
 * Postgres). No derived rates needed — occurrences and contributing_accounts are
 * rendered as counts only.
 */
export interface DemandGapRow {
  capability: string;
  reason: string;
  occurrences: number;
  contributing_accounts: number;
  last_seen: string | null;
}

/** The count columns required on every demand-gap row. */
const REQUIRED_DEMAND_GAP_NUMERIC_KEYS = ['occurrences', 'contributing_accounts'] as const;

/**
 * Shape guard for one demand_gap_signals_read RPC row.
 * A row is valid iff capability + reason are strings, the two count columns are
 * finite numbers (Postgres bigint arrives as JS number via the JS client), and
 * last_seen is either null or a string. A drifted view shape yields a clean
 * rejection (loadDemandGaps throws), never a silent bad cast.
 */
export function isDemandGapRow(row: unknown): row is DemandGapRow {
  if (!row || typeof row !== 'object') return false;
  const r = row as Record<string, unknown>;
  if (typeof r.capability !== 'string' || typeof r.reason !== 'string') return false;
  if (r.last_seen !== null && typeof r.last_seen !== 'string') return false;
  return REQUIRED_DEMAND_GAP_NUMERIC_KEYS.every(
    (k) => typeof r[k] === 'number' && Number.isFinite(r[k]),
  );
}

/**
 * Load the demand-gap-signals rows via the staff-gated RPC. The caller MUST be
 * a staff service-role client (the RPC is granted to service_role only, matching
 * shop_template_performance_read). Aggregate-only, anonymized, and k-anonymous
 * (≥5 contributing accounts) — no per-user content.
 */
export async function loadDemandGaps(admin: SupabaseClient): Promise<DemandGapRow[]> {
  const { data, error } = await admin.rpc('demand_gap_signals_read');
  if (error) throw new Error(`demand_gap_signals_read failed: ${error.message}`);
  const raw = Array.isArray(data) ? data : [];
  const rows: DemandGapRow[] = [];
  for (const row of raw) {
    if (!isDemandGapRow(row)) {
      throw new Error('demand_gap_signals_read returned an unexpected row shape');
    }
    rows.push(row);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Connector blocker signals (fleet) — §connector_blocker_signals_read RPC
// ---------------------------------------------------------------------------

/**
 * One row of the connector_blocker_signals aggregate view (raw counts; snake_case
 * from Postgres). No derived rates needed — occurrences and contributing_accounts
 * are rendered as counts only.
 */
export interface ConnectorBlockerRow {
  connector: string;
  reason: string;
  occurrences: number;
  contributing_accounts: number;
  last_seen: string | null;
}

/** The count columns required on every connector-blocker row. */
const REQUIRED_CONNECTOR_BLOCKER_NUMERIC_KEYS = [
  'occurrences',
  'contributing_accounts',
] as const;

/**
 * Shape guard for one connector_blocker_signals_read RPC row.
 * A row is valid iff connector + reason are strings, the two count columns are
 * finite numbers, and last_seen is either null or a string. A drifted view
 * shape yields a clean rejection (loadConnectorBlockers throws), never a silent
 * bad cast.
 */
export function isConnectorBlockerRow(row: unknown): row is ConnectorBlockerRow {
  if (!row || typeof row !== 'object') return false;
  const r = row as Record<string, unknown>;
  if (typeof r.connector !== 'string' || typeof r.reason !== 'string') return false;
  if (r.last_seen !== null && typeof r.last_seen !== 'string') return false;
  return REQUIRED_CONNECTOR_BLOCKER_NUMERIC_KEYS.every(
    (k) => typeof r[k] === 'number' && Number.isFinite(r[k]),
  );
}

/**
 * Load the connector-blocker-signals rows via the staff-gated RPC. The caller
 * MUST be a staff service-role client (the RPC is granted to service_role only,
 * matching demand_gap_signals_read). Aggregate-only, anonymized, and k-anonymous
 * (≥5 contributing accounts) — no per-user content.
 */
export async function loadConnectorBlockers(
  admin: SupabaseClient,
): Promise<ConnectorBlockerRow[]> {
  const { data, error } = await admin.rpc('connector_blocker_signals_read');
  if (error) throw new Error(`connector_blocker_signals_read failed: ${error.message}`);
  const raw = Array.isArray(data) ? data : [];
  const rows: ConnectorBlockerRow[] = [];
  for (const row of raw) {
    if (!isConnectorBlockerRow(row)) {
      throw new Error('connector_blocker_signals_read returned an unexpected row shape');
    }
    rows.push(row);
  }
  return rows;
}
