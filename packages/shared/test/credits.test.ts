import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  WEIGHTS,
  TIERS,
  TOP_UP,
  balance,
  canRun,
  chargeForRun,
  grantEntry,
  topUpEntry,
  refundEntry,
  clawbackEntry,
  refundableFor,
  topUpsToCover,
  validateEntry,
} from '../src/credits';
import type { LedgerEntry, WeightClass } from '../src/credits';

const WEIGHT_CLASSES = Object.keys(WEIGHTS) as WeightClass[];

const arbWeightClass = fc.constantFrom(...WEIGHT_CLASSES);
const arbRunId = fc.uuid().map((u) => `run_${u}`);

/** Arbitrary valid ledger entry built only through the public constructors. */
const arbEntry: fc.Arbitrary<LedgerEntry> = fc.oneof(
  fc.tuple(arbWeightClass, arbRunId).map(([w, id]) => chargeForRun(w, id)),
  fc.constantFrom(...(Object.keys(TIERS) as (keyof typeof TIERS)[])).map((t) => grantEntry(t)),
  fc.integer({ min: 1, max: 5 }).map((n) => topUpEntry(n)),
);

describe('locked constants (SPEC §6.2 / §6.4)', () => {
  it('weighted units are exactly standard 1 / frontier 3 / computer-use 10', () => {
    expect(WEIGHTS).toEqual({ standard: 1, frontier: 3, computer_use: 10 });
  });

  it('tiers match locked pricing', () => {
    expect(TIERS.hatchling).toMatchObject({ priceUsdCents: 0, monthlyCredits: 100, maxNibbins: 2 });
    expect(TIERS.grove).toMatchObject({ priceUsdCents: 1900, monthlyCredits: 1000, maxNibbins: 5 });
    expect(TIERS.canopy).toMatchObject({ priceUsdCents: 4900, monthlyCredits: 5000, maxNibbins: null, topUpsAllowed: true });
    expect(TIERS.hatchling.topUpsAllowed).toBe(false);
    expect(TIERS.grove.topUpsAllowed).toBe(false);
  });

  it('top-ups are $5 per extra 1,000 credits', () => {
    expect(TOP_UP).toEqual({ priceUsdCents: 500, credits: 1000 });
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

  it('a gated charge sequence can never drive the balance negative', () => {
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
            if (o.op === 'grant') ledger.push(grantEntry('hatchling'));
            else if (o.op === 'topup') ledger.push(topUpEntry(1));
            else if (canRun(balance(ledger), o.weight)) {
              ledger.push(chargeForRun(o.weight, `run_${i++}`));
            }
            // at cap: pause politely — the charge is simply not appended
            expect(balance(ledger)).toBeGreaterThanOrEqual(0);
          }
        },
      ),
    );
  });
});

describe('entry constructors and sign-by-reason validation', () => {
  it('chargeForRun debits exactly the weighted cost and records the run', () => {
    for (const w of WEIGHT_CLASSES) {
      const e = chargeForRun(w, 'run_1');
      expect(e).toMatchObject({ delta: -WEIGHTS[w], reason: 'run', runId: 'run_1' });
    }
  });

  it('grantEntry credits the tier monthly allowance', () => {
    expect(grantEntry('grove')).toMatchObject({ delta: 1000, reason: 'grant' });
  });

  it('topUpEntry credits 1,000 per top-up purchased', () => {
    expect(topUpEntry(1)).toMatchObject({ delta: 1000, reason: 'topup' });
    expect(topUpEntry(3)).toMatchObject({ delta: 3000, reason: 'topup' });
  });

  it('rejects non-positive or fractional top-up counts', () => {
    expect(() => topUpEntry(0)).toThrow();
    expect(() => topUpEntry(-1)).toThrow();
    expect(() => topUpEntry(1.5)).toThrow();
  });

  it('clawbackEntry debits and requires a positive integer amount', () => {
    expect(clawbackEntry(250)).toMatchObject({ delta: -250, reason: 'clawback' });
    expect(() => clawbackEntry(0)).toThrow();
    expect(() => clawbackEntry(-5)).toThrow();
    expect(() => clawbackEntry(2.5)).toThrow();
  });

  it('validateEntry enforces sign-by-reason for every constructor output', () => {
    fc.assert(
      fc.property(arbEntry, (e) => {
        expect(() => validateEntry(e)).not.toThrow();
      }),
    );
    // runs and clawbacks debit; grants, top-ups, refunds credit
    expect(() => validateEntry({ delta: 5, reason: 'run', runId: 'r' })).toThrow();
    expect(() => validateEntry({ delta: -5, reason: 'grant' })).toThrow();
    expect(() => validateEntry({ delta: -5, reason: 'topup' })).toThrow();
    expect(() => validateEntry({ delta: -5, reason: 'refund', runId: 'r' })).toThrow();
    expect(() => validateEntry({ delta: 5, reason: 'clawback' })).toThrow();
    expect(() => validateEntry({ delta: 0, reason: 'grant' })).toThrow();
    expect(() => validateEntry({ delta: 1.5, reason: 'grant' })).toThrow();
  });

  it('run charges and refunds must reference a run', () => {
    expect(() => validateEntry({ delta: -1, reason: 'run' })).toThrow();
    expect(() => validateEntry({ delta: 1, reason: 'refund' })).toThrow();
  });
});

describe('refunds (never exceed what the run actually charged)', () => {
  it('refundEntry returns the remaining refundable amount for the run', () => {
    const ledger = [grantEntry('grove'), chargeForRun('computer_use', 'run_a')];
    const refund = refundEntry(ledger, 'run_a');
    expect(refund).toMatchObject({ delta: 10, reason: 'refund', runId: 'run_a' });
  });

  it('a run can never be refunded twice', () => {
    const ledger = [grantEntry('grove'), chargeForRun('frontier', 'run_a')];
    const first = refundEntry(ledger, 'run_a');
    expect(() => refundEntry([...ledger, first], 'run_a')).toThrow();
  });

  it('refunding a run that never charged throws', () => {
    expect(() => refundEntry([grantEntry('grove')], 'run_missing')).toThrow();
  });

  it('property: total refunds per run never exceed the original charge', () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(arbWeightClass, arbRunId), { maxLength: 50 }), (runs) => {
        const ledger: LedgerEntry[] = [grantEntry('canopy')];
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
