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
import { dueScheduleOccurrences, seedCandidateNibbins, triggerNibbinRun } from '../../../../lib/runtime/engine';
import { SupabaseTrainingStore } from '../../../../lib/runtime/stores';
import { SCHEDULE_DEFS, nextOccurrence } from '../../../../lib/runtime/schedule';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Cost/fairness bounds (design §"The cron route"). */
/** Max DUE (nibbin, schedule_key) rows claimed per tick (due-first scan cap). */
export const DUE_SCAN_LIMIT = 200;
/** Max never-before-seen scheduled nibbins discovered + seeded per tick. */
export const SEED_DISCOVERY_LIMIT = 200;
export const MAX_LAUNCHES_PER_TICK = 100;
const FALLBACK_TZ = 'UTC';

/** The persisted (nibbin, schedule_key) due-state, mirroring `nibbin_schedule_state`. */
export interface ScheduleStateRow {
  nibbinId: string;
  scheduleKey: string;
  nextRunAt: Date;
}

/**
 * A DUE occurrence: a `nibbin_schedule_state` row (next_run_at <= now) joined to
 * its active nibbin. The due-first scan returns these ordered by `next_run_at`
 * ASC (oldest-due first), so coverage is fair and no nibbin with a due
 * occurrence is permanently starved behind a 200-row created_at window.
 */
export interface DueOccurrence {
  nibbin: NibbinRef;
  scheduleKey: string;
}

/**
 * The injectable seam. The route wires the Supabase-backed implementations; the
 * tests inject fakes so `runScheduleTick` is exercised WITHOUT a live DB/HTTP.
 * Every method that could fail does so per-nibbin inside a try/catch in the loop
 * — a load/claim error for one nibbin must NEVER fire it (fail-closed).
 */
export interface ScheduleTickDeps {
  /**
   * Claim phase — DUE-FIRST. All due occurrences (`next_run_at <= now`) joined
   * to their active nibbin, ordered by `next_run_at` ASC and bounded by
   * `DUE_SCAN_LIMIT`. Uses the `nibbin_schedule_state_next_run_idx` index so the
   * scan stays cheap and FAIR — no scheduled nibbin is permanently starved
   * behind a created_at window (the old `.eq(status).order(created_at).limit`
   * pre-limit bug). Returns at most `DUE_SCAN_LIMIT` rows; the route surfaces
   * `scanCapped` when exactly that many come back (more due work exists).
   */
  loadDueOccurrences: (now: Date, limit: number) => Promise<DueOccurrence[]>;
  /**
   * Seed phase — bounded DISCOVERY. Active nibbins carrying a recognized
   * `schedule` trigger that LACK any `nibbin_schedule_state` row, ordered
   * newest-first so brand-new nibbins are seeded promptly (a delayed seed is
   * benign — the nibbin enters the fair claim phase a tick later). Bounded by
   * `SEED_DISCOVERY_LIMIT`; the route surfaces `seedCapped` at the limit.
   */
  loadSeedCandidates: (limit: number) => Promise<NibbinRef[]>;
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
  /** Distinct nibbins considered this tick (due claims ∪ seed candidates). */
  scanned: number;
  fired: number;
  sampled: number;
  deferred: number;
  errors: string[];
  /** Per-tick launch cap hit (some due rows deferred to next tick). */
  capped: boolean;
  /** The due-first claim scan returned its full LIMIT — more due work exists. */
  scanCapped: boolean;
  /** The seed-discovery scan returned its full LIMIT — more new nibbins exist. */
  seedCapped: boolean;
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
  let scanCapped = false;
  let seedCapped = false;

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

  // Every nibbin we touch this tick — the training pass iterates this union, and
  // `firedBase` records which ones already launched a base run (FIX 3: never
  // double-spend a training budget unit on a nibbin that base-fired this tick;
  // its sampled run would only hit the runner's cooldown after the unit is
  // already consumed).
  const consideredById = new Map<string, NibbinRef>();
  const firedBase = new Set<string>();

  // ── Claim phase — DUE-FIRST (uses the next_run_at index) ──────────────────
  let due: DueOccurrence[] = [];
  try {
    due = await deps.loadDueOccurrences(now, DUE_SCAN_LIMIT);
    if (due.length >= DUE_SCAN_LIMIT) scanCapped = true;
  } catch (e) {
    errors.push(`loadDueOccurrences: ${(e as Error).message}`);
  }

  for (const { nibbin, scheduleKey: key } of due) {
    consideredById.set(nibbin.id, nibbin);
    if (!SCHEDULE_DEFS[key]) continue; // unrecognized key — skip, never throw
    try {
      const tz = await tzFor(nibbin.accountId);
      const next = nextOccurrence(key, tz, now);
      if (!next) continue;

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
      firedBase.add(nibbin.id);
    } catch (e) {
      errors.push(`${nibbin.id}/${key}: ${(e as Error).message}`);
    }
  }

  // ── Seed phase — bounded discovery of never-seen scheduled nibbins ────────
  let seedCandidates: NibbinRef[] = [];
  try {
    seedCandidates = await deps.loadSeedCandidates(SEED_DISCOVERY_LIMIT);
    if (seedCandidates.length >= SEED_DISCOVERY_LIMIT) seedCapped = true;
  } catch (e) {
    errors.push(`loadSeedCandidates: ${(e as Error).message}`);
  }

  for (const nibbin of seedCandidates) {
    consideredById.set(nibbin.id, nibbin);
    const keys = scheduleKeysOf(nibbin);
    if (keys.length === 0) continue;
    let tz: string;
    try {
      tz = await tzFor(nibbin.accountId);
    } catch {
      tz = FALLBACK_TZ;
    }
    for (const key of keys) {
      try {
        const next = nextOccurrence(key, tz, now);
        if (!next) continue;
        // First sight: seed a FUTURE occurrence; adoption already did a first
        // run, and the next tick's claim phase picks it up fairly when due.
        await deps.seed(nibbin, key, next);
      } catch (e) {
        errors.push(`${nibbin.id}/${key}: ${(e as Error).message}`);
      }
    }
  }

  const scanned = consideredById.size;

  // ── Training sampling (≤1 extra per nibbin per tick, consume-then-fire) ───
  // Sampling is best-effort EXTRA cadence over the nibbins seen this tick: once
  // the per-tick cap is reached we stop. We do NOT count skipped samples as
  // `deferred` (only un-launched DUE base rows are owed a next-tick fire; a
  // skipped sample just resamples next tick if still open). FIX 3: a nibbin that
  // base-fired this tick is SKIPPED — sampling it would consume a budget unit
  // and then bounce off the runner's per-nibbin cooldown (wasted unit).
  for (const nibbin of consideredById.values()) {
    if (!launchesLeft()) {
      capped = true;
      break;
    }
    if (firedBase.has(nibbin.id)) continue; // already base-fired this tick — don't waste a unit
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

  return { scanned, fired, sampled, deferred, errors, capped, scanCapped, seedCapped };
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
    loadDueOccurrences: (now, limit) => dueScheduleOccurrences(svc, now, limit),
    loadSeedCandidates: (limit) => seedCandidateNibbins(svc, limit),
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
  if (result.scanCapped) {
    console.warn(`[nibbin-schedule] due-scan cap (${DUE_SCAN_LIMIT}) hit: more due occurrences exist — they claim next tick (oldest-due first)`);
  }
  if (result.seedCapped) {
    console.warn(`[nibbin-schedule] seed-discovery cap (${SEED_DISCOVERY_LIMIT}) hit: more new scheduled nibbins exist — seeded over subsequent ticks`);
  }
  const { scanned, fired, sampled, deferred, errors, scanCapped, seedCapped } = result;
  return NextResponse.json({ scanned, fired, sampled, deferred, errors, scanCapped, seedCapped });
}
