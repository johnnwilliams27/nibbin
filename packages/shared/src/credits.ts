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
  grove: { priceUsdCents: 1900, monthlyCredits: 1000, maxNibbins: 5 as number | null, topUpsAllowed: false },
  canopy: { priceUsdCents: 4900, monthlyCredits: 5000, maxNibbins: null as number | null, topUpsAllowed: true },
} as const;

export type Tier = keyof typeof TIERS;

export const TOP_UP = { priceUsdCents: 500, credits: 1000 } as const;

const GRANT_AMOUNTS: ReadonlySet<number> = new Set(
  Object.values(TIERS).map((t) => t.monthlyCredits),
);

export type LedgerReason = 'run' | 'topup' | 'grant' | 'refund' | 'clawback';

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
  const mustDebit = reason === 'run' || reason === 'clawback';
  if (mustDebit && delta > 0) throw new RangeError(`'${reason}' entries must debit (negative delta)`);
  if (!mustDebit && delta < 0) throw new RangeError(`'${reason}' entries must credit (positive delta)`);
  if (reason === 'run' || reason === 'refund') assertId(runId, `'${reason}' runId`);
  if (reason === 'grant') assertId(sourceId, `'grant' period sourceId`);
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
    case 'clawback':
      break; // may overdraw by policy (see module header)
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

/** Smallest whole number of $5 top-ups that covers a credit deficit. */
export function topUpsToCover(deficit: number): number {
  if (!Number.isSafeInteger(deficit) || deficit < 0) {
    throw new RangeError(`deficit must be a non-negative integer, got ${deficit}`);
  }
  return Math.ceil(deficit / TOP_UP.credits);
}
