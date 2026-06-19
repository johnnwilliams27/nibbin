import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import {
  trainingSampleDecision,
  type NibbinRef,
  type RunOutcome,
  type RunTrigger,
  type TrainingWindow,
} from '@nibbin/runtime';
import { serviceClient } from '../../../../lib/supabase/service';
import { isAuthorizedCronRequest } from '../../../../lib/connections/cron-auth';
import { activeScheduledNibbins, triggerNibbinRun } from '../../../../lib/runtime/engine';
import { SupabaseTrainingStore } from '../../../../lib/runtime/stores';
import { SCHEDULE_DEFS, nextOccurrence } from '../../../../lib/runtime/schedule';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Cost/fairness bounds (design §"The cron route"). */
export const NIBBIN_BATCH_LIMIT = 200;
export const MAX_LAUNCHES_PER_TICK = 100;
const FALLBACK_TZ = 'UTC';

/** The persisted (nibbin, schedule_key) due-state, mirroring `nibbin_schedule_state`. */
export interface ScheduleStateRow {
  nibbinId: string;
  scheduleKey: string;
  nextRunAt: Date;
}

/**
 * The injectable seam. The route wires the Supabase-backed implementations; the
 * tests inject fakes so `runScheduleTick` is exercised WITHOUT a live DB/HTTP.
 * Every method that could fail does so per-nibbin inside a try/catch in the loop
 * — a load/claim error for one nibbin must NEVER fire it (fail-closed).
 */
export interface ScheduleTickDeps {
  /** Active nibbins (cross-account), already bounded by NIBBIN_BATCH_LIMIT. */
  loadNibbins: () => Promise<NibbinRef[]>;
  /** All schedule-state rows for the loaded nibbins (batch). */
  loadStateRows: (nibbinIds: string[]) => Promise<ScheduleStateRow[]>;
  /** Resolve an account's IANA zone (owner's users.tz), 'UTC' fallback. Cached per tick by the route. */
  resolveTz: (accountId: string) => Promise<string>;
  /** Seed a FUTURE occurrence (insert … on conflict do nothing). Never fires. */
  seed: (nibbin: NibbinRef, scheduleKey: string, nextRunAt: Date) => Promise<void>;
  /** Conditional claim: advance next_run_at iff still due; returns true iff THIS call claimed. */
  claimAndAdvance: (nibbinId: string, scheduleKey: string, now: Date, nextRunAt: Date) => Promise<boolean>;
  /** Run one nibbin through the unchanged (School-gated) runner. */
  triggerRun: (nibbinId: string, trigger: RunTrigger) => Promise<RunOutcome>;
  /** The single OPEN training window for this nibbin, or null. */
  trainingActiveWindow: (accountId: string, nibbinId: string, nowMs: number) => Promise<TrainingWindow | null>;
  /** Consume one training budget unit. Returns the next window; consumed iff runsUsed advanced. */
  recordSample: (window: TrainingWindow, nowMs: number) => Promise<TrainingWindow>;
  now: () => Date;
}

export interface ScheduleTickResult {
  scanned: number;
  fired: number;
  sampled: number;
  deferred: number;
  errors: string[];
  capped: boolean;
}

/** The schedule keys a spec's triggers ask for, that we actually understand. */
function scheduleKeysOf(nibbin: NibbinRef): string[] {
  const keys: string[] = [];
  for (const t of nibbin.spec.triggers) {
    if (t.kind !== 'schedule') continue;
    const key = t.schedule;
    if (key && SCHEDULE_DEFS[key] && !keys.includes(key)) keys.push(key);
  }
  return keys;
}

/**
 * One scheduler tick — the pure-ish core (design §"Per invocation"). Decides
 * ONLY when to launch; every launch rides the unchanged School-gated runner.
 *
 * Exactly-once per occurrence: a fire happens only on a POSITIVE
 * `claimAndAdvance` (a second concurrent tick's conditional update matches 0
 * rows → false → no fire). Freshly-seeded rows are FUTURE-dated, so they are
 * not due this tick. Training adds at most ONE extra sampled run per nibbin,
 * and only when `recordSample` actually consumed a unit (consume-then-fire).
 */
export async function runScheduleTick(deps: ScheduleTickDeps): Promise<ScheduleTickResult> {
  const now = deps.now();
  const errors: string[] = [];
  let fired = 0;
  let sampled = 0;
  let deferred = 0;
  let capped = false;

  let nibbins: NibbinRef[];
  try {
    nibbins = await deps.loadNibbins();
  } catch (e) {
    return { scanned: 0, fired: 0, sampled: 0, deferred: 0, errors: [`loadNibbins: ${(e as Error).message}`], capped: false };
  }
  // Keep only nibbins that actually carry a recognized schedule trigger.
  const scheduled = nibbins.filter((n) => scheduleKeysOf(n).length > 0);
  const scanned = scheduled.length;

  // Batch-load state once. A load failure here is fail-closed: with no state we
  // cannot claim, so we only seed (never fire) and try again next tick.
  let stateByKey = new Map<string, ScheduleStateRow>();
  try {
    const rows = await deps.loadStateRows(scheduled.map((n) => n.id));
    stateByKey = new Map(rows.map((r) => [`${r.nibbinId}|${r.scheduleKey}`, r]));
  } catch (e) {
    errors.push(`loadStateRows: ${(e as Error).message}`);
  }

  // Resolve each account's tz once per tick.
  const tzCache = new Map<string, string>();
  const tzFor = async (accountId: string): Promise<string> => {
    const hit = tzCache.get(accountId);
    if (hit !== undefined) return hit;
    let tz = FALLBACK_TZ;
    try {
      tz = (await deps.resolveTz(accountId)) || FALLBACK_TZ;
    } catch {
      tz = FALLBACK_TZ; // fail-safe: a tz lookup error must not abort scheduling
    }
    tzCache.set(accountId, tz);
    return tz;
  };

  const launchesLeft = (): boolean => fired + sampled < MAX_LAUNCHES_PER_TICK;

  // ── Base cadence ────────────────────────────────────────────────────────
  for (const nibbin of scheduled) {
    let tz: string;
    try {
      tz = await tzFor(nibbin.accountId);
    } catch {
      tz = FALLBACK_TZ;
    }
    for (const key of scheduleKeysOf(nibbin)) {
      try {
        const next = nextOccurrence(key, tz, now);
        if (!next) continue; // unknown/unsupported key — skip, never throw
        const state = stateByKey.get(`${nibbin.id}|${key}`);

        if (!state) {
          // First sight: seed a FUTURE occurrence; adoption already did a first run.
          await deps.seed(nibbin, key, next);
          continue;
        }

        if (state.nextRunAt.getTime() > now.getTime()) continue; // not due

        if (!launchesLeft()) {
          // Cap hit: do NOT claim (leaving the row due) so it fires next tick.
          deferred += 1;
          capped = true;
          continue;
        }

        const claimed = await deps.claimAndAdvance(nibbin.id, key, now, next);
        if (!claimed) continue; // a concurrent tick won the claim — exactly-once

        await deps.triggerRun(nibbin.id, { kind: 'schedule', key });
        fired += 1;
      } catch (e) {
        errors.push(`${nibbin.id}/${key}: ${(e as Error).message}`);
      }
    }
  }

  // ── Training sampling (≤1 extra per nibbin per tick, consume-then-fire) ───
  // Sampling is best-effort EXTRA cadence: once the per-tick cap is reached we
  // simply stop sampling. We do NOT count skipped samples as `deferred` (only
  // un-launched DUE base rows are owed a next-tick fire; a skipped sample is
  // not — it would just resample next tick if still open).
  for (const nibbin of scheduled) {
    if (!launchesLeft()) {
      capped = true;
      break;
    }
    try {
      const window = await deps.trainingActiveWindow(nibbin.accountId, nibbin.id, now.getTime());
      if (!window) continue;
      // Cheap read-only pre-check (skips egg/inactive without spending budget).
      const decision = trainingSampleDecision(window, nibbin.stage, now.getTime());
      if (!decision.sample) continue;
      // Atomic consume. Fire ONLY if a unit was actually consumed (runsUsed
      // advanced); a closed/exhausted window leaves runsUsed unchanged → no fire.
      const after = await deps.recordSample(window, now.getTime());
      if (after.runsUsed <= window.runsUsed) continue;
      await deps.triggerRun(nibbin.id, { kind: 'schedule', key: 'training.sample' });
      sampled += 1;
    } catch (e) {
      errors.push(`${nibbin.id}/training: ${(e as Error).message}`);
    }
  }

  return { scanned, fired, sampled, deferred, errors, capped };
}

/** Resolve an account's IANA zone from the owner membership's users.tz. */
async function resolveAccountTz(
  svc: ReturnType<typeof serviceClient>,
  accountId: string,
): Promise<string> {
  const { data } = await svc
    .from('memberships')
    .select('users!inner(tz)')
    .eq('account_id', accountId)
    .eq('role', 'owner')
    .limit(1)
    .maybeSingle();
  const u = data?.users as { tz: string | null } | { tz: string | null }[] | undefined;
  const row = Array.isArray(u) ? u[0] : u;
  return row?.tz || FALLBACK_TZ;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const svc = serviceClient();
  const trainingStore = new SupabaseTrainingStore(svc);

  const deps: ScheduleTickDeps = {
    loadNibbins: () => activeScheduledNibbins(svc, NIBBIN_BATCH_LIMIT),
    loadStateRows: async (nibbinIds) => {
      if (nibbinIds.length === 0) return [];
      const { data, error } = await svc
        .from('nibbin_schedule_state')
        .select('nibbin_id, schedule_key, next_run_at')
        .in('nibbin_id', nibbinIds);
      if (error) throw new Error(error.message);
      return (data ?? []).map((r) => ({
        nibbinId: r.nibbin_id as string,
        scheduleKey: r.schedule_key as string,
        nextRunAt: new Date(r.next_run_at as string),
      }));
    },
    resolveTz: (accountId) => resolveAccountTz(svc, accountId),
    seed: async (nibbin, scheduleKey, nextRunAt) => {
      const { error } = await svc.rpc('schedule_seed', {
        p_nibbin: nibbin.id,
        p_account: nibbin.accountId,
        p_schedule_key: scheduleKey,
        p_next_run_at: nextRunAt.toISOString(),
      });
      if (error) throw new Error(error.message);
    },
    claimAndAdvance: async (nibbinId, scheduleKey, now, nextRunAt) => {
      const { data, error } = await svc.rpc('schedule_claim_and_advance', {
        p_nibbin: nibbinId,
        p_schedule_key: scheduleKey,
        p_now: now.toISOString(),
        p_next_run_at: nextRunAt.toISOString(),
      });
      if (error) throw new Error(error.message);
      return data === true;
    },
    triggerRun: (nibbinId, trigger) => triggerNibbinRun(nibbinId, trigger),
    trainingActiveWindow: (accountId, nibbinId, nowMs) => trainingStore.active(accountId, nibbinId, nowMs),
    recordSample: (window, nowMs) => trainingStore.recordSample(window, nowMs),
    now: () => new Date(),
  };

  const result = await runScheduleTick(deps);
  if (result.capped) {
    console.warn(`[nibbin-schedule] per-tick launch cap hit: ${result.deferred} deferred to next tick`);
  }
  const { scanned, fired, sampled, deferred, errors } = result;
  return NextResponse.json({ scanned, fired, sampled, deferred, errors });
}
