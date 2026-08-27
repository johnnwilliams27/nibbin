/**
 * Ownership epochs (SPEC 11.6, UC-2). Every ERC-721 transfer starts a new
 * epoch unless its TransferLinkage marks it as a custody migration
 * (same_funder or bidirectional_history), in which case the epoch is
 * preserved and the linkage is surfaced as a signal.
 */
import type { AgentSnapshot, TransferEvent } from "@trust-index/types";
import { parseIsoUtcSeconds } from "./time.js";

export type EpochInfo = {
  /** Number of epoch-resetting transfers; 0 means the original registrant still holds the identity or only custody migrations occurred. */
  epoch: number;
  /** Epoch start in epoch seconds: the last resetting transfer's ts, or registered_at when none. */
  epochStartSec: number;
  /** Block of the last resetting transfer; null when the epoch starts at registration. */
  epochStartBlock: number | null;
  /** ISO ts of the last resetting transfer; null when never reset. */
  lastResetTs: string | null;
  /** True when at least one transfer was classified as a custody migration. */
  custodyMigrationDetected: boolean;
};

export function resolveEpoch(snapshot: AgentSnapshot): EpochInfo {
  // Linkages refer to indexes in the transfers array as given; capture the
  // benign set before any reordering.
  const benign = new Set<number>();
  for (const linkage of snapshot.transfer_linkages) {
    if (linkage.same_funder || linkage.bidirectional_history) {
      benign.add(linkage.transfer_index);
    }
  }

  // Explicit sort before reduction (SPEC 22); ties broken by tx_hash.
  const indexed = snapshot.transfers.map((t, originalIndex) => ({ t, originalIndex }));
  indexed.sort((a, b) => {
    if (a.t.block !== b.t.block) return a.t.block - b.t.block;
    return a.t.tx_hash < b.t.tx_hash ? -1 : a.t.tx_hash > b.t.tx_hash ? 1 : 0;
  });

  let epoch = 0;
  let lastReset: TransferEvent | null = null;
  let custodyMigrationDetected = false;
  for (const { t, originalIndex } of indexed) {
    if (benign.has(originalIndex)) {
      custodyMigrationDetected = true;
    } else {
      epoch += 1;
      lastReset = t;
    }
  }

  return {
    epoch,
    epochStartSec: parseIsoUtcSeconds(lastReset === null ? snapshot.registered_at : lastReset.ts),
    epochStartBlock: lastReset === null ? null : lastReset.block,
    lastResetTs: lastReset === null ? null : lastReset.ts,
    custodyMigrationDetected,
  };
}

/**
 * True when a feedback entry belongs to the current epoch. An entry in the
 * same block as the resetting transfer is treated as pre-transfer
 * (conservative: reputation laundering is the unrecoverable error).
 */
export function inCurrentEpoch(entryBlock: number, epochInfo: EpochInfo): boolean {
  if (epochInfo.epochStartBlock === null) return true;
  return entryBlock > epochInfo.epochStartBlock;
}
