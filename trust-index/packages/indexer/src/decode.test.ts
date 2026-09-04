/**
 * Decoder tests.
 *
 * Two layers, deliberately. The round-trip tests encode with the committed ABI
 * and decode with the same one, which checks the decoder's own logic but is
 * blind to a wrong ABI: an earlier version of abi.ts was wrong in all five
 * events and this file passed anyway.
 *
 * So the layer that matters is the ground-truth block: real logs captured from
 * the deployed Base registries, decoded here. Those cannot pass unless the
 * committed definitions match the contracts. The pinned topic0 values are the
 * cheap version of the same check, catching a signature edit without needing
 * the network.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ERC721_TRANSFER_EVENT,
  FEEDBACK_REVOKED_EVENT,
  METADATA_SET_EVENT,
  NEW_FEEDBACK_EVENT,
  REGISTERED_EVENT,
  RESPONSE_APPENDED_EVENT,
  URI_UPDATED_EVENT,
} from "./abi.js";
import { decodeIdentityLog, decodeReputationLog, TOPIC0 } from "./decode.js";
import { encodeLog } from "../test/encode.js";
import type { RawLog } from "./chainSource.js";

const ctx = { blockNumber: 100, blockHash: "0xblock", transactionHash: "0xtx", logIndex: 0 };

describe("event signatures", () => {
  /**
   * Observed on Base mainnet (chain 8453) on 2026-09-04, cross-checked against
   * the Sourcify-verified implementation ABIs behind both registry proxies. A
   * change to any event definition changes its topic0 and fails here, which is
   * the point: a wrong signature matches no log and the indexer reports an
   * empty chain rather than an error.
   */
  it("matches the topic0 values the deployed registries emit", () => {
    expect(TOPIC0.registered).toBe("0xca52e62c367d81bb2e328eb795f7c7ba24afb478408a26c0e201d155c449bc4a");
    expect(TOPIC0.uriUpdated).toBe("0x3a2c7fffc2cba7582c690e3b82c453ea02a308326a98a3ad7576c606336409fb");
    expect(TOPIC0.metadataSet).toBe("0x2c149ed548c6d2993cd73efe187df6eccabe4538091b33adbd25fafdb8a1468b");
    expect(TOPIC0.transfer).toBe("0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef");
    expect(TOPIC0.newFeedback).toBe("0x6a4a61743519c9d648a14e6493f47dbe3ff1aa29e7785c96c8326a205e58febc");
    expect(TOPIC0.feedbackRevoked).toBe("0x25156fd3288212246d8b008d5921fde376c71ed14ac2e072a506eb06fde6d09d");
    expect(TOPIC0.responseAppended).toBe("0xb1c6be0b5b8aef6539e2fac0fd131a2faa7b49edf8e505b5eb0ad487d56051d4");
  });
});

describe("decoding logs captured from the deployed registries", () => {
  type CapturedLog = {
    address: string;
    topics: string[];
    data: string;
    blockNumber: string;
    blockHash: string;
    transactionHash: string;
    logIndex: string;
  };
  const captured = JSON.parse(
    readFileSync(fileURLToPath(new URL("../test/fixtures/live-base-logs.json", import.meta.url)), "utf8"),
  ) as Record<string, CapturedLog>;

  function toRawLog(c: CapturedLog): RawLog {
    return {
      address: c.address,
      topics: c.topics,
      data: c.data,
      blockNumber: Number(c.blockNumber),
      blockHash: c.blockHash,
      transactionHash: c.transactionHash,
      logIndex: Number(c.logIndex),
    };
  }

  it("decodes a real Registered log", () => {
    const decoded = decodeIdentityLog(toRawLog(captured.registered!));
    expect(decoded?.kind).toBe("registered");
    const r = decoded as { agentId: string; owner: string; tokenUri: string };
    expect(r.agentId).toMatch(/^\d+$/);
    expect(r.owner).toMatch(/^0x[0-9a-f]{40}$/);
    // The URI is the field the wrong ABI got wrong: with the address and the
    // string transposed the decode either throws or yields an address here.
    expect(typeof r.tokenUri).toBe("string");
    expect(r.tokenUri).not.toMatch(/^0x[0-9a-f]{40}$/);
  });

  it("decodes a real URIUpdated log", () => {
    const decoded = decodeIdentityLog(toRawLog(captured.uriUpdated!));
    expect(decoded?.kind).toBe("uriUpdated");
    const r = decoded as { agentId: string; tokenUri: string; updatedBy: string };
    expect(r.agentId).toMatch(/^\d+$/);
    expect(r.updatedBy).toMatch(/^0x[0-9a-f]{40}$/);
    expect(r.tokenUri.length).toBeGreaterThan(0);
  });

  it("decodes a real Transfer log", () => {
    const decoded = decodeIdentityLog(toRawLog(captured.transfer!));
    expect(decoded?.kind).toBe("transfer");
    const r = decoded as { from: string; to: string; agentId: string };
    expect(r.from).toMatch(/^0x[0-9a-f]{40}$/);
    expect(r.to).toMatch(/^0x[0-9a-f]{40}$/);
    expect(r.agentId).toMatch(/^\d+$/);
  });

  it("decodes a real NewFeedback log, keeping the raw int128 as a decimal string", () => {
    const decoded = decodeReputationLog(toRawLog(captured.newFeedback!));
    expect(decoded?.kind).toBe("newFeedback");
    const r = decoded as {
      agentId: string;
      clientAddress: string;
      feedbackIndex: number;
      valueRaw: string;
      valueDecimals: number;
      tag1: string;
      feedbackHash: string;
    };
    expect(r.agentId).toMatch(/^\d+$/);
    expect(r.clientAddress).toMatch(/^0x[0-9a-f]{40}$/);
    expect(Number.isInteger(r.feedbackIndex)).toBe(true);
    expect(r.valueRaw).toMatch(/^-?\d+$/);
    expect(r.valueDecimals).toBeGreaterThanOrEqual(0);
    expect(r.feedbackHash).toMatch(/^0x[0-9a-f]{64}$/);
    // tag1 is the readable tag. The indexed copy of it is a keccak hash and
    // must not be what lands here.
    expect(r.tag1).not.toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe("decodeIdentityLog", () => {
  it("decodes Registered", () => {
    const log = encodeLog(
      REGISTERED_EVENT,
      { agentId: 42n, owner: "0x000000000000000000000000000000000000abc1", agentURI: "ipfs://cid" },
      ctx,
    );
    expect(decodeIdentityLog(log)).toEqual({
      kind: "registered",
      agentId: "42",
      owner: "0x000000000000000000000000000000000000abc1",
      tokenUri: "ipfs://cid",
      log,
    });
  });

  it("decodes URIUpdated, keeping the updating address", () => {
    const log = encodeLog(
      URI_UPDATED_EVENT,
      { agentId: 7n, newURI: "ipfs://new", updatedBy: "0x000000000000000000000000000000000000abc2" },
      ctx,
    );
    expect(decodeIdentityLog(log)).toEqual({
      kind: "uriUpdated",
      agentId: "7",
      tokenUri: "ipfs://new",
      updatedBy: "0x000000000000000000000000000000000000abc2",
      log,
    });
  });

  it("decodes Transfer, including mint (from the zero address)", () => {
    const log = encodeLog(
      ERC721_TRANSFER_EVENT,
      {
        from: "0x0000000000000000000000000000000000000000",
        to: "0x000000000000000000000000000000000000abc1",
        tokenId: 9003n,
      },
      ctx,
    );
    expect(decodeIdentityLog(log)).toEqual({
      kind: "transfer",
      from: "0x0000000000000000000000000000000000000000",
      to: "0x000000000000000000000000000000000000abc1",
      agentId: "9003",
      log,
    });
  });

  it("marks MetadataSet as recognised but unused, rather than unknown", () => {
    const log = encodeLog(
      METADATA_SET_EVENT,
      { agentId: 1n, indexedMetadataKey: "k", metadataKey: "k", metadataValue: "0x00" },
      ctx,
    );
    expect(decodeIdentityLog(log)).toEqual({ kind: "ignored", event: "MetadataSet", log });
  });

  it("returns null for an unrecognized topic0", () => {
    const log = encodeLog(
      REGISTERED_EVENT,
      { agentId: 1n, owner: "0x0000000000000000000000000000000000000000", agentURI: "" },
      ctx,
    );
    expect(decodeIdentityLog({ ...log, topics: ["0xdeadbeef", ...log.topics.slice(1)] })).toBeNull();
  });

  it("returns null for a log with no topics", () => {
    const log = encodeLog(
      REGISTERED_EVENT,
      { agentId: 1n, owner: "0x0000000000000000000000000000000000000000", agentURI: "" },
      ctx,
    );
    expect(decodeIdentityLog({ ...log, topics: [] })).toBeNull();
  });
});

describe("decodeReputationLog", () => {
  const feedbackArgs = {
    agentId: 9003n,
    clientAddress: "0x0000000000000000000000000000000000001001",
    feedbackIndex: 0n,
    value: 5n,
    valueDecimals: 0,
    indexedTag1: "code-review",
    tag1: "code-review",
    tag2: "",
    endpoint: "",
    feedbackURI: "",
    feedbackHash: `0x${"0".repeat(64)}`,
  };

  it("decodes NewFeedback with the raw int128 value preserved as a decimal string", () => {
    const log = encodeLog(NEW_FEEDBACK_EVENT, feedbackArgs, ctx);
    expect(decodeReputationLog(log)).toMatchObject({
      kind: "newFeedback",
      agentId: "9003",
      clientAddress: "0x0000000000000000000000000000000000001001",
      feedbackIndex: 0,
      valueRaw: "5",
      valueDecimals: 0,
      tag1: "code-review",
    });
  });

  it("decodes a negative int128 value without precision loss", () => {
    const log = encodeLog(
      NEW_FEEDBACK_EVENT,
      {
        ...feedbackArgs,
        agentId: 1n,
        feedbackIndex: 3n,
        value: -170141183460469231731687303715884105728n,
        indexedTag1: "",
        tag1: "",
      },
      ctx,
    );
    expect(decodeReputationLog(log)).toMatchObject({
      valueRaw: "-170141183460469231731687303715884105728",
    });
  });

  it("decodes a feedbackIndex at the uint64 maximum", () => {
    // feedbackIndex is uint64, not the uint256 an earlier ABI assumed. Nothing
    // in the decoder should narrow it before the Number() conversion.
    const log = encodeLog(NEW_FEEDBACK_EVENT, { ...feedbackArgs, feedbackIndex: 2n ** 53n - 1n }, ctx);
    expect(decodeReputationLog(log)).toMatchObject({ feedbackIndex: Number(2n ** 53n - 1n) });
  });

  it("decodes FeedbackRevoked, whose parameters are all indexed", () => {
    const log = encodeLog(
      FEEDBACK_REVOKED_EVENT,
      { agentId: 9003n, clientAddress: "0x0000000000000000000000000000000000001001", feedbackIndex: 2n },
      ctx,
    );
    expect(log.data).toBe("0x");
    expect(decodeReputationLog(log)).toEqual({
      kind: "feedbackRevoked",
      agentId: "9003",
      clientAddress: "0x0000000000000000000000000000000000001001",
      feedbackIndex: 2,
      log,
    });
  });

  it("marks ResponseAppended as recognised but unused", () => {
    const log = encodeLog(
      RESPONSE_APPENDED_EVENT,
      {
        agentId: 1n,
        clientAddress: "0x0000000000000000000000000000000000001001",
        feedbackIndex: 0n,
        responder: "0x0000000000000000000000000000000000001002",
        responseURI: "ipfs://r",
        responseHash: `0x${"0".repeat(64)}`,
      },
      ctx,
    );
    expect(decodeReputationLog(log)).toEqual({ kind: "ignored", event: "ResponseAppended", log });
  });

  it("returns null for an unrecognized topic0", () => {
    const log = encodeLog(NEW_FEEDBACK_EVENT, feedbackArgs, ctx);
    expect(decodeReputationLog({ ...log, topics: ["0xdeadbeef", ...log.topics.slice(1)] })).toBeNull();
  });
});
