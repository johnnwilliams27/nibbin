import { describe, expect, it } from "vitest";
import { inputsHash, scoringInputsCanonical } from "../src/hash.js";
import { makeSnapshot } from "./helpers.js";

describe("inputsHash", () => {
  it("is a 64-character lowercase hex sha256 digest", () => {
    const hash = inputsHash(makeSnapshot());
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic for identical input", () => {
    const snapshot = makeSnapshot();
    expect(inputsHash(snapshot)).toBe(inputsHash(snapshot));
  });

  it("changes when a scoring-relevant field changes", () => {
    const a = inputsHash(makeSnapshot({ as_of_block: 1 }));
    const b = inputsHash(makeSnapshot({ as_of_block: 2 }));
    expect(a).not.toBe(b);
  });

  it("is stable across reviewer key insertion order (sorted before hashing)", () => {
    const reviewersA = {
      "0x0000000000000000000000000000000000000b": {
        address: "0x0000000000000000000000000000000000000b" as const,
        first_seen_block: 1,
        first_seen_ts: "2026-01-01T00:00:00Z",
        total_reviews: 1,
        distinct_agents_reviewed: 1,
        max_reviews_single_day: 1,
        funder_address: null,
        portfolio_top_funder_share: "0.0000",
        has_commerce_with_agent: false,
      },
      "0x0000000000000000000000000000000000000a": {
        address: "0x0000000000000000000000000000000000000a" as const,
        first_seen_block: 1,
        first_seen_ts: "2026-01-01T00:00:00Z",
        total_reviews: 1,
        distinct_agents_reviewed: 1,
        max_reviews_single_day: 1,
        funder_address: null,
        portfolio_top_funder_share: "0.0000",
        has_commerce_with_agent: false,
      },
    };
    const reviewersB = {
      "0x0000000000000000000000000000000000000a": reviewersA["0x0000000000000000000000000000000000000a"],
      "0x0000000000000000000000000000000000000b": reviewersA["0x0000000000000000000000000000000000000b"],
    };
    expect(inputsHash(makeSnapshot({ reviewers: reviewersA }))).toBe(inputsHash(makeSnapshot({ reviewers: reviewersB })));
  });

  it("changing only constant provenance prose does not change the hash", () => {
    const snapshot = makeSnapshot();
    const withDifferentProvenance = makeSnapshot({
      constants: {
        ...snapshot.constants,
        shrinkage_k: {
          value: snapshot.constants.shrinkage_k.value,
          provenance: { provisional: false, tuning_run: "run-123", basis: "a different rationale entirely" },
        },
      },
    });
    expect(inputsHash(snapshot)).toBe(inputsHash(withDifferentProvenance));
  });

  it("changing a constant VALUE does change the hash", () => {
    const snapshot = makeSnapshot();
    const withDifferentValue = makeSnapshot({
      constants: {
        ...snapshot.constants,
        shrinkage_k: { ...snapshot.constants.shrinkage_k, value: "6.00" },
      },
    });
    expect(inputsHash(snapshot)).not.toBe(inputsHash(withDifferentValue));
  });

  it("snapshot_version is excluded: changing it does not change the hash", () => {
    const snapshot = makeSnapshot();
    const canonicalBase = scoringInputsCanonical(snapshot);
    expect(canonicalBase.includes("snapshot_version")).toBe(false);
  });

  it("includes validation and commerce records in the canonical form", () => {
    const snapshot = makeSnapshot({
      validations: [
        {
          request_hash: "0x01",
          validator_address: "0x0000000000000000000000000000000000000c",
          response: 1,
          tag: "tee-attestation",
          last_update_block: 10,
          ts: "2026-01-01T00:00:00Z",
        },
      ],
      commerce: [
        {
          counterparty: "0x0000000000000000000000000000000000000d",
          outcome: "completed",
          ts: "2026-01-02T00:00:00Z",
          block: 11,
        },
      ],
    });
    const canonical = scoringInputsCanonical(snapshot);
    expect(canonical).toContain("tee-attestation");
    expect(canonical).toContain("completed");
    expect(inputsHash(snapshot)).not.toBe(inputsHash(makeSnapshot()));
  });
});
