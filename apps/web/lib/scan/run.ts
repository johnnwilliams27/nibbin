import 'server-only';

/**
 * Account scan execution (§4.4): run every applicable module over the
 * account's active connections, persist findings as scan_results, emit
 * scan_completed / scan_empty (§6.12). The scan is deterministic and cheap —
 * recomputes are just calling this again.
 *
 * Seeded dev accounts (NIBBIN_DEV_SEED=1, non-production) get fixture
 * connections so §4.1 steps 4–7 are playable end to end with synthetic data
 * only (AGREEMENTS: staging never sees real data).
 */
import { randomUUID } from 'node:crypto';
import type { Finding } from '@nibbin/connectors';
import { runScan } from '@nibbin/scan';
import { serviceClient } from '../supabase/service';
import { SupabaseEventSink } from '../runtime/stores';
import { activeConnections, connectionFromRow, devSeedEnabled, readerForConnection } from '../runtime/engine';

// Dev-fixture intentional mismatch: gmail + google-calendar are method:'N' in
// production (registry) but seeded as 'H' here so readerForConnection falls
// through to fixtureReader (token_ref=null + devSeedEnabled). Seeding 'N' with
// a null nango_connection_id would cause makeGmailClient to throw. The seed is
// non-production only (NIBBIN_DEV_SEED=1) and never touches real OAuth tokens.
const SEED_PROVIDERS: Array<{ provider: string; method: 'A' | 'H' | 'G' }> = [
  { provider: 'gmail', method: 'H' },
  { provider: 'google-calendar', method: 'H' },
  { provider: 'stripe', method: 'H' },
  { provider: 'pixieset', method: 'H' },
];

/** Idempotently seed fixture connections for a dev account. */
export async function seedDevConnections(accountId: string): Promise<void> {
  if (!devSeedEnabled()) throw new Error('dev seed is disabled');
  const svc = serviceClient();
  const existing = await activeConnections(svc, accountId);
  const have = new Set(existing.map((c) => c.provider));
  for (const seed of SEED_PROVIDERS) {
    if (have.has(seed.provider)) continue;
    const { error } = await svc.from('connections').insert({
      account_id: accountId,
      provider: seed.provider,
      method: seed.method,
      scopes: [],
      status: 'active',
      token_ref: null, // null token + dev flag → fixture reader
    });
    if (error) throw new Error(`seeding ${seed.provider} failed: ${error.message}`);
  }
}

export interface AccountScanResult {
  findings: Finding[];
  empty: boolean;
  batchId: string;
  scannedConnections: number;
}

/** The connector scan recomputes weekly (§4.4) and is cheap — but it is free
 *  compute over real provider quota, so we don't let it be looped. One real
 *  recompute per account per hour; inside the window we serve the cached latest
 *  batch (cost-auditor P2-1 — "free diagnosis is compute someone will farm"). */
const SCAN_MIN_INTERVAL_MS = 60 * 60 * 1000;

export async function runAccountScan(accountId: string, userId?: string): Promise<AccountScanResult> {
  const svc = serviceClient();
  const events = new SupabaseEventSink(svc);
  const nowMs = Date.now();

  const { data: lastBatch } = await svc
    .from('scan_results')
    .select('batch_id, computed_at')
    .eq('account_id', accountId)
    .neq('module', 'interview.manual-map')
    .order('computed_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastBatch && nowMs - Date.parse(lastBatch.computed_at as string) < SCAN_MIN_INTERVAL_MS) {
    const cached = await latestFindings(accountId);
    return {
      findings: cached,
      empty: cached.length === 0,
      batchId: lastBatch.batch_id as string,
      scannedConnections: (await activeConnections(svc, accountId)).length,
    };
  }

  const connections = await activeConnections(svc, accountId);
  const result = await runScan(
    connections,
    { forConnection: async (c) => readerForConnection(c, nowMs) },
    nowMs,
  );

  const batchId = randomUUID();
  if (result.findings.length > 0) {
    const { error } = await svc.from('scan_results').insert(
      result.findings.map((f) => ({
        account_id: accountId,
        connection_id: f.connectionId,
        batch_id: batchId,
        module: f.module,
        finding: f as unknown as Record<string, unknown>,
      })),
    );
    if (error) throw new Error(`scan_results insert failed: ${error.message}`);
  }

  await events.emit(
    result.empty
      ? { name: 'scan_empty', accountId, userId, props: { connections: result.scannedConnections } }
      : {
          name: 'scan_completed',
          accountId,
          userId,
          props: { findings: result.findings.length, connections: result.scannedConnections },
        },
  );

  return {
    findings: result.findings,
    empty: result.empty,
    batchId,
    scannedConnections: result.scannedConnections,
  };
}

/** Latest persisted findings (newest batch), for shop ranking and re-renders. */
export async function latestFindings(accountId: string): Promise<Finding[]> {
  const svc = serviceClient();
  const { data, error } = await svc
    .from('scan_results')
    .select('batch_id, finding, computed_at')
    .eq('account_id', accountId)
    .neq('module', 'interview.manual-map') // shop findings only, not the interview map
    .order('computed_at', { ascending: false })
    .limit(50);
  if (error || !data || data.length === 0) return [];
  const newest = data[0].batch_id as string;
  return data.filter((r) => r.batch_id === newest).map((r) => r.finding as unknown as Finding);
}

export { connectionFromRow };
