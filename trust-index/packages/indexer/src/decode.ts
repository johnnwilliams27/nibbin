/**
 * Event decoding for the Identity Registry and Reputation Registry (SPEC
 * 10.3, 10.3-adjacent feedback events). Each decoder takes a RawLog and
 * returns a typed, chain-agnostic record, or null when the log's topic0
 * does not match. ABI shapes are UNVERIFIED (see abi.ts); decoding itself
 * (topic/selector matching, argument layout) is exercised in tests against
 * logs this package encodes with the same ABI, which proves internal
 * consistency, not correctness against the deployed contracts.
 */
import { decodeEventLog, encodeEventTopics } from "viem";
import type { RawLog } from "./chainSource.js";
import {
  AGENT_URI_UPDATED_EVENT,
  ERC721_TRANSFER_EVENT,
  FEEDBACK_REVOKED_EVENT,
  IDENTITY_REGISTRY_ABI,
  NEW_FEEDBACK_EVENT,
  REGISTERED_EVENT,
  REPUTATION_REGISTRY_ABI,
} from "./abi.js";

function topic0(event: Parameters<typeof encodeEventTopics>[0]["abi"][number]): string {
  const topics = encodeEventTopics({ abi: [event], eventName: (event as { name: string }).name });
  const t = topics[0];
  if (t === undefined) throw new Error("encodeEventTopics returned no topic0");
  return t;
}

export const TOPIC0 = {
  registered: topic0(REGISTERED_EVENT),
  agentUriUpdated: topic0(AGENT_URI_UPDATED_EVENT),
  transfer: topic0(ERC721_TRANSFER_EVENT),
  newFeedback: topic0(NEW_FEEDBACK_EVENT),
  feedbackRevoked: topic0(FEEDBACK_REVOKED_EVENT),
} as const;

export type DecodedRegistered = {
  kind: "registered";
  agentId: string;
  owner: string;
  tokenUri: string;
  log: RawLog;
};

export type DecodedAgentUriUpdated = {
  kind: "agentUriUpdated";
  agentId: string;
  tokenUri: string;
  log: RawLog;
};

export type DecodedTransfer = {
  kind: "transfer";
  from: string;
  to: string;
  agentId: string;
  log: RawLog;
};

export type IdentityEvent = DecodedRegistered | DecodedAgentUriUpdated | DecodedTransfer;

/** Decode one Identity Registry log. Returns null when topic0 matches none of the known events. */
export function decodeIdentityLog(log: RawLog): IdentityEvent | null {
  const t0 = log.topics[0];
  if (t0 === undefined) return null;
  const args = { abi: IDENTITY_REGISTRY_ABI, data: log.data as `0x${string}`, topics: log.topics as [`0x${string}`, ...`0x${string}`[]] };
  if (t0.toLowerCase() === TOPIC0.registered.toLowerCase()) {
    const d = decodeEventLog({ ...args, eventName: "Registered" });
    const a = d.args as unknown as { agentId: bigint; owner: string; tokenURI: string };
    return { kind: "registered", agentId: a.agentId.toString(), owner: a.owner, tokenUri: a.tokenURI, log };
  }
  if (t0.toLowerCase() === TOPIC0.agentUriUpdated.toLowerCase()) {
    const d = decodeEventLog({ ...args, eventName: "AgentURIUpdated" });
    const a = d.args as unknown as { agentId: bigint; tokenURI: string };
    return { kind: "agentUriUpdated", agentId: a.agentId.toString(), tokenUri: a.tokenURI, log };
  }
  if (t0.toLowerCase() === TOPIC0.transfer.toLowerCase()) {
    const d = decodeEventLog({ ...args, eventName: "Transfer" });
    const a = d.args as unknown as { from: string; to: string; tokenId: bigint };
    return { kind: "transfer", from: a.from, to: a.to, agentId: a.tokenId.toString(), log };
  }
  return null;
}

export type DecodedNewFeedback = {
  kind: "newFeedback";
  agentId: string;
  clientAddress: string;
  feedbackIndex: number;
  /** Raw int128 as a decimal string; never coerced to a JS number (SPEC 22). */
  valueRaw: string;
  valueDecimals: number;
  tag1: string;
  tag2: string;
  endpoint: string;
  feedbackUri: string;
  feedbackHash: string;
  log: RawLog;
};

export type DecodedFeedbackRevoked = {
  kind: "feedbackRevoked";
  agentId: string;
  clientAddress: string;
  feedbackIndex: number;
  log: RawLog;
};

export type ReputationEvent = DecodedNewFeedback | DecodedFeedbackRevoked;

/** Decode one Reputation Registry log. Returns null when topic0 matches neither known event. */
export function decodeReputationLog(log: RawLog): ReputationEvent | null {
  const t0 = log.topics[0];
  if (t0 === undefined) return null;
  const args = { abi: REPUTATION_REGISTRY_ABI, data: log.data as `0x${string}`, topics: log.topics as [`0x${string}`, ...`0x${string}`[]] };
  if (t0.toLowerCase() === TOPIC0.newFeedback.toLowerCase()) {
    const d = decodeEventLog({ ...args, eventName: "NewFeedback" });
    const a = d.args as unknown as {
      agentId: bigint;
      clientAddress: string;
      feedbackIndex: bigint;
      value: bigint;
      valueDecimals: number;
      tag1: string;
      tag2: string;
      endpoint: string;
      feedbackURI: string;
      feedbackHash: string;
    };
    return {
      kind: "newFeedback",
      agentId: a.agentId.toString(),
      clientAddress: a.clientAddress,
      feedbackIndex: Number(a.feedbackIndex),
      valueRaw: a.value.toString(),
      valueDecimals: a.valueDecimals,
      tag1: a.tag1,
      tag2: a.tag2,
      endpoint: a.endpoint,
      feedbackUri: a.feedbackURI,
      feedbackHash: a.feedbackHash,
      log,
    };
  }
  if (t0.toLowerCase() === TOPIC0.feedbackRevoked.toLowerCase()) {
    const d = decodeEventLog({ ...args, eventName: "FeedbackRevoked" });
    const a = d.args as unknown as { agentId: bigint; clientAddress: string; feedbackIndex: bigint };
    return {
      kind: "feedbackRevoked",
      agentId: a.agentId.toString(),
      clientAddress: a.clientAddress,
      feedbackIndex: Number(a.feedbackIndex),
      log,
    };
  }
  return null;
}
