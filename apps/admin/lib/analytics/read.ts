import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Staff analytics read layer.
 *
 * Surfaces operational metrics for the staff Analytics dashboard via two
 * service_role-only RPCs (`analytics_overview` and `analytics_daily`) and a
 * public GitHub Releases API call for desktop download counts.
 *
 * PURE OBSERVABILITY. No mutations. All counts are aggregated server-side;
 * no per-user content is returned.
 */

// ---------------------------------------------------------------------------
// analytics_overview — single-row aggregate
// ---------------------------------------------------------------------------

/** The 19 bigint columns returned by analytics_overview(), as JS numbers. */
export interface AnalyticsOverview {
  waitlist_total: number;
  waitlist_confirmed: number;
  accounts_total: number;
  accounts_7d: number;
  accounts_30d: number;
  active_1d: number;
  active_7d: number;
  active_30d: number;
  runs_total: number;
  runs_30d: number;
  decided_30d: number;
  approved_unedited_30d: number;
  edited_30d: number;
  rejected_30d: number;
  nibbins_total: number;
  nibbins_egg: number;
  nibbins_student: number;
  nibbins_senior: number;
  nibbins_grad: number;
}

/** The columns that must be finite numbers; any drift triggers a throw. */
const OVERVIEW_NUMERIC_KEYS: ReadonlyArray<keyof AnalyticsOverview> = [
  'waitlist_total',
  'waitlist_confirmed',
  'accounts_total',
  'accounts_7d',
  'accounts_30d',
  'active_1d',
  'active_7d',
  'active_30d',
  'runs_total',
  'runs_30d',
  'decided_30d',
  'approved_unedited_30d',
  'edited_30d',
  'rejected_30d',
  'nibbins_total',
  'nibbins_egg',
  'nibbins_student',
  'nibbins_senior',
  'nibbins_grad',
];

/**
 * Shape guard for analytics_overview() row. A drifted RPC shape (renamed or
 * retyped column) yields a clean rejection here rather than NaN downstream.
 */
export function isAnalyticsOverview(row: unknown): row is AnalyticsOverview {
  if (!row || typeof row !== 'object') return false;
  const r = row as Record<string, unknown>;
  return OVERVIEW_NUMERIC_KEYS.every((k) => typeof r[k] === 'number' && Number.isFinite(r[k]));
}

/** Null-safe ratio: numerator / denominator, or null when denominator is 0. */
function rate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

/**
 * Derived rate: approved_unedited_30d / decided_30d.
 * Returns null when decided_30d is 0 (no approve/reject decisions yet).
 */
export function approvalRate(overview: AnalyticsOverview): number | null {
  return rate(overview.approved_unedited_30d, overview.decided_30d);
}

/**
 * Load the single analytics_overview() row via the service_role client.
 * The caller MUST be a staff service-role client — the page asserts staff
 * identity first, and the RPC is granted to service_role only.
 */
export async function loadAnalyticsOverview(admin: SupabaseClient): Promise<AnalyticsOverview> {
  const { data, error } = await admin.rpc('analytics_overview');
  if (error) throw new Error(`analytics_overview failed: ${error.message}`);
  const raw = Array.isArray(data) ? data : data ? [data] : [];
  if (raw.length === 0) throw new Error('analytics_overview returned no rows');
  const row = raw[0];
  if (!isAnalyticsOverview(row)) {
    throw new Error('analytics_overview returned an unexpected row shape');
  }
  return row;
}

// ---------------------------------------------------------------------------
// analytics_daily — per-day time-series
// ---------------------------------------------------------------------------

/** One row from analytics_daily(p_days). day is a date string (YYYY-MM-DD). */
export interface AnalyticsDay {
  day: string;
  accounts_created: number;
  runs: number;
  approvals: number;
  active_accounts: number;
}

const DAILY_NUMERIC_KEYS: ReadonlyArray<keyof Omit<AnalyticsDay, 'day'>> = [
  'accounts_created',
  'runs',
  'approvals',
  'active_accounts',
];

/**
 * Shape guard for one analytics_daily() row. Rejects any row where a required
 * numeric column is missing or non-finite, or where day is not a string.
 */
function isAnalyticsDay(row: unknown): row is AnalyticsDay {
  if (!row || typeof row !== 'object') return false;
  const r = row as Record<string, unknown>;
  if (typeof r.day !== 'string') return false;
  return DAILY_NUMERIC_KEYS.every((k) => typeof r[k] === 'number' && Number.isFinite(r[k]));
}

/**
 * Load daily analytics rows via the service_role client.
 * Returns rows oldest → newest. The `days` argument maps to `p_days` (default 30).
 */
export async function loadAnalyticsDaily(
  admin: SupabaseClient,
  days = 30,
): Promise<AnalyticsDay[]> {
  const { data, error } = await admin.rpc('analytics_daily', { p_days: days });
  if (error) throw new Error(`analytics_daily failed: ${error.message}`);
  const raw = Array.isArray(data) ? data : [];
  const rows: AnalyticsDay[] = [];
  for (const row of raw) {
    if (!isAnalyticsDay(row)) {
      throw new Error('analytics_daily returned an unexpected row shape');
    }
    rows.push(row);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Desktop download counts — GitHub Releases API (public repo, no token)
// ---------------------------------------------------------------------------

/** Per-platform download totals across all releases. */
export interface DesktopDownloadsByPlatform {
  macos: number;
  windows: number;
}

/** Per-release summary (tag + total downloads across all platforms). */
export interface DesktopReleaseRow {
  tag: string;
  total: number;
}

/** Successful result: platform totals + per-release breakdown. */
export interface DesktopDownloadsAvailable {
  available: true;
  byPlatform: DesktopDownloadsByPlatform;
  releases: DesktopReleaseRow[];
}

/** Soft-fail sentinel: GitHub API unavailable — the dashboard still renders. */
export interface DesktopDownloadsUnavailable {
  available: false;
}

export type DesktopDownloads = DesktopDownloadsAvailable | DesktopDownloadsUnavailable;

/** Minimal shape of one GitHub Release asset (only fields we use). */
interface GhAsset {
  name: string;
  download_count: number;
}

/** Minimal shape of one GitHub Release. */
interface GhRelease {
  tag_name: string;
  assets: GhAsset[];
}

function isGhAsset(a: unknown): a is GhAsset {
  if (!a || typeof a !== 'object') return false;
  const r = a as Record<string, unknown>;
  return typeof r.name === 'string' && typeof r.download_count === 'number';
}

function isGhRelease(r: unknown): r is GhRelease {
  if (!r || typeof r !== 'object') return false;
  const rr = r as Record<string, unknown>;
  return (
    typeof rr.tag_name === 'string' &&
    Array.isArray(rr.assets) &&
    rr.assets.every(isGhAsset)
  );
}

/**
 * Fetch per-platform desktop download counts from the public GitHub Releases API.
 *
 * Classifies assets by extension:
 *   .dmg  → macOS
 *   .msi / .exe → Windows
 *
 * On any fetch failure, non-ok response, or parse error returns
 * `{ available: false }` so the dashboard still renders without download stats.
 * NEVER throws.
 */
export async function loadDesktopDownloads(): Promise<DesktopDownloads> {
  try {
    const res = await fetch(
      'https://api.github.com/repos/johnnwilliams27/nibbin-desktop/releases?per_page=20',
      {
        next: { revalidate: 600 },
        headers: { Accept: 'application/vnd.github+json' },
      },
    );
    if (!res.ok) return { available: false };

    const json: unknown = await res.json();
    if (!Array.isArray(json)) return { available: false };

    const byPlatform: DesktopDownloadsByPlatform = { macos: 0, windows: 0 };
    const releases: DesktopReleaseRow[] = [];

    for (const entry of json) {
      if (!isGhRelease(entry)) return { available: false };
      let releaseTotal = 0;
      for (const asset of entry.assets) {
        const name = asset.name.toLowerCase();
        const count = asset.download_count;
        if (name.endsWith('.dmg')) {
          byPlatform.macos += count;
        } else if (name.endsWith('.msi') || name.endsWith('.exe')) {
          byPlatform.windows += count;
        }
        releaseTotal += count;
      }
      releases.push({ tag: entry.tag_name, total: releaseTotal });
    }

    return { available: true, byPlatform, releases };
  } catch {
    return { available: false };
  }
}
