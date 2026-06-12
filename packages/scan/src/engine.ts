/**
 * The connector scan engine (§4.4): runs every applicable module over each
 * active connection's 90-day window, streams findings, and signals the
 * scan_empty → Keeper interview fallback (§6.12 cold start) when nothing
 * meaningful surfaced. Recomputes are cheap and deterministic — the weekly
 * recompute (§4.4) is just calling this again.
 */
import {
  CONNECTOR_REGISTRY,
  scanWindowEndingAt,
  type Connection,
  type Finding,
  type QuarantinedContent,
  type ScanModule,
  type ScanResourceReader,
} from '@nibbin/connectors';
import { CALENDAR_MODULES } from './modules/calendar';
import { CRM_MODULES } from './modules/crm';
import { DM_MODULES } from './modules/dm';
import { EMAIL_MODULES } from './modules/email';
import { PAYMENTS_MODULES } from './modules/payments';

export const ALL_SCAN_MODULES: readonly ScanModule[] = [
  ...EMAIL_MODULES,
  ...CALENDAR_MODULES,
  ...PAYMENTS_MODULES,
  ...CRM_MODULES,
  ...DM_MODULES,
];

export interface ReaderFactory {
  /** Build a read-only resource reader for an active connection. */
  forConnection(connection: Connection): Promise<ScanResourceReader>;
}

export interface ScanRunResult {
  findings: Finding[];
  /** true → emit scan_empty and fall back to the Keeper interview (§6.12). */
  empty: boolean;
  /** Connections that errored (provider down, token expired) — never fatal. */
  failures: Array<{ connectionId: string; module: string; error: string }>;
  scannedConnections: number;
}

/** Same-path reads within one scan are memoized — modules share fetches. */
function memoize(reader: ScanResourceReader): ScanResourceReader {
  const cache = new Map<string, Promise<QuarantinedContent>>();
  return {
    read(path: string) {
      let hit = cache.get(path);
      if (!hit) {
        hit = reader.read(path);
        cache.set(path, hit);
      }
      return hit;
    },
  };
}

export function modulesForProvider(provider: string): ScanModule[] {
  const descriptor = CONNECTOR_REGISTRY.get(provider);
  if (!descriptor) return [];
  return ALL_SCAN_MODULES.filter(
    (m) => m.providers.includes(provider) && descriptor.scanModules.includes(m.id),
  );
}

export async function runScan(
  connections: Connection[],
  readers: ReaderFactory,
  nowMs: number,
): Promise<ScanRunResult> {
  const window = scanWindowEndingAt(nowMs);
  const findings: Finding[] = [];
  const failures: ScanRunResult['failures'] = [];
  let scanned = 0;

  for (const connection of connections) {
    if (connection.status !== 'active') continue; // revoked/paused are unusable everywhere
    const modules = modulesForProvider(connection.provider);
    if (modules.length === 0) continue;
    scanned += 1;

    let reader: ScanResourceReader;
    try {
      reader = memoize(await readers.forConnection(connection));
    } catch (e) {
      failures.push({
        connectionId: connection.id,
        module: '*',
        error: e instanceof Error ? e.message : String(e),
      });
      continue;
    }

    for (const module of modules) {
      try {
        findings.push(...(await module.run({ connection, window, reader })));
      } catch (e) {
        // one bad provider response never sinks the scan
        failures.push({
          connectionId: connection.id,
          module: module.id,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  return { findings, empty: findings.length === 0, failures, scannedConnections: scanned };
}
