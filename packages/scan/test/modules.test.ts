/**
 * §4.4 scan modules over the synthetic fixture corpus: every module yields
 * deterministic findings with the full quartet (insight, quantified cost with
 * the math, recommended Nibbin, one-tap adopt action) and evidence that never
 * carries raw content.
 */
import { describe, expect, it } from 'vitest';
import { CONNECTOR_REGISTRY, scanWindowEndingAt, type Connection, type Finding } from '@nibbin/connectors';
import { TEMPLATE_FOR_SCAN_MODULE, getTemplate } from '@nibbin/runtime';
import { ALL_SCAN_MODULES, fixtureReader, modulesForProvider, runScan } from '../src/index';

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
