/**
 * Analytics read-layer tests.
 *
 * Asserts: overview shape guard accepts valid rows and rejects drifted shapes;
 * daily rows validate each entry; loadDesktopDownloads sums by platform and
 * soft-fails on fetch rejection or non-ok response; approvalRate is null-safe.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  isAnalyticsOverview,
  approvalRate,
  loadAnalyticsOverview,
  loadAnalyticsDaily,
  loadDesktopDownloads,
  type AnalyticsOverview,
  type AnalyticsDay,
} from './read';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FULL_OVERVIEW: AnalyticsOverview = {
  waitlist_total: 1000,
  waitlist_confirmed: 800,
  accounts_total: 500,
  accounts_7d: 12,
  accounts_30d: 45,
  active_1d: 80,
  active_7d: 200,
  active_30d: 350,
  runs_total: 9000,
  runs_30d: 1200,
  decided_30d: 400,
  approved_unedited_30d: 300,
  edited_30d: 70,
  rejected_30d: 30,
  nibbins_total: 600,
  nibbins_egg: 120,
  nibbins_student: 200,
  nibbins_senior: 180,
  nibbins_grad: 100,
};

const FULL_DAY: AnalyticsDay = {
  day: '2026-06-01',
  accounts_created: 5,
  runs: 150,
  approvals: 40,
  active_accounts: 90,
};

// ---------------------------------------------------------------------------
// isAnalyticsOverview — shape guard
// ---------------------------------------------------------------------------

describe('isAnalyticsOverview — shape guard', () => {
  it('accepts a fully valid overview row', () => {
    expect(isAnalyticsOverview(FULL_OVERVIEW)).toBe(true);
  });

  it('rejects null', () => {
    expect(isAnalyticsOverview(null)).toBe(false);
  });

  it('rejects a non-object', () => {
    expect(isAnalyticsOverview('string')).toBe(false);
    expect(isAnalyticsOverview(42)).toBe(false);
  });

  it('rejects a row with a missing numeric column (drift)', () => {
    const drifted = { ...FULL_OVERVIEW } as Record<string, unknown>;
    delete drifted.decided_30d;
    expect(isAnalyticsOverview(drifted)).toBe(false);
  });

  it('rejects a row where a numeric column is NaN', () => {
    const drifted = { ...FULL_OVERVIEW, runs_30d: NaN };
    expect(isAnalyticsOverview(drifted)).toBe(false);
  });

  it('rejects a row where a numeric column is Infinity', () => {
    const drifted = { ...FULL_OVERVIEW, active_1d: Infinity };
    expect(isAnalyticsOverview(drifted)).toBe(false);
  });

  it('rejects a row where a numeric column is a string', () => {
    const drifted = { ...FULL_OVERVIEW, accounts_total: '500' };
    expect(isAnalyticsOverview(drifted)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// approvalRate — null-safe derived rate
// ---------------------------------------------------------------------------

describe('approvalRate', () => {
  it('returns approved_unedited_30d / decided_30d', () => {
    const r = approvalRate(FULL_OVERVIEW);
    expect(r).toBeCloseTo(300 / 400);
  });

  it('returns null when decided_30d is 0 (no divide-by-zero)', () => {
    const noDecided: AnalyticsOverview = { ...FULL_OVERVIEW, decided_30d: 0, approved_unedited_30d: 0 };
    expect(approvalRate(noDecided)).toBeNull();
  });

  it('returns 1.0 when all decisions were approved unedited', () => {
    const perfect: AnalyticsOverview = {
      ...FULL_OVERVIEW,
      decided_30d: 100,
      approved_unedited_30d: 100,
    };
    expect(approvalRate(perfect)).toBeCloseTo(1.0);
  });
});

// ---------------------------------------------------------------------------
// loadAnalyticsOverview — RPC integration
// ---------------------------------------------------------------------------

describe('loadAnalyticsOverview — service_role RPC read', () => {
  it('returns the mapped overview row when RPC succeeds', async () => {
    const admin = {
      rpc: async () => ({ data: [FULL_OVERVIEW], error: null }),
    } as unknown as SupabaseClient;
    const result = await loadAnalyticsOverview(admin);
    expect(result.accounts_total).toBe(500);
    expect(result.runs_30d).toBe(1200);
  });

  it('also handles RPC returning a single object (non-array)', async () => {
    const admin = {
      rpc: async () => ({ data: FULL_OVERVIEW, error: null }),
    } as unknown as SupabaseClient;
    const result = await loadAnalyticsOverview(admin);
    expect(result.waitlist_total).toBe(1000);
  });

  it('throws when the RPC returns an error', async () => {
    const admin = {
      rpc: async () => ({ data: null, error: { message: 'permission denied for function analytics_overview' } }),
    } as unknown as SupabaseClient;
    await expect(loadAnalyticsOverview(admin)).rejects.toThrow(/analytics_overview failed/);
  });

  it('throws when the RPC returns no rows', async () => {
    const admin = {
      rpc: async () => ({ data: [], error: null }),
    } as unknown as SupabaseClient;
    await expect(loadAnalyticsOverview(admin)).rejects.toThrow(/analytics_overview returned no rows/);
  });

  it('throws on a drifted RPC row shape', async () => {
    const drifted = { ...FULL_OVERVIEW } as Record<string, unknown>;
    delete drifted.nibbins_grad;
    const admin = {
      rpc: async () => ({ data: [drifted], error: null }),
    } as unknown as SupabaseClient;
    await expect(loadAnalyticsOverview(admin)).rejects.toThrow(/unexpected row shape/);
  });
});

// ---------------------------------------------------------------------------
// loadAnalyticsDaily — RPC integration
// ---------------------------------------------------------------------------

describe('loadAnalyticsDaily — service_role RPC read', () => {
  it('returns mapped daily rows', async () => {
    const day2: AnalyticsDay = { ...FULL_DAY, day: '2026-06-02', runs: 200 };
    const admin = {
      rpc: async () => ({ data: [FULL_DAY, day2], error: null }),
    } as unknown as SupabaseClient;
    const rows = await loadAnalyticsDaily(admin);
    expect(rows).toHaveLength(2);
    expect(rows[0].day).toBe('2026-06-01');
    expect(rows[1].runs).toBe(200);
  });

  it('passes p_days to the RPC', async () => {
    const calls: unknown[] = [];
    const admin = {
      rpc: async (_fn: string, args: unknown) => {
        calls.push(args);
        return { data: [], error: null };
      },
    } as unknown as SupabaseClient;
    await loadAnalyticsDaily(admin, 7);
    expect(calls[0]).toEqual({ p_days: 7 });
  });

  it('returns empty array when RPC returns no rows', async () => {
    const admin = {
      rpc: async () => ({ data: [], error: null }),
    } as unknown as SupabaseClient;
    await expect(loadAnalyticsDaily(admin)).resolves.toEqual([]);
  });

  it('throws when the RPC returns an error', async () => {
    const admin = {
      rpc: async () => ({ data: null, error: { message: 'permission denied for function analytics_daily' } }),
    } as unknown as SupabaseClient;
    await expect(loadAnalyticsDaily(admin)).rejects.toThrow(/analytics_daily failed/);
  });

  it('throws on a drifted row shape (missing day string)', async () => {
    const drifted = { ...FULL_DAY } as Record<string, unknown>;
    delete drifted.day;
    const admin = {
      rpc: async () => ({ data: [drifted], error: null }),
    } as unknown as SupabaseClient;
    await expect(loadAnalyticsDaily(admin)).rejects.toThrow(/unexpected row shape/);
  });

  it('throws on a drifted row shape (numeric column missing)', async () => {
    const drifted = { ...FULL_DAY } as Record<string, unknown>;
    delete drifted.active_accounts;
    const admin = {
      rpc: async () => ({ data: [drifted], error: null }),
    } as unknown as SupabaseClient;
    await expect(loadAnalyticsDaily(admin)).rejects.toThrow(/unexpected row shape/);
  });
});

// ---------------------------------------------------------------------------
// loadDesktopDownloads — GitHub Releases fetch (mocked)
// ---------------------------------------------------------------------------

const MOCK_RELEASES = [
  {
    tag_name: 'desktop-v0.2.0',
    assets: [
      { name: 'Nibbin_0.2.0_x64.dmg', download_count: 120 },
      { name: 'Nibbin_0.2.0_x64_en-US.msi', download_count: 80 },
      { name: 'Nibbin_0.2.0_x64-setup.exe', download_count: 50 },
    ],
  },
  {
    tag_name: 'desktop-v0.1.0',
    assets: [
      { name: 'Nibbin_0.1.0_x64.dmg', download_count: 40 },
      { name: 'Nibbin_0.1.0_x64_en-US.msi', download_count: 20 },
    ],
  },
];

afterEach(() => {
  vi.restoreAllMocks();
});

describe('loadDesktopDownloads — GitHub API fetch', () => {
  it('sums download counts by platform across releases', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => MOCK_RELEASES,
      }),
    );
    const result = await loadDesktopDownloads();
    expect(result.available).toBe(true);
    if (!result.available) throw new Error('expected available');
    // macOS: 120 + 40 = 160
    expect(result.byPlatform.macos).toBe(160);
    // Windows: 80 + 50 + 20 = 150
    expect(result.byPlatform.windows).toBe(150);
  });

  it('returns per-release totals', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => MOCK_RELEASES,
      }),
    );
    const result = await loadDesktopDownloads();
    expect(result.available).toBe(true);
    if (!result.available) throw new Error('expected available');
    expect(result.releases).toHaveLength(2);
    // desktop-v0.2.0: 120 + 80 + 50 = 250
    expect(result.releases[0]).toEqual({ tag: 'desktop-v0.2.0', total: 250 });
    // desktop-v0.1.0: 40 + 20 = 60
    expect(result.releases[1]).toEqual({ tag: 'desktop-v0.1.0', total: 60 });
  });

  it('returns { available: false } when fetch rejects (network error)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));
    const result = await loadDesktopDownloads();
    expect(result.available).toBe(false);
  });

  it('returns { available: false } when response is not ok (e.g. 403)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 403 }),
    );
    const result = await loadDesktopDownloads();
    expect(result.available).toBe(false);
  });

  it('returns { available: false } when response body is not an array', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ message: 'Not Found' }),
      }),
    );
    const result = await loadDesktopDownloads();
    expect(result.available).toBe(false);
  });

  it('returns { available: false } when a release entry fails shape guard', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        // tag_name missing → isGhRelease returns false
        json: async () => [{ assets: [] }],
      }),
    );
    const result = await loadDesktopDownloads();
    expect(result.available).toBe(false);
  });

  it('returns empty byPlatform totals when there are no releases', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [],
      }),
    );
    const result = await loadDesktopDownloads();
    expect(result.available).toBe(true);
    if (!result.available) throw new Error('expected available');
    expect(result.byPlatform.macos).toBe(0);
    expect(result.byPlatform.windows).toBe(0);
    expect(result.releases).toHaveLength(0);
  });
});
