import { describe, expect, it } from "vitest";
import {
  AGENT_URI_UPDATED_EVENT,
  ERC721_TRANSFER_EVENT,
  FEEDBACK_REVOKED_EVENT,
  NEW_FEEDBACK_EVENT,
  REGISTERED_EVENT,
} from "./abi.js";
import { decodeIdentityLog, decodeReputationLog } from "./decode.js";
import { encodeLog } from "../test/encode.js";

const ctx = { blockNumber: 100, blockHash: "0xblock", transactionHash: "0xtx", logIndex: 0 };

describe("decodeIdentityLog", () => {
  it("decodes Registered", () => {
    const log = encodeLog(
      REGISTERED_EVENT,
      { agentId: 42n, owner: "0x00000000000000000000000000000000000abc", tokenURI: "ipfs://cid" },
      ctx,
    );
    const decoded = decodeIdentityLog(log);
    expect(decoded).toEqual({
      kind: "registered",
      agentId: "42",
      owner: "0x00000000000000000000000000000000000abc",
      tokenUri: "ipfs://cid",
      log,
    });
  });

  it("decodes AgentURIUpdated", () => {
    const log = encodeLog(AGENT_URI_UPDATED_EVENT, { agentId: 7n, tokenURI: "ipfs://new" }, ctx);
    const decoded = decodeIdentityLog(log);
    expect(decoded).toEqual({ kind: "agentUriUpdated", agentId: "7", tokenUri: "ipfs://new", log });
  });

  it("decodes Transfer, including mint (from the zero address)", () => {
    const log = encodeLog(
      ERC721_TRANSFER_EVENT,
      {
        from: "0x0000000000000000000000000000000000000000",
        to: "0x00000000000000000000000000000000000abc",
        tokenId: 9003n,
      },
      ctx,
    );
    const decoded = decodeIdentityLog(log);
    expect(decoded).toEqual({
      kind: "transfer",
      from: "0x0000000000000000000000000000000000000000",
      to: "0x00000000000000000000000000000000000abc",
      agentId: "9003",
      log,
    });
  });

  it("returns null for an unrecognized topic0", () => {
    const log = { ...encodeLog(REGISTERED_EVENT, { agentId: 1n, owner: "0x0", tokenURI: "" }, ctx) };
    const mutated = { ...log, topics: ["0xdeadbeef", ...log.topics.slice(1)] };
    expect(decodeIdentityLog(mutated)).toBeNull();
  });

  it("returns null for a log with no topics", () => {
    expect(decodeIdentityLog({ ...encodeLog(REGISTERED_EVENT, { agentId: 1n, owner: "0x0", tokenURI: "" }, ctx), topics: [] })).toBeNull();
  });
});

describe("decodeReputationLog", () => {
  it("decodes NewFeedback with the raw int128 value preserved as a decimal string", () => {
    const log = encodeLog(
      NEW_FEEDBACK_EVENT,
      {
        agentId: 9003n,
        clientAddress: "0x0000000000000000000000000000000000001001",
        feedbackIndex: 0n,
        value: 5n,
        valueDecimals: 0,
        tag1: "code-review",
        tag2: "",
        endpoint: "",
        feedbackURI: "",
        feedbackHash: `0x${"0".repeat(64)}`,
      },
      ctx,
    );
    const decoded = decodeReputationLog(log);
    expect(decoded).toMatchObject({
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
        agentId: 1n,
        clientAddress: "0x0000000000000000000000000000000000001001",
        feedbackIndex: 3n,
        value: -170141183460469231731687303715884105728n,
        valueDecimals: 0,
        tag1: "",
        tag2: "",
        endpoint: "",
        feedbackURI: "",
        feedbackHash: `0x${"0".repeat(64)}`,
      },
      ctx,
    );
    const decoded = decodeReputationLog(log);
    expect(decoded).toMatchObject({ valueRaw: "-170141183460469231731687303715884105728" });
  });

  it("decodes FeedbackRevoked", () => {
    const log = encodeLog(
      FEEDBACK_REVOKED_EVENT,
      { agentId: 9003n, clientAddress: "0x0000000000000000000000000000000000001001", feedbackIndex: 2n },
      ctx,
    );
    expect(decodeReputationLog(log)).toEqual({
      kind: "feedbackRevoked",
      agentId: "9003",
      clientAddress: "0x0000000000000000000000000000000000001001",
      feedbackIndex: 2,
      log,
    });
  });

  it("returns null for an unrecognized topic0", () => {
    const log = encodeLog(
      NEW_FEEDBACK_EVENT,
      {
        agentId: 1n,
        clientAddress: "0x0000000000000000000000000000000000001001",
        feedbackIndex: 0n,
        value: 1n,
        valueDecimals: 0,
        tag1: "",
        tag2: "",
        endpoint: "",
        feedbackURI: "",
        feedbackHash: `0x${"0".repeat(64)}`,
      },
      ctx,
    );
    expect(decodeReputationLog({ ...log, topics: ["0xdeadbeef", ...log.topics.slice(1)] })).toBeNull();
  });
});
