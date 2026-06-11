/**
 * The connector interface M4's scan engine and agent runtime consume.
 *
 * SPEC §4.4: scan modules are pure functions
 *   (connection, 90-day window) → findings[]
 * Each finding carries a plain-language insight, a quantified cost, the
 * Nibbin that fixes it, and a one-tap adopt action. Deterministic where
 * possible — T1 synthesis only rephrases, with strict structured output.
 */
import type { QuarantinedContent } from './quarantine';

/** Mirror of public.connections (M3 migration). token_ref is a vault uuid — C9. */
export interface Connection {
  id: string;
  accountId: string;
  provider: string;
  method: 'A' | 'H' | 'G';
  scopes: string[];
  status: 'pending' | 'active' | 'paused' | 'error' | 'revoked';
  tokenRef: string | null;
  webhookState: Record<string, unknown>;
  createdBy: string | null;
  createdAt: string;
  revokedAt: string | null;
}

/** The 90-day read-only lookback every scan module computes over. */
export interface ScanWindow {
  /** inclusive, epoch ms */
  startMs: number;
  /** exclusive, epoch ms */
  endMs: number;
}

export const SCAN_WINDOW_DAYS = 90;

export function scanWindowEndingAt(endMs: number): ScanWindow {
  return { startMs: endMs - SCAN_WINDOW_DAYS * 86_400_000, endMs };
}

/** Quantified cost of a finding — at least one dimension must be present. */
export interface QuantifiedCost {
  hoursPerWeek?: number;
  dollarsPerMonth?: number;
  /** raw counts backing the estimate, for the card's "show the math" */
  basis: string;
}

export interface Finding {
  /** scan module id that produced this */
  module: string;
  connectionId: string;
  /** plain-language insight — brand voice applied at synthesis, not here */
  insight: string;
  cost: QuantifiedCost;
  /** shop Nibbin key that fixes it (e.g. 'echo', 'penny', 'scout') */
  recommendedNibbin: string;
  /** one-tap adopt payload the Agent Shop understands */
  adoptAction: { specTemplateKey: string; requiredConnectors: string[] };
  /** deterministic evidence rows (ids/dates/counts), never raw content */
  evidence?: Record<string, unknown>;
}

/**
 * Read-only resource access a scan module gets. Implementations wrap the
 * provider clients in this package; every byte of external content arrives
 * quarantined (data, never instructions — §6.5).
 */
export interface ScanResourceReader {
  /** Provider-relative GET, e.g. '/gmail/v1/users/me/messages?q=...'. */
  read(path: string): Promise<QuarantinedContent>;
}

export interface ScanContext {
  connection: Connection;
  window: ScanWindow;
  reader: ScanResourceReader;
}

/** A §4.4 scan module. Pure: no side effects, no model calls. */
export interface ScanModule {
  id: string;
  /** provider ids this module can run against (registry scanModules is the inverse index) */
  providers: string[];
  run(ctx: ScanContext): Promise<Finding[]>;
}

/**
 * What the M4 runtime needs from a connector to execute capabilities.
 * Side-effect gating (Agent School stage) lives in the runtime, NOT here —
 * but send-capable methods still pass the velocity limiter unconditionally.
 */
export interface ConnectorClient {
  readonly provider: string;
  readonly connection: Connection;
  /** Read a provider resource; result is quarantined external data. */
  read(path: string): Promise<QuarantinedContent>;
}
