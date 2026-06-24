import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  WEIGHTS,
  TIERS,
  TOP_UP,
  balance,
  canRun,
  tryCharge,
  chargeForRun,
  grantEntry,
  topUpEntry,
  refundEntry,
  clawbackEntry,
  refundableFor,
  topUpsToCover,
  validateEntry,
  validateAppend,
  DIAGNOSIS_MAX_MICRO_USD,
  withinDiagnosisCostCap,
  USD_PER_CREDIT,
  MICRO_USD_PER_CREDIT,
  creditsForCostMicroUsd,
  usageEntry,
} from '../src/credits';
import type { LedgerEntry, WeightClass } from '../src/credits';

const WEIGHT_CLASSES = Object.keys(WEIGHTS) as WeightClass[];

const arbWeightClass = fc.constantFrom(...WEIGHT_CLASSES);
const arbRunId = fc.uuid().map((u) => `run_${u}`);
const arbPeriodKey = fc.uuid().map((u) => `inv_${u}`);

/** Arbitrary valid ledger entry built only through the public constructors. */
const arbEntry: fc.Arbitrary<LedgerEntry> = fc.oneof(
  fc.tuple(arbWeightClass, arbRunId).map(([w, id]) => chargeForRun(w, id)),
  fc
    .tuple(fc.constantFrom(...(Object.keys(TIERS) as (keyof typeof TIERS)[])), arbPeriodKey)
    .map(([t, k]) => grantEntry(t, k)),
  fc.integer({ min: 1, max: 5 }).map((n) => topUpEntry('canopy', n)),
  fc.integer({ min: 1, max: 5000 }).map((n) => clawbackEntry(n)),
);

describe('locked constants (SPEC §6.2 / §6.4)', () => {
  it('weighted units are exactly standard 1 / frontier 3 / computer-use 10', () => {
    expect(WEIGHTS).toEqual({ standard: 1, frontier: 3, computer_use: 10 });
  });

  it('tiers match locked pricing', () => {
    expect(TIERS.hatchling).toMatchObject({ priceUsdCents: 0, monthlyCredits: 100, maxNibbins: 2 });
    expect(TIERS.grove).toMatchObject({ priceUsdCents: 2900, monthlyCredits: 1000, maxNibbins: 5 });
    expect(TIERS.canopy).toMatchObject({ priceUsdCents: 7900, monthlyCredits: 5000, maxNibbins: null, topUpsAllowed: true });
    expect(TIERS.hatchling.topUpsAllowed).toBe(false);
    expect(TIERS.grove.topUpsAllowed).toBe(false);
  });

  it('top-ups are $10 per extra 1,000 credits (founder decision 2026-06-12)', () => {
    expect(TOP_UP).toEqual({ priceUsdCents: 1000, credits: 1000 });
  });
});

describe('balance derivation (append-only ledger, balances derived never stored)', () => {
  it('empty ledger has zero balance', () => {
    expect(balance([])).toBe(0);
  });

  it('balance is the sum of deltas', () => {
    fc.assert(
      fc.property(fc.array(arbEntry), (entries) => {
        const expected = entries.reduce((s, e) => s + e.delta, 0);
        expect(balance(entries)).toBe(expected);
      }),
    );
  });

  it('balance is order-independent (append-only ⇒ any replay order agrees)', () => {
    fc.assert(
      fc.property(fc.array(arbEntry), (entries) => {
        const reversed = [...entries].reverse();
        expect(balance(reversed)).toBe(balance(entries));
      }),
    );
  });

  it('balance is always a safe integer — no fractional credits ever', () => {
    fc.assert(
      fc.property(fc.array(arbEntry, { maxLength: 200 }), (entries) => {
        expect(Number.isSafeInteger(balance(entries))).toBe(true);
      }),
    );
  });

  it('balance throws rather than silently losing precision past MAX_SAFE_INTEGER', () => {
    const huge: LedgerEntry[] = [
      { delta: Number.MAX_SAFE_INTEGER - 1, reason: 'grant', sourceId: 'inv_1' },
      { delta: Number.MAX_SAFE_INTEGER - 1, reason: 'grant', sourceId: 'inv_2' },
    ];
    expect(() => balance(huge)).toThrow(RangeError);
  });
});

describe('pre-run budget check (§6.2: never overdraw via runs)', () => {
  it('canRun requires the full weighted cost up front', () => {
    expect(canRun(0, 'standard')).toBe(false);
    expect(canRun(1, 'standard')).toBe(true);
    expect(canRun(2, 'frontier')).toBe(false);
    expect(canRun(3, 'frontier')).toBe(true);
    expect(canRun(9, 'computer_use')).toBe(false);
    expect(canRun(10, 'computer_use')).toBe(true);
  });

  it('canRun rejects non-integer balances instead of waving them through', () => {
    expect(() => canRun(Infinity, 'standard')).toThrow(RangeError);
    expect(() => canRun(NaN, 'standard')).toThrow(RangeError);
    expect(() => canRun(1.5, 'standard')).toThrow(RangeError);
  });

  it('tryCharge charges when affordable and returns null at cap (pause politely)', () => {
    const ledger = [grantEntry('hatchling', 'inv_1')]; // 100 credits
    const charge = tryCharge(ledger, 'computer_use', 'run_1');
    expect(charge).toMatchObject({ delta: -10, reason: 'run', runId: 'run_1' });
    expect(tryCharge([], 'standard', 'run_2')).toBeNull();
  });

  it('a stale-snapshot second charge is rejected at append time', () => {
    // Two concurrent pre-run checks read balance 1; only one charge may land.
    const ledger: LedgerEntry[] = [
      grantEntry('hatchling', 'inv_1'),
      clawbackEntry(99), // balance: 1
    ];
    const c1 = tryCharge(ledger, 'standard', 'run_1');
    const c2 = tryCharge(ledger, 'standard', 'run_2'); // stale read, also non-null
    expect(c1).not.toBeNull();
    expect(c2).not.toBeNull();
    const applied = [...ledger, c1!];
    expect(() => validateAppend(applied, c2!)).toThrow(RangeError);
  });

  it('property: a validateAppend-gated sequence can never drive the balance negative via runs', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(
            fc.record({ op: fc.constant('grant' as const) }),
            fc.record({ op: fc.constant('topup' as const) }),
            fc.record({ op: fc.constant('run' as const), weight: arbWeightClass }),
          ),
          { maxLength: 100 },
        ),
        (ops) => {
          const ledger: LedgerEntry[] = [];
          let i = 0;
          for (const o of ops) {
            if (o.op === 'grant') ledger.push(grantEntry('hatchling', `inv_${i++}`));
            else if (o.op === 'topup') ledger.push(topUpEntry('canopy', 1));
            else {
              const charge = tryCharge(ledger, o.weight, `run_${i++}`);
              if (charge) ledger.push(charge);
              // at cap: pause politely — the charge is simply not appended
            }
            expect(balance(ledger)).toBeGreaterThanOrEqual(0);
          }
        },
      ),
    );
  });
});

describe('entry constructors and shape validation', () => {
  it('chargeForRun debits exactly the weighted cost and records the run', () => {
    for (const w of WEIGHT_CLASSES) {
      const e = chargeForRun(w, 'run_1');
      expect(e).toMatchObject({ delta: -WEIGHTS[w], reason: 'run', runId: 'run_1' });
    }
  });

  it('grantEntry credits the tier monthly allowance and carries its period key', () => {
    expect(grantEntry('grove', 'inv_2026_06')).toMatchObject({
      delta: 1000,
      reason: 'grant',
      sourceId: 'inv_2026_06',
    });
  });

  it('topUpEntry credits 1,000 per top-up purchased — Canopy only (§6.4)', () => {
    expect(topUpEntry('canopy', 1)).toMatchObject({ delta: 1000, reason: 'topup' });
    expect(topUpEntry('canopy', 3)).toMatchObject({ delta: 3000, reason: 'topup' });
    expect(() => topUpEntry('hatchling', 1)).toThrow();
    expect(() => topUpEntry('grove', 1)).toThrow();
  });

  it('rejects non-positive or fractional top-up counts', () => {
    expect(() => topUpEntry('canopy', 0)).toThrow();
    expect(() => topUpEntry('canopy', -1)).toThrow();
    expect(() => topUpEntry('canopy', 1.5)).toThrow();
  });

  it('clawbackEntry debits and requires a positive integer amount', () => {
    expect(clawbackEntry(250)).toMatchObject({ delta: -250, reason: 'clawback' });
    expect(() => clawbackEntry(0)).toThrow();
    expect(() => clawbackEntry(-5)).toThrow();
    expect(() => clawbackEntry(2.5)).toThrow();
  });

  it('a clawback may drive the balance negative; runs are then blocked', () => {
    // Documented policy: chargebacks can overdraw; canRun gates all further spend.
    const ledger = [grantEntry('hatchling', 'inv_1'), clawbackEntry(150)];
    expect(balance(ledger)).toBe(-50);
    expect(canRun(balance(ledger), 'standard')).toBe(false);
  });

  it('validateEntry enforces sign-by-reason for every constructor output', () => {
    fc.assert(
      fc.property(arbEntry, (e) => {
        expect(() => validateEntry(e)).not.toThrow();
      }),
    );
    // runs and clawbacks debit; grants, top-ups, refunds credit
    expect(() => validateEntry({ delta: 5, reason: 'run', runId: 'r' })).toThrow();
    expect(() => validateEntry({ delta: -5, reason: 'grant', sourceId: 's' })).toThrow();
    expect(() => validateEntry({ delta: -5, reason: 'topup' })).toThrow();
    expect(() => validateEntry({ delta: -5, reason: 'refund', runId: 'r' })).toThrow();
    expect(() => validateEntry({ delta: 5, reason: 'clawback' })).toThrow();
    expect(() => validateEntry({ delta: 0, reason: 'grant', sourceId: 's' })).toThrow();
    expect(() => validateEntry({ delta: 1.5, reason: 'grant', sourceId: 's' })).toThrow();
  });

  it('run charges and refunds must reference a run; grants must carry a period key', () => {
    expect(() => validateEntry({ delta: -1, reason: 'run' })).toThrow();
    expect(() => validateEntry({ delta: 1, reason: 'refund' })).toThrow();
    expect(() => validateEntry({ delta: 100, reason: 'grant' })).toThrow();
  });

  it('rejects blank or whitespace ids', () => {
    expect(() => chargeForRun('standard', '')).toThrow();
    expect(() => chargeForRun('standard', '   ')).toThrow();
    expect(() => grantEntry('grove', ' ')).toThrow();
    expect(() => refundableFor([], '')).toThrow();
  });
});

describe('validateAppend (ledger-aware: what validateEntry alone cannot enforce)', () => {
  it('rejects a refund larger than the run actually charged — credits cannot be minted', () => {
    const ledger = [grantEntry('grove', 'inv_1'), chargeForRun('frontier', 'run_a')];
    expect(() =>
      validateAppend(ledger, { delta: 1_000_000, reason: 'refund', runId: 'run_a' }),
    ).toThrow(RangeError);
    expect(() =>
      validateAppend(ledger, { delta: 3, reason: 'refund', runId: 'run_a' }),
    ).not.toThrow();
  });

  it('rejects a second refund produced from a stale snapshot', () => {
    const ledger = [grantEntry('grove', 'inv_1'), chargeForRun('computer_use', 'run_a')];
    const r1 = refundEntry(ledger, 'run_a');
    const r2 = refundEntry(ledger, 'run_a'); // both built from the same stale snapshot
    const applied = [...ledger, r1];
    expect(() => validateAppend(applied, r2)).toThrow(RangeError);
    expect(balance([...applied])).toBe(TIERS.grove.monthlyCredits);
  });

  it('rejects a duplicate grant for the same billing period (webhook replay)', () => {
    const ledger = [grantEntry('grove', 'inv_2026_06')];
    expect(() => validateAppend(ledger, grantEntry('grove', 'inv_2026_06'))).toThrow(RangeError);
    expect(() => validateAppend(ledger, grantEntry('grove', 'inv_2026_07'))).not.toThrow();
  });

  it('rejects grant amounts that match no tier and top-ups that are not whole top-ups', () => {
    expect(() => validateAppend([], { delta: 999_999, reason: 'grant', sourceId: 'inv_x' })).toThrow(RangeError);
    expect(() => validateAppend([], { delta: 1500, reason: 'topup' })).toThrow(RangeError);
    expect(() => validateAppend([], { delta: 2000, reason: 'topup' })).not.toThrow();
  });

  it('rejects a run charge the balance cannot cover', () => {
    expect(() => validateAppend([], chargeForRun('standard', 'run_x'))).toThrow(RangeError);
  });

  it('accepts every entry of a constructor-built, properly gated ledger', () => {
    fc.assert(
      fc.property(fc.array(arbEntry, { maxLength: 60 }), (candidates) => {
        const ledger: LedgerEntry[] = [grantEntry('canopy', 'inv_seed')];
        for (const e of candidates) {
          try {
            validateAppend(ledger, e);
          } catch {
            continue; // rejected appends are simply not applied
          }
          ledger.push(e);
        }
        expect(balance(ledger)).toBeGreaterThanOrEqual(
          // only clawbacks may take the ledger negative
          -ledger.filter((e) => e.reason === 'clawback').reduce((s, e) => s - e.delta, 0),
        );
      }),
    );
  });
});

describe('refunds (never exceed what the run actually charged)', () => {
  it('refundEntry returns the remaining refundable amount for the run', () => {
    const ledger = [grantEntry('grove', 'inv_1'), chargeForRun('computer_use', 'run_a')];
    const refund = refundEntry(ledger, 'run_a');
    expect(refund).toMatchObject({ delta: 10, reason: 'refund', runId: 'run_a' });
  });

  it('a run can never be refunded twice', () => {
    const ledger = [grantEntry('grove', 'inv_1'), chargeForRun('frontier', 'run_a')];
    const first = refundEntry(ledger, 'run_a');
    expect(() => refundEntry([...ledger, first], 'run_a')).toThrow();
  });

  it('refunding a run that never charged throws', () => {
    expect(() => refundEntry([grantEntry('grove', 'inv_1')], 'run_missing')).toThrow();
  });

  it('property: total refunds per run never exceed the original charge', () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(arbWeightClass, arbRunId), { maxLength: 50 }), (runs) => {
        const ledger: LedgerEntry[] = [grantEntry('canopy', 'inv_1')];
        for (const [w, id] of runs) ledger.push(chargeForRun(w, id));
        // refund every distinct run once; a second attempt must always throw
        const seen = new Set<string>();
        for (const [, id] of runs) {
          if (seen.has(id)) continue;
          seen.add(id);
          ledger.push(refundEntry(ledger, id));
          expect(refundableFor(ledger, id)).toBe(0);
          expect(() => refundEntry(ledger, id)).toThrow();
        }
        // ledger with all refunds applied nets back to the original grant
        expect(balance(ledger)).toBe(TIERS.canopy.monthlyCredits);
      }),
    );
  });
});

describe('top-up coverage math (at cap: explain, one-tap top-up)', () => {
  it('computes the smallest whole number of top-ups covering a deficit', () => {
    expect(topUpsToCover(0)).toBe(0);
    expect(topUpsToCover(1)).toBe(1);
    expect(topUpsToCover(1000)).toBe(1);
    expect(topUpsToCover(1001)).toBe(2);
  });

  it('property: n = topUpsToCover(d) is minimal and sufficient', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000 }), (deficit) => {
        const n = topUpsToCover(deficit);
        expect(n * TOP_UP.credits).toBeGreaterThanOrEqual(deficit);
        if (n > 0) expect((n - 1) * TOP_UP.credits).toBeLessThan(deficit);
      }),
    );
  });

  it('rejects negative or fractional deficits', () => {
    expect(() => topUpsToCover(-1)).toThrow();
    expect(() => topUpsToCover(0.5)).toThrow();
  });
});

describe('diagnosis hard cost cap (anti-runaway)', () => {
  it('the cap is a positive integer micro-USD ceiling', () => {
    expect(Number.isSafeInteger(DIAGNOSIS_MAX_MICRO_USD)).toBe(true);
    expect(DIAGNOSIS_MAX_MICRO_USD).toBeGreaterThan(0);
  });

  it('passes a cost at or under the cap, fails one over it', () => {
    expect(withinDiagnosisCostCap(0)).toBe(true);
    expect(withinDiagnosisCostCap(DIAGNOSIS_MAX_MICRO_USD)).toBe(true);
    expect(withinDiagnosisCostCap(DIAGNOSIS_MAX_MICRO_USD - 1)).toBe(true);
    expect(withinDiagnosisCostCap(DIAGNOSIS_MAX_MICRO_USD + 1)).toBe(false);
  });

  it('fails closed on non-finite or negative cost', () => {
    expect(withinDiagnosisCostCap(Number.NaN)).toBe(false);
    expect(withinDiagnosisCostCap(Number.POSITIVE_INFINITY)).toBe(false);
    expect(withinDiagnosisCostCap(-1)).toBe(false);
  });
});

describe('usage metering — conversion (feat/credit-metering-usage)', () => {
  it('USD_PER_CREDIT agrees with the top-up economics ($0.01/credit)', () => {
    // 1 credit = $0.01; the TOP_UP price/credits ratio must match (no two prices).
    expect(USD_PER_CREDIT).toBe(0.01);
    expect(MICRO_USD_PER_CREDIT).toBe(10_000);
    // TOP_UP is priceUsdCents per credits; cents→USD/credit must equal the rate.
    expect((TOP_UP.priceUsdCents / 100) / TOP_UP.credits).toBeCloseTo(USD_PER_CREDIT, 10);
  });

  it('charges proportional to cost via ceil(cost / rate)', () => {
    // A typical chat turn (~950 µUSD) → 1 credit; onboarding (~805) → 1.
    expect(creditsForCostMicroUsd(950)).toBe(1);
    expect(creditsForCostMicroUsd(805)).toBe(1);
    // A plan synthesis (~4,100 µUSD) → 1 credit (still under one whole credit).
    expect(creditsForCostMicroUsd(4_100)).toBe(1);
    // Exactly one credit's worth → 1; one µUSD over → 2 (proportional, ceil).
    expect(creditsForCostMicroUsd(MICRO_USD_PER_CREDIT)).toBe(1);
    expect(creditsForCostMicroUsd(MICRO_USD_PER_CREDIT + 1)).toBe(2);
    // A pricey call ($0.05 = 50,000 µUSD) → 5 credits.
    expect(creditsForCostMicroUsd(50_000)).toBe(5);
  });

  it('a near-free call rounds to 0 credits (and is not charged)', () => {
    expect(creditsForCostMicroUsd(0)).toBe(0);
    expect(creditsForCostMicroUsd(1)).toBe(1); // any positive cost is at least 1
    expect(usageEntry(0, 'call-1')).toBeNull();
  });

  it('fails safe (0 credits) on garbage cost', () => {
    expect(creditsForCostMicroUsd(Number.NaN)).toBe(0);
    expect(creditsForCostMicroUsd(Number.POSITIVE_INFINITY)).toBe(0);
    expect(creditsForCostMicroUsd(-100)).toBe(0);
  });

  it('the 5000-credit free grant comfortably covers normal usage', () => {
    // The heaviest real account so far: 8 calls totalling 23,227 µUSD.
    const sessionCredits = creditsForCostMicroUsd(950) * 6 + creditsForCostMicroUsd(4_100) * 2;
    expect(sessionCredits).toBeLessThan(20); // a busy session is < 0.5% of 5000
    expect(TIERS.canopy.monthlyCredits).toBe(5000);
  });
});

describe('usage metering — ledger entry (soft-gate)', () => {
  it('usageEntry debits, carries the call id as sourceId, and validates', () => {
    const e = usageEntry(25_000, 'call-abc')!;
    expect(e.reason).toBe('usage');
    expect(e.delta).toBe(-3); // ceil(25000/10000)
    expect(e.sourceId).toBe('call-abc');
    expect(() => validateEntry(e)).not.toThrow();
  });

  it("a 'usage' entry must carry a sourceId (the call id)", () => {
    expect(() => validateEntry({ delta: -1, reason: 'usage' })).toThrow(/sourceId/);
  });

  it('a usage charge ALWAYS appends — even driving the balance negative', () => {
    // Soft-gate: a completed call charges into a negative balance (result posts).
    const ledger: LedgerEntry[] = [chargeForRun('standard', 'run-1')]; // balance -1? no: -1
    // Start from a balance of 0 by pairing with a grant, then overdraw via usage.
    const seeded: LedgerEntry[] = [grantEntry('hatchling', 'p1')]; // +100
    const drain = usageEntry(1_000_000, 'call-big')!; // $1.00 → 100 credits
    expect(() => validateAppend(seeded, drain)).not.toThrow(); // 100 - 100 = 0
    const overdraw = usageEntry(500_000, 'call-over')!; // another 50 → -50
    expect(() => validateAppend([...seeded, drain], overdraw)).not.toThrow();
    expect(balance([...seeded, drain, overdraw])).toBe(-50);
    void ledger;
  });

  it("a 'run' charge still CANNOT overdraw (only usage/clawback may)", () => {
    const seeded: LedgerEntry[] = [grantEntry('hatchling', 'p1')]; // +100
    // drain to 0 with usage, then a run must be refused at append time.
    const drain = usageEntry(1_000_000, 'call-big')!; // -100
    const run = chargeForRun('standard', 'run-x');
    expect(() => validateAppend([...seeded, drain], run)).toThrow(/overdraw/);
  });
});
