/**
 * Credit ledger math — SPEC §6.2 (weighted units), §6.4 (tiers & top-ups).
 *
 * The ledger is append-only; balances are always derived from entry deltas,
 * never stored and mutated (docs/INVARIANTS.md). Everything here is pure —
 * persistence and RLS live in the Supabase migrations that land next.
 *
 * Concurrency contract: `validateAppend(entries, entry)` must run against the
 * CURRENT ledger inside the same transaction that appends the entry, with
 * per-account serialization (e.g. `SELECT ... FOR UPDATE` on the account row).
 * `canRun`/`tryCharge` against a stale snapshot are advisory; validateAppend
 * is the authority that keeps run charges from overdrawing and refunds/grants
 * from double-applying.
 *
 * LedgerEntry mirrors the SPEC §6.1 `credit_ledger` sketch (delta,
 * weighted_units, reason, run_id). `sourceId` is the dedupe key the schema
 * must carry (billing period / Stripe event for grants; reversed payment for
 * clawbacks) — reconcile deliberately in the migrations PR. `account_id`
 * scoping is the caller's job: every function here assumes `entries` is one
 * account's complete ledger.
 *
 * Clawback policy: clawbacks (chargebacks, gift-card-law expiry reversals)
 * may drive a balance negative; `canRun` then blocks all further spend until
 * top-up/grant restores it. Never silent — surface it in the meter.
 */

export const WEIGHTS = {
  standard: 1,
  frontier: 3,
  computer_use: 10,
} as const;

export type WeightClass = keyof typeof WEIGHTS;

export const TIERS = {
  hatchling: { priceUsdCents: 0, monthlyCredits: 100, maxNibbins: 2 as number | null, topUpsAllowed: false },
  grove: { priceUsdCents: 2900, monthlyCredits: 1000, maxNibbins: 5 as number | null, topUpsAllowed: false },
  canopy: { priceUsdCents: 7900, monthlyCredits: 5000, maxNibbins: null as number | null, topUpsAllowed: true },
} as const;

export type Tier = keyof typeof TIERS;

/**
 * Founder decision 2026-06-12 (docs/tasks/M6.5-model-bringup.md): $10 per
 * 1,000 credits — matches Lindy's overage rate and prices above the Canopy
 * plan rate per industry norm; the $5/1,000 it replaces was under water at
 * T1 model prices. MUST agree with the live Stripe price behind
 * STRIPE_PRICE_TOPUP — the webhook grants `credits` per unit purchased
 * while Stripe charges the price object's amount.
 */
export const TOP_UP = { priceUsdCents: 1000, credits: 1000 } as const;

/**
 * Anti-runaway daily chat-turn ceiling per plan (#230). A SAFETY backstop on
 * the WEB IN-APP Grovekeeper chat surface, which otherwise had no per-user cap
 * on cheap T0/T1 turns. Every web chat turn (T0/T1/T2) counts. NOT a credit
 * meter: hitting it politely pauses chat for the UTC day and never debits
 * run-credits (so it respects the credits people paid for). Generous enough
 * that no human reaches it (a heavy onboarding day is ~100-200 turns); it only
 * stops runaway client loops / abuse. Scaled by plan so paying users get more
 * headroom. The router enforces it atomically (the 'chat_total' frontier_budget
 * counter); the web caller passes the number.
 *
 * SCOPE: this governs WEB chat only. Channel chat (Telegram/SMS) runs through
 * the same keeperChat but is bounded by its OWN, stronger guard — the channel
 * turn/dollar spend cap + anomaly auto-pause (packages/channels gateTurn) — so
 * it deliberately does NOT pass this ceiling (different scope: per-account/
 * channel dollars vs per-user/day web turns).
 */
export const CHAT_DAILY_CEILING: Record<Tier, number> = {
  hatchling: 150,
  grove: 500,
  canopy: 2000,
} as const;

/**
 * Anti-runaway DOLLAR backstop for a SINGLE diagnosis-synthesis call, in
 * micro-USD: 1_000_000 = $1.00. The diagnosis pipeline is the deliberate T2
 * Opus splurge the router never degrades, so the caller-side controls ARE the
 * budget. The PRIMARY bound is the input cap below (we truncate the packet so
 * the call can never get expensive); this dollar figure is a log-only tripwire
 * for pricing/usage drift — it does NOT fail a study (a real diagnosis is
 * ~$0.06 output + capped input, so it should never fire).
 */
export const DIAGNOSIS_MAX_MICRO_USD = 1_000_000 as const;

/**
 * PRIMARY cost bound: cap the diagnosis packet at this many INPUT tokens. When a
 * rich study would exceed it we TRUNCATE the packet (drop the overflow sections)
 * rather than fail the study — the user still gets a diagnosis on what fits, and
 * cost is deterministically bounded (input ≤ 100k → ~$0.50 at $5/MTok, plus the
 * fixed 2,500-token output). Never reject a study for being too big.
 */
export const DIAGNOSIS_MAX_INPUT_TOKENS = 100_000 as const;

/**
 * Usage-metering conversion (feat/credit-metering-usage). ONE place defines the
 * dollar value of a credit; everything else derives from it.
 *
 * CHOSEN RATE: 1 credit = $0.01 USD (10,000 micro-USD). This is deliberately
 * anchored to the EXISTING top-up economics — TOP_UP is $10 (1000¢) for 1,000
 * credits = $0.01/credit — so a credit a user BUYS is worth the same amount of
 * usage it costs (no second, conflicting price to drift).
 *
 * SIZING THE FREE GRANT against real recorded COGS (nibbin-prod model_calls,
 * 2026-06-24): a chat turn ≈ 950 µUSD, onboarding ≈ 805 µUSD, a plan synthesis
 * (a run) ≈ 4,100 µUSD. With ceil(cost / 10,000):
 *   - a typical chat turn / onboarding call → ceil(0.095) = 1 credit
 *   - a plan synthesis call                 → ceil(0.41)  = 1 credit
 *   - the heaviest real account so far (8 calls, 23,227 µUSD total) → ~3 credits
 * So the 5,000-credit Canopy grant (= $50 of usage) comfortably covers thousands
 * of normal calls; even the 1,000-credit Grove grant covers ~1,000 calls and the
 * 100-credit Hatchling grant ~100. A normal session (dozens of chat turns + a
 * few runs) spends a tiny fraction. Generous by design — results reliably post.
 *
 * TUNING: change only this constant. Raising it (more µUSD per credit) makes
 * credits cheaper to spend / the free tier MORE generous; lowering it charges
 * more credits per call. The minimum effective charge is 1 credit for any call
 * costing > 0 (the ceil floor); a call rounding to 0 is free — that's fine.
 */
export const USD_PER_CREDIT = 0.01 as const;
/** Same rate expressed in micro-USD (integer math) — 1 credit = 10,000 µUSD. */
export const MICRO_USD_PER_CREDIT = 10_000 as const;

/**
 * Credits charged for one model call's recorded COGS. `ceil` so any non-free
 * call costs at least 1 credit; a near-free call (cost rounds below the rate)
 * costs 0 and is not charged. Fail-safe on garbage input → 0 (never charge for
 * a non-finite/negative cost; the COGS row still records, billing just skips).
 */
export function creditsForCostMicroUsd(costMicroUsd: number): number {
  if (!Number.isFinite(costMicroUsd) || costMicroUsd <= 0) return 0;
  return Math.ceil(costMicroUsd / MICRO_USD_PER_CREDIT);
}

/** Rough token estimate for budgeting (≈4 chars/token). Deliberately simple. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * True when a recorded/projected per-diagnosis cost is within the hard cap.
 * Pure + side-effect-free so it can guard either a projection (before spend)
 * or a recorded usage (after spend). A non-finite or negative cost is treated
 * as over-cap (fail-closed).
 */
export function withinDiagnosisCostCap(costMicroUsd: number): boolean {
  if (!Number.isFinite(costMicroUsd) || costMicroUsd < 0) return false;
  return costMicroUsd <= DIAGNOSIS_MAX_MICRO_USD;
}

const GRANT_AMOUNTS: ReadonlySet<number> = new Set(
  Object.values(TIERS).map((t) => t.monthlyCredits),
);

export type LedgerReason = 'run' | 'topup' | 'grant' | 'refund' | 'clawback' | 'usage' | 'refill';

export interface LedgerEntry {
  /** Signed weighted units. Debits negative, credits positive. Always a safe integer. */
  delta: number;
  reason: LedgerReason;
  /** Required for 'run' and 'refund' — refunds must reference the charge they reverse. */
  runId?: string;
  /** Idempotency/linkage key. Required for 'grant' (billing period or Stripe event id). */
  sourceId?: string;
}

function assertPositiveInt(n: number, what: string): void {
  if (!Number.isSafeInteger(n) || n <= 0) {
    throw new RangeError(`${what} must be a positive integer, got ${n}`);
  }
}

function assertId(id: string | undefined, what: string): asserts id is string {
  if (typeof id !== 'string' || id.trim() === '') {
    throw new RangeError(`${what} must be a non-blank string, got ${JSON.stringify(id)}`);
  }
}

/** Shape-level validation: debits debit, credits credit, ids present, integers only. */
export function validateEntry(entry: LedgerEntry): void {
  const { delta, reason, runId, sourceId } = entry;
  if (!Number.isSafeInteger(delta) || delta === 0) {
    throw new RangeError(`ledger delta must be a non-zero safe integer, got ${delta}`);
  }
  const mustDebit = reason === 'run' || reason === 'clawback' || reason === 'usage';
  if (mustDebit && delta > 0) throw new RangeError(`'${reason}' entries must debit (negative delta)`);
  if (!mustDebit && delta < 0) throw new RangeError(`'${reason}' entries must credit (positive delta)`);
  if (reason === 'run' || reason === 'refund') assertId(runId, `'${reason}' runId`);
  if (reason === 'grant') assertId(sourceId, `'grant' period sourceId`);
  // usage debits carry the model_calls row id as their idempotency/source key.
  if (reason === 'usage') assertId(sourceId, `'usage' call sourceId`);
  // refill (free-tier top-up) carries the calendar-period key as its source key.
  if (reason === 'refill') assertId(sourceId, `'refill' period sourceId`);
}

/**
 * Ledger-aware validation — the append-time authority. Call inside the same
 * serialized transaction that appends (see module header). Enforces what
 * validateEntry alone cannot: refunds capped at the run's remaining charge,
 * one grant per period key, run charges never overdraw, top-ups in whole
 * units, grants only in tier amounts.
 */
export function validateAppend(entries: readonly LedgerEntry[], entry: LedgerEntry): void {
  validateEntry(entry);
  switch (entry.reason) {
    case 'run': {
      if (balance(entries) + entry.delta < 0) {
        throw new RangeError(`run charge of ${-entry.delta} would overdraw balance ${balance(entries)}`);
      }
      break;
    }
    case 'refund': {
      const refundable = refundableFor(entries, entry.runId!);
      if (entry.delta > refundable) {
        throw new RangeError(
          `refund of ${entry.delta} exceeds remaining refundable ${refundable} for run '${entry.runId}'`,
        );
      }
      break;
    }
    case 'grant': {
      if (!GRANT_AMOUNTS.has(entry.delta)) {
        throw new RangeError(`grant of ${entry.delta} matches no tier monthly allowance`);
      }
      if (entries.some((e) => e.reason === 'grant' && e.sourceId === entry.sourceId)) {
        throw new RangeError(`grant for period '${entry.sourceId}' already applied`);
      }
      break;
    }
    case 'topup': {
      if (entry.delta % TOP_UP.credits !== 0) {
        throw new RangeError(`top-up of ${entry.delta} is not a whole number of ${TOP_UP.credits}-credit top-ups`);
      }
      break;
    }
    case 'refill': {
      // Free-tier monthly top-up. Unlike 'grant' (fixed tier amounts), a refill
      // is a VARIABLE deficit (top up to the allotment), so it is NOT bound to
      // GRANT_AMOUNTS — but it is bounded above by the free allotment (a refill
      // can never credit more than one allotment) and deduped one-per-period.
      if (entry.delta > FREE_TIER_MONTHLY_ALLOTMENT) {
        throw new RangeError(
          `refill of ${entry.delta} exceeds the free allotment ${FREE_TIER_MONTHLY_ALLOTMENT}`,
        );
      }
      if (entries.some((e) => e.reason === 'refill' && e.sourceId === entry.sourceId)) {
        throw new RangeError(`refill for period '${entry.sourceId}' already applied`);
      }
      break;
    }
    case 'clawback':
      break; // may overdraw by policy (see module header)
    case 'usage':
      // Soft-gate: a usage charge is post-hoc for a model call that ALREADY
      // happened. It must ALWAYS land so the result can post — even into a
      // negative balance. Like 'clawback', it is exempt from the overdraw guard;
      // STARTING new expensive work is gated up front elsewhere (canRun).
      break;
  }
}

/** The account balance is the sum of deltas — derived, never stored. */
export function balance(entries: readonly LedgerEntry[]): number {
  let sum = 0;
  for (const e of entries) {
    sum += e.delta;
    if (!Number.isSafeInteger(sum)) {
      throw new RangeError('ledger balance exceeded safe integer range');
    }
  }
  return sum;
}

/** Pre-run budget check: the full weighted cost must be available up front. */
export function canRun(currentBalance: number, weight: WeightClass): boolean {
  if (!Number.isSafeInteger(currentBalance)) {
    throw new RangeError(`balance must be a safe integer, got ${currentBalance}`);
  }
  return currentBalance >= WEIGHTS[weight];
}

/**
 * Budget-checked charge: the entry to append, or null at cap (pause politely,
 * queue, explain, one-tap top-up — §6.2). Advisory against a snapshot;
 * validateAppend re-checks at append time.
 */
export function tryCharge(
  entries: readonly LedgerEntry[],
  weight: WeightClass,
  runId: string,
): LedgerEntry | null {
  return canRun(balance(entries), weight) ? chargeForRun(weight, runId) : null;
}

export function chargeForRun(weight: WeightClass, runId: string): LedgerEntry {
  const entry: LedgerEntry = { delta: -WEIGHTS[weight], reason: 'run', runId };
  validateEntry(entry);
  return entry;
}

/** Monthly tier allowance. `periodKey` dedupes webhook replays (one grant per period). */
export function grantEntry(tier: Tier, periodKey: string): LedgerEntry {
  const entry: LedgerEntry = { delta: TIERS[tier].monthlyCredits, reason: 'grant', sourceId: periodKey };
  validateEntry(entry);
  return entry;
}

/** Top-ups are Canopy-only (§6.4). */
export function topUpEntry(tier: Tier, count: number): LedgerEntry {
  if (!TIERS[tier].topUpsAllowed) {
    throw new RangeError(`tier '${tier}' cannot purchase top-ups`);
  }
  assertPositiveInt(count, 'top-up count');
  const entry: LedgerEntry = { delta: count * TOP_UP.credits, reason: 'topup' };
  validateEntry(entry);
  return entry;
}

/**
 * A usage debit for one model call, derived from its recorded COGS. Returns
 * null when the call rounds to 0 credits (near-free) — nothing to charge.
 * `callId` is the model_calls row id (idempotency/source key). May overdraw.
 */
export function usageEntry(costMicroUsd: number, callId: string): LedgerEntry | null {
  const credits = creditsForCostMicroUsd(costMicroUsd);
  if (credits <= 0) return null;
  const entry: LedgerEntry = { delta: -credits, reason: 'usage', sourceId: callId };
  validateEntry(entry);
  return entry;
}

export function clawbackEntry(amount: number, sourceId?: string): LedgerEntry {
  assertPositiveInt(amount, 'clawback amount');
  const entry: LedgerEntry = { delta: -amount, reason: 'clawback', ...(sourceId ? { sourceId } : {}) };
  validateEntry(entry);
  return entry;
}

/** Weighted units still refundable for a run: what it charged minus refunds already issued. */
export function refundableFor(entries: readonly LedgerEntry[], runId: string): number {
  assertId(runId, 'runId');
  let charged = 0;
  let refunded = 0;
  for (const e of entries) {
    if (e.runId !== runId) continue;
    if (e.reason === 'run') charged += -e.delta;
    if (e.reason === 'refund') refunded += e.delta;
  }
  return charged - refunded;
}

/** Refund a run in full. Throws if the run never charged or was already refunded. */
export function refundEntry(entries: readonly LedgerEntry[], runId: string): LedgerEntry {
  const refundable = refundableFor(entries, runId);
  if (refundable <= 0) {
    throw new RangeError(`run '${runId}' has nothing refundable (${refundable})`);
  }
  const entry: LedgerEntry = { delta: refundable, reason: 'refund', runId };
  validateEntry(entry);
  return entry;
}

/**
 * Free-tier ("Hatchling") monthly credit refresh — feat/freetier-credit-refresh.
 *
 * WHY: usage metering (#259) now charges credits on ALL model usage, but the
 * free tier never receives a recurring grant. Paid tiers (grove/canopy) get
 * their monthly allowance from the Stripe webhook on each paid invoice; a
 * Hatchling account pays no invoice, so once it spends its initial 100 credits
 * it stays at (or below) zero forever. A monthly job tops it back up.
 *
 * SEMANTICS — "top UP to the allotment", NOT "add the allotment":
 * A free monthly refresh means "ensure the account has at least its monthly
 * allotment at the start of each period", not "stack another N credits every
 * month forever". We therefore TOP UP to the allotment: credit the deficit
 * `clamp(allotment - currentBalance, 0, allotment)`. Consequences:
 *   - A dormant free account is refilled to the allotment (not 2N, 3N, ...).
 *   - An account already at/above the allotment gets 0 (no free stacking; this
 *     also means a churn-farming reset can never push a balance above the cap).
 *   - A NEGATIVE balance (usage soft-gate drove it below 0) is forgiven only up
 *     to ONE allotment: the refill is CAPPED at the allotment, so a deep
 *     overdraft (e.g. -500) is NOT fully wiped — the account is brought UP by at
 *     most one allotment (gate logic-skeptic P2: bound overdraft forgiveness).
 * These rows use the dedicated `refill` ledger reason (NOT `grant`): a refill is
 * a VARIABLE top-up deficit, whereas `grant` is a FIXED paid tier amount bound to
 * GRANT_AMOUNTS. Keeping them separate preserves the "grant ⇒ tier amount"
 * invariant (gate F1/P2) and keeps free/paid idempotency keys in distinct index
 * spaces.
 *
 * IDEMPOTENCY: the delta is keyed to the calendar period (see
 * `freeRefreshPeriodKey`). Persistence dedupes on (account_id, source_id) for
 * reason='refill' (a dedicated partial unique index), so a re-run within the
 * same period is a no-op — never a double top-up.
 */
export const FREE_TIER: Tier = 'hatchling';

/** The Hatchling monthly free allotment (credits). Derived from the tier table. */
export const FREE_TIER_MONTHLY_ALLOTMENT: number = TIERS[FREE_TIER].monthlyCredits;

/**
 * Credits to refill a free account UP TO its monthly allotment, CAPPED at one
 * allotment. Returns `clamp(allotment - currentBalance, 0, allotment)`:
 *   - 0 when the account already holds at least the allotment (no stacking),
 *   - the exact deficit when 0 <= balance < allotment,
 *   - at most `allotment` when balance is negative (overdraft forgiveness is
 *     bounded to one allotment — a deep negative is not fully wiped),
 *   - 0 on garbage input (fail-safe: never refill on a non-finite balance).
 * The caller skips the ledger write when this is 0.
 */
export function freeRefreshDelta(
  currentBalance: number,
  allotment: number = FREE_TIER_MONTHLY_ALLOTMENT,
): number {
  if (!Number.isFinite(currentBalance) || !Number.isSafeInteger(allotment) || allotment <= 0) {
    return 0;
  }
  const deficit = allotment - currentBalance;
  if (deficit <= 0) return 0;
  return Math.min(Math.floor(deficit), allotment);
}

/**
 * Idempotency / ledger source key for a free monthly refill, derived from the
 * calendar month in UTC: `freemonthly_YYYY-MM`. One key per account per month,
 * so a re-run inside the same month is deduped by the refill unique index.
 */
export function freeRefreshPeriodKey(now: Date = new Date()): string {
  if (Number.isNaN(now.getTime())) {
    throw new RangeError('freeRefreshPeriodKey: invalid date');
  }
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `freemonthly_${y}-${m}`;
}

/**
 * A free-tier refill entry for one account+period. `delta` is the (already
 * computed and capped) deficit from `freeRefreshDelta`; `periodKey` is the
 * dedupe/source key. Returns null when there is nothing to refill (delta <= 0).
 */
export function refillEntry(delta: number, periodKey: string): LedgerEntry | null {
  if (!Number.isSafeInteger(delta) || delta <= 0) return null;
  const entry: LedgerEntry = { delta, reason: 'refill', sourceId: periodKey };
  validateEntry(entry);
  return entry;
}

/** Smallest whole number of top-ups that covers a credit deficit. */
export function topUpsToCover(deficit: number): number {
  if (!Number.isSafeInteger(deficit) || deficit < 0) {
    throw new RangeError(`deficit must be a non-negative integer, got ${deficit}`);
  }
  return Math.ceil(deficit / TOP_UP.credits);
}
