/**
 * §4.4 scan modules over the synthetic fixture corpus: every module yields
 * deterministic findings with the full quartet (insight, quantified cost with
 * the math, recommended Nibbin, one-tap adopt action) and evidence that never
 * carries raw content.
 */
import { describe, expect, it } from 'vitest';
import { CONNECTOR_REGISTRY, SCAN_WINDOW_MONTHS, quarantine, scanWindowEndingAt, type Connection, type Finding } from '@nibbin/connectors';
import { TEMPLATE_FOR_SCAN_MODULE, getTemplate } from '@nibbin/runtime';
import { ALL_SCAN_MODULES, fixtureReader, modulesForProvider, paymentsFeeLeakage, paymentsInvoiceLatency, crmDeliveryLatency, runScan } from '../src/index';

const NOW = Date.UTC(2026, 5, 11, 12, 0, 0);

function connection(provider: string, id = `conn-${provider}`): Connection {
  return {
    id,
    accountId: 'acct-1',
    provider,
    method: 'H',
    scopes: [],
    status: 'active',
    tokenRef: null,
    webhookState: {},
    createdBy: null,
    createdAt: new Date(NOW - 30 * 86_400_000).toISOString(),
    revokedAt: null,
  };
}

async function findingsFor(provider: string): Promise<Finding[]> {
  const conn = connection(provider);
  const reader = fixtureReader(provider, NOW);
  const window = scanWindowEndingAt(NOW);
  const out: Finding[] = [];
  for (const m of modulesForProvider(provider)) {
    out.push(...(await m.run({ connection: conn, window, reader })));
  }
  return out;
}

describe('module ↔ registry consistency', () => {
  it('every module id is unique and declared by every provider it claims', () => {
    const ids = ALL_SCAN_MODULES.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of ALL_SCAN_MODULES) {
      for (const p of m.providers) {
        const d = CONNECTOR_REGISTRY.get(p);
        expect(d, `provider ${p} for module ${m.id}`).toBeDefined();
        expect(d!.scanModules, `${p} must declare ${m.id}`).toContain(m.id);
      }
    }
  });

  it('all fifteen §4.4 module ids declared in the registry are implemented', () => {
    const declared = new Set<string>();
    for (const d of CONNECTOR_REGISTRY.values()) for (const id of d.scanModules) declared.add(id);
    const implemented = new Set(ALL_SCAN_MODULES.map((m) => m.id));
    expect(implemented).toEqual(declared);
  });
});

describe('findings carry the §4.4 quartet', () => {
  for (const provider of ['gmail', 'google-calendar', 'stripe', 'honeybook', 'pixieset', 'instagram-dm']) {
    it(`${provider}: fixture corpus produces findings with insight, cost math, fixer, adopt action`, async () => {
      const findings = await findingsFor(provider);
      expect(findings.length, `${provider} should surface findings on the seeded corpus`).toBeGreaterThan(0);
      for (const f of findings) {
        expect(f.insight.trim().length).toBeGreaterThan(10);
        expect(f.cost.basis.trim().length).toBeGreaterThan(5);
        expect((f.cost.hoursPerWeek ?? 0) + (f.cost.dollarsPerMonth ?? 0)).toBeGreaterThan(0);
        expect(f.recommendedNibbin).toBe(TEMPLATE_FOR_SCAN_MODULE[f.module]);
        expect(f.adoptAction.specTemplateKey).toBe(f.recommendedNibbin);
        expect(f.adoptAction.requiredConnectors).toEqual(getTemplate(f.recommendedNibbin).spec.requiredConnectors);
      }
    });
  }

  it('evidence holds counts/ids only — never message bodies or names', async () => {
    const findings = await findingsFor('gmail');
    const dumped = JSON.stringify(findings.map((f) => f.evidence ?? {}));
    // fixture corpus content sentinels must not leak into evidence
    expect(dumped).not.toMatch(/example\.test/);
    expect(dumped).not.toMatch(/Client </);
  });
});

describe('the scan engine', () => {
  it('scans active connections and reports failures without sinking', async () => {
    const result = await runScan(
      [connection('gmail'), connection('stripe')],
      { forConnection: async (c) => fixtureReader(c.provider, NOW) },
      NOW,
    );
    expect(result.empty).toBe(false);
    expect(result.scannedConnections).toBe(2);
    expect(result.findings.length).toBeGreaterThan(3);
  });

  it('skips revoked/paused connections entirely', async () => {
    const revoked = { ...connection('gmail'), status: 'revoked' as const };
    const result = await runScan([revoked], { forConnection: async (c) => fixtureReader(c.provider, NOW) }, NOW);
    expect(result.scannedConnections).toBe(0);
    expect(result.empty).toBe(true);
  });

  it('a connection with no implemented modules yields scan_empty, not an error', async () => {
    const result = await runScan(
      [connection('generic-mcp')],
      { forConnection: async (c) => fixtureReader(c.provider, NOW) },
      NOW,
    );
    expect(result.empty).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it('a throwing reader becomes a recorded failure, never a crash', async () => {
    const result = await runScan(
      [connection('gmail')],
      {
        forConnection: async () => ({
          read: async () => {
            throw new Error('provider down');
          },
        }),
      },
      NOW,
    );
    expect(result.empty).toBe(true);
    expect(result.failures.length).toBeGreaterThan(0);
  });
});

describe('hoursPerWeek window divisor (Fix 3)', () => {
  it('paymentsInvoiceLatency uses the full 52-week window divisor, not a hardcoded 13', async () => {
    // 52 invoices with 5-day draft lag; ~6 min each → hoursPerWeek = (52*6)/60/52 = 0.1
    // With the old /13 divisor it would be (52*6)/60/13 = 0.4 — 4× inflated
    const nowSecs = Math.floor(NOW / 1000);
    const invoices = Array.from({ length: 52 }, (_, i) => ({
      id: `inv-${i}`,
      status: 'paid',
      created: nowSecs - (i + 1) * 7 * 86_400,
      status_transitions: { finalized_at: nowSecs - (i + 1) * 7 * 86_400 + 5 * 86_400 },
    }));
    const reader = {
      read: async () => quarantine(JSON.stringify({ data: invoices }), 'stripe:c1:/v1/invoices'),
    };
    const conn = connection('stripe', 'conn-inv-lat');
    const { SCAN_WINDOW_WEEKS } = await import('@nibbin/connectors');
    const out = await paymentsInvoiceLatency.run({ connection: conn, window: scanWindowEndingAt(NOW), reader });
    expect(out.length).toBeGreaterThan(0);
    const f = out[0]!;
    // Expected hoursPerWeek uses SCAN_WINDOW_WEEKS (~52), not 13
    const expectedHpw = Math.round(((52 * 6) / 60 / SCAN_WINDOW_WEEKS) * 10) / 10;
    expect(f.cost.hoursPerWeek).toBe(expectedHpw);
    // Sanity: value at 52-week divisor is ~4× smaller than the old 13-week divisor
    const inflatedHpw = Math.round(((52 * 6) / 60 / 13) * 10) / 10;
    expect(f.cost.hoursPerWeek).toBeLessThan(inflatedHpw);
  });

  it('crmDeliveryLatency uses the full 52-week window divisor, not a hardcoded 13', async () => {
    // 52 collections published 8 days after creation (> 7-day threshold)
    const collections = Array.from({ length: 52 }, (_, i) => ({
      id: `col-${i}`,
      created_at: new Date(NOW - (20 + i * 6) * 86_400_000).toISOString(),
      published_at: new Date(NOW - (12 + i * 6) * 86_400_000).toISOString(), // 8 days later
    }));
    const reader = {
      read: async () => quarantine(JSON.stringify({ data: collections }), 'pixieset:c1:/v1/collections'),
    };
    const conn = connection('pixieset', 'conn-crm-lat');
    const { SCAN_WINDOW_WEEKS } = await import('@nibbin/connectors');
    const out = await crmDeliveryLatency.run({ connection: conn, window: scanWindowEndingAt(NOW), reader });
    // The first finding (medianDays >= 7) contains hoursPerWeek
    const latencyFinding = out.find((f) => f.module === 'crm.delivery-latency' && f.evidence && (f.evidence as Record<string, unknown>).published !== undefined);
    expect(latencyFinding).toBeDefined();
    // hoursPerWeek computed as (count*6)/60/SCAN_WINDOW_WEEKS — should not equal the 13-week value
    const expectedHpw = Math.max(0.1, Math.round(((52 * 6) / 60 / SCAN_WINDOW_WEEKS) * 10) / 10);
    const inflatedHpw = Math.round(((52 * 6) / 60 / 13) * 10) / 10;
    expect(latencyFinding!.cost.hoursPerWeek).toBe(expectedHpw);
    expect(latencyFinding!.cost.hoursPerWeek).toBeLessThan(inflatedHpw);
  });
});

describe('monthly averaging math', () => {
  it('fee-leakage averages fees over the full window, not a hardcoded 3 months', async () => {
    // 12 balance transactions, $2400 fee each = $28800 total fees over 12 months = $2400/mo
    // (must exceed the $20/mo guard; with old /3 math this would have yielded $9600/mo)
    const feePerTxnCents = 240000; // $2400 in cents
    const txns = Array.from({ length: 12 }, (_, i) => ({ id: `t${i}`, fee: feePerTxnCents, amount: 5000000 }));
    const reader = {
      read: async () => quarantine(JSON.stringify({ data: txns }), 'stripe:c1:/v1/balance_transactions'),
    };
    const conn = connection('stripe', 'conn-stripe-math');
    const out = await paymentsFeeLeakage.run({ connection: conn, window: scanWindowEndingAt(NOW), reader });
    // $28800 total fees / SCAN_WINDOW_MONTHS(=12) = $2400/mo, NOT $28800/3 = $9600/mo
    const expectedPerMonth = Math.round((12 * feePerTxnCents) / 100 / SCAN_WINDOW_MONTHS); // 2400
    expect(out[0]?.cost.dollarsPerMonth).toBe(expectedPerMonth);
  });
});
