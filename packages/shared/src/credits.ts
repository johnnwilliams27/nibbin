/**
 * Credit ledger math — SPEC §6.2 (weighted units), §6.4 (tiers & top-ups).
 *
 * The ledger is append-only; balances are always derived from entry deltas,
 * never stored and mutated (docs/INVARIANTS.md). Everything here is pure —
 * persistence and RLS live in the Supabase migrations that land next.
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

export type LedgerReason = 'run' | 'topup' | 'grant' | 'refund' | 'clawback';

export interface LedgerEntry {
  /** Signed weighted units. Debits negative, credits positive. Always a safe integer. */
  delta: number;
  reason: LedgerReason;
  /** Required for 'run' and 'refund' — refunds must reference the charge they reverse. */
  runId?: string;
}

function assertPositiveInt(n: number, what: string): void {
  if (!Number.isSafeInteger(n) || n <= 0) {
    throw new RangeError(`${what} must be a positive integer, got ${n}`);
  }
}

/** Debits credit; credits debit. Zero and fractional deltas are never legal. */
export function validateEntry(entry: LedgerEntry): void {
  const { delta, reason, runId } = entry;
  if (!Number.isSafeInteger(delta) || delta === 0) {
    throw new RangeError(`ledger delta must be a non-zero safe integer, got ${delta}`);
  }
  const mustDebit = reason === 'run' || reason === 'clawback';
  if (mustDebit && delta > 0) throw new RangeError(`'${reason}' entries must debit (negative delta)`);
  if (!mustDebit && delta < 0) throw new RangeError(`'${reason}' entries must credit (positive delta)`);
  if ((reason === 'run' || reason === 'refund') && !runId) {
    throw new RangeError(`'${reason}' entries must reference a run`);
  }
}

/** The account balance is the sum of deltas — derived, never stored. */
export function balance(entries: readonly LedgerEntry[]): number {
  return entries.reduce((sum, e) => sum + e.delta, 0);
}

/** Pre-run budget check: the full weighted cost must be available up front. */
export function canRun(currentBalance: number, weight: WeightClass): boolean {
  return currentBalance >= WEIGHTS[weight];
}

export function chargeForRun(weight: WeightClass, runId: string): LedgerEntry {
  const entry: LedgerEntry = { delta: -WEIGHTS[weight], reason: 'run', runId };
  validateEntry(entry);
  return entry;
}

export function grantEntry(tier: Tier): LedgerEntry {
  const entry: LedgerEntry = { delta: TIERS[tier].monthlyCredits, reason: 'grant' };
  validateEntry(entry);
  return entry;
}

export function topUpEntry(count: number): LedgerEntry {
  assertPositiveInt(count, 'top-up count');
  const entry: LedgerEntry = { delta: count * TOP_UP.credits, reason: 'topup' };
  validateEntry(entry);
  return entry;
}

export function clawbackEntry(amount: number): LedgerEntry {
  assertPositiveInt(amount, 'clawback amount');
  const entry: LedgerEntry = { delta: -amount, reason: 'clawback' };
  validateEntry(entry);
  return entry;
}

/** Weighted units still refundable for a run: what it charged minus refunds already issued. */
export function refundableFor(entries: readonly LedgerEntry[], runId: string): number {
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
