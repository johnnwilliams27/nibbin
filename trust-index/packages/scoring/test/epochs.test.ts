import { describe, expect, it } from "vitest";
import { inCurrentEpoch, resolveEpoch } from "../src/epochs.js";
import { parseIsoUtcSeconds } from "../src/time.js";
import { makeSnapshot } from "./helpers.js";

describe("resolveEpoch", () => {
  it("no transfers: epoch 0, starts at registration", () => {
    const snapshot = makeSnapshot({ registered_at: "2025-01-01T00:00:00Z", transfers: [] });
    const info = resolveEpoch(snapshot);
    expect(info.epoch).toBe(0);
    expect(info.epochStartBlock).toBeNull();
    expect(info.epochStartSec).toBe(parseIsoUtcSeconds("2025-01-01T00:00:00Z"));
    expect(info.custodyMigrationDetected).toBe(false);
  });

  it("one non-benign transfer resets the epoch", () => {
    const snapshot = makeSnapshot({
      transfers: [
        {
          from_address: "0x0000000000000000000000000000000000000a",
          to_address: "0x0000000000000000000000000000000000000c",
          block: 500,
          ts: "2026-06-01T00:00:00Z",
          tx_hash: "0x01",
        },
      ],
      transfer_linkages: [{ transfer_index: 0, same_funder: false, bidirectional_history: false }],
    });
    const info = resolveEpoch(snapshot);
    expect(info.epoch).toBe(1);
    expect(info.epochStartBlock).toBe(500);
    expect(info.custodyMigrationDetected).toBe(false);
  });

  it("a benign (same_funder) transfer preserves the epoch but flags custody migration", () => {
    const snapshot = makeSnapshot({
      transfers: [
        {
          from_address: "0x0000000000000000000000000000000000000a",
          to_address: "0x0000000000000000000000000000000000000c",
          block: 500,
          ts: "2026-06-01T00:00:00Z",
          tx_hash: "0x01",
        },
      ],
      transfer_linkages: [{ transfer_index: 0, same_funder: true, bidirectional_history: false }],
    });
    const info = resolveEpoch(snapshot);
    expect(info.epoch).toBe(0);
    expect(info.epochStartBlock).toBeNull();
    expect(info.custodyMigrationDetected).toBe(true);
  });

  it("a benign (bidirectional_history) transfer also preserves the epoch", () => {
    const snapshot = makeSnapshot({
      transfers: [
        {
          from_address: "0x0000000000000000000000000000000000000a",
          to_address: "0x0000000000000000000000000000000000000c",
          block: 500,
          ts: "2026-06-01T00:00:00Z",
          tx_hash: "0x01",
        },
      ],
      transfer_linkages: [{ transfer_index: 0, same_funder: false, bidirectional_history: true }],
    });
    expect(resolveEpoch(snapshot).epoch).toBe(0);
  });

  it("mixes benign and resetting transfers, sorted by block regardless of input order", () => {
    const snapshot = makeSnapshot({
      transfers: [
        {
          from_address: "0x0000000000000000000000000000000000000c",
          to_address: "0x0000000000000000000000000000000000000d",
          block: 700,
          ts: "2026-07-01T00:00:00Z",
          tx_hash: "0x02",
        },
        {
          from_address: "0x0000000000000000000000000000000000000a",
          to_address: "0x0000000000000000000000000000000000000c",
          block: 500,
          ts: "2026-06-01T00:00:00Z",
          tx_hash: "0x01",
        },
      ],
      // Index 0 refers to the block-700 transfer (as given, before sorting); it is benign.
      // Index 1 refers to the block-500 transfer; it resets.
      transfer_linkages: [
        { transfer_index: 0, same_funder: true, bidirectional_history: false },
        { transfer_index: 1, same_funder: false, bidirectional_history: false },
      ],
    });
    const info = resolveEpoch(snapshot);
    expect(info.epoch).toBe(1);
    expect(info.epochStartBlock).toBe(500);
    expect(info.custodyMigrationDetected).toBe(true);
  });

  it("breaks same-block ties by tx_hash for determinism", () => {
    const snapshot = makeSnapshot({
      transfers: [
        {
          from_address: "0x0000000000000000000000000000000000000a",
          to_address: "0x0000000000000000000000000000000000000c",
          block: 500,
          ts: "2026-06-01T00:00:00Z",
          tx_hash: "0xbb",
        },
        {
          from_address: "0x0000000000000000000000000000000000000c",
          to_address: "0x0000000000000000000000000000000000000d",
          block: 500,
          ts: "2026-06-01T00:00:00Z",
          tx_hash: "0xaa",
        },
      ],
      transfer_linkages: [],
    });
    const info = resolveEpoch(snapshot);
    // Both reset; the epoch-start transfer is the one sorted last (0xbb after 0xaa).
    expect(info.epoch).toBe(2);
    expect(info.lastResetTs).toBe("2026-06-01T00:00:00Z");
  });
});

describe("inCurrentEpoch", () => {
  it("everything is current epoch when there is no reset", () => {
    expect(inCurrentEpoch(0, { epoch: 0, epochStartSec: 0, epochStartBlock: null, lastResetTs: null, custodyMigrationDetected: false })).toBe(true);
  });

  it("an entry in the same block as the reset is treated as pre-transfer", () => {
    const info = { epoch: 1, epochStartSec: 0, epochStartBlock: 500, lastResetTs: "x", custodyMigrationDetected: false };
    expect(inCurrentEpoch(500, info)).toBe(false);
    expect(inCurrentEpoch(499, info)).toBe(false);
    expect(inCurrentEpoch(501, info)).toBe(true);
  });
});
