/**
 * Event decoding for the Identity Registry and Reputation Registry (SPEC
 * 10.3, 10.3-adjacent feedback events). Each decoder takes a RawLog and
 * returns a typed, chain-agnostic record, or null when the log's topic0 does
 * not match. ABI shapes are verified against the deployed Base contracts (see
 * abi.ts and scripts/verify-abi.mts).
 *
 * Events the registries emit but scoring does not consume (MetadataSet,
 * ResponseAppended, and the ERC-4906 metadata-update events) decode to a
 * `kind: "ignored"` record rather than null, so an unrecognised log stays
 * distinguishable from a recognised one that carries no scoring signal.
 */
import { decodeEventLog, encodeEventTopics } from "viem";
import type { RawLog } from "./chainSource.js";
import {
  ADMIN_EVENTS,
  ERC721_TRANSFER_EVENT,
  FEEDBACK_REVOKED_EVENT,
  IDENTITY_REGISTRY_ABI,
  METADATA_SET_EVENT,
  NEW_FEEDBACK_EVENT,
  REGISTERED_EVENT,
  REPUTATION_REGISTRY_ABI,
  RESPONSE_APPENDED_EVENT,
  URI_UPDATED_EVENT,
} from "./abi.js";

function topic0(event: Parameters<typeof encodeEventTopics>[0]["abi"][number]): string {
  const topics = encodeEventTopics({ abi: [event], eventName: (event as { name: string }).name });
  const t = topics[0];
  if (typeof t !== "string") throw new Error("encodeEventTopics returned no concrete topic0");
  return t;
}

export const TOPIC0 = {
  registered: topic0(REGISTERED_EVENT),
  uriUpdated: topic0(URI_UPDATED_EVENT),
  metadataSet: topic0(METADATA_SET_EVENT),
  transfer: topic0(ERC721_TRANSFER_EVENT),
  newFeedback: topic0(NEW_FEEDBACK_EVENT),
  feedbackRevoked: topic0(FEEDBACK_REVOKED_EVENT),
  responseAppended: topic0(RESPONSE_APPENDED_EVENT),
} as const;

/**
 * topic0 -> event name for the events both registries emit that scoring does
 * not consume. Kept as a lookup so a recognised-but-unused log names itself in
 * the ignored record rather than arriving as an anonymous topic.
 */
const ADMIN_TOPICS: ReadonlyMap<string, string> = new Map(
  ADMIN_EVENTS.map((e) => [topic0(e).toLowerCase(), e.name] as const),
);

export type DecodedRegistered = {
  kind: "registered";
  agentId: string;
  owner: string;
  tokenUri: string;
  log: RawLog;
};

export type DecodedUriUpdated = {
  kind: "uriUpdated";
  agentId: string;
  tokenUri: string;
  /** The address that performed the update. Not always the owner. */
  updatedBy: string;
  log: RawLog;
};

export type DecodedTransfer = {
  kind: "transfer";
  from: string;
  to: string;
  agentId: string;
  log: RawLog;
};

/** A log this package recognises but scoring does not consume. */
export type DecodedIgnored = {
  kind: "ignored";
  event: string;
  log: RawLog;
};

export type IdentityEvent = DecodedRegistered | DecodedUriUpdated | DecodedTransfer | DecodedIgnored;

/** Decode one Identity Registry log. Returns null when topic0 matches none of the known events. */
export function decodeIdentityLog(log: RawLog): IdentityEvent | null {
  const t0 = log.topics[0];
  if (t0 === undefined) return null;
  const args = { abi: IDENTITY_REGISTRY_ABI, data: log.data as `0x${string}`, topics: log.topics as [`0x${string}`, ...`0x${string}`[]] };
  if (t0.toLowerCase() === TOPIC0.registered.toLowerCase()) {
    const d = decodeEventLog({ ...args, eventName: "Registered" });
    const a = d.args as unknown as { agentId: bigint; owner: string; agentURI: string };
    return { kind: "registered", agentId: a.agentId.toString(), owner: a.owner.toLowerCase(), tokenUri: a.agentURI, log };
  }
  if (t0.toLowerCase() === TOPIC0.uriUpdated.toLowerCase()) {
    const d = decodeEventLog({ ...args, eventName: "URIUpdated" });
    const a = d.args as unknown as { agentId: bigint; newURI: string; updatedBy: string };
    return {
      kind: "uriUpdated",
      agentId: a.agentId.toString(),
      tokenUri: a.newURI,
      updatedBy: a.updatedBy.toLowerCase(),
      log,
    };
  }
  if (t0.toLowerCase() === TOPIC0.transfer.toLowerCase()) {
    const d = decodeEventLog({ ...args, eventName: "Transfer" });
    const a = d.args as unknown as { from: string; to: string; tokenId: bigint };
    return { kind: "transfer", from: a.from.toLowerCase(), to: a.to.toLowerCase(), agentId: a.tokenId.toString(), log };
  }
  if (t0.toLowerCase() === TOPIC0.metadataSet.toLowerCase()) {
    return { kind: "ignored", event: "MetadataSet", log };
  }
  const admin = ADMIN_TOPICS.get(t0.toLowerCase());
  if (admin !== undefined) return { kind: "ignored", event: admin, log };
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

export type ReputationEvent = DecodedNewFeedback | DecodedFeedbackRevoked | DecodedIgnored;

/** Decode one Reputation Registry log. Returns null when topic0 matches no known event. */
export function decodeReputationLog(log: RawLog): ReputationEvent | null {
  const t0 = log.topics[0];
  if (t0 === undefined) return null;
  const args = { abi: REPUTATION_REGISTRY_ABI, data: log.data as `0x${string}`, topics: log.topics as [`0x${string}`, ...`0x${string}`[]] };
  if (t0.toLowerCase() === TOPIC0.newFeedback.toLowerCase()) {
    const d = decodeEventLog({ ...args, eventName: "NewFeedback" });
    // indexedTag1 is a dynamic type marked indexed, so viem hands it back as
    // the keccak of tag1 rather than as text. The readable tag is tag1.
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
      clientAddress: a.clientAddress.toLowerCase(),
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
      clientAddress: a.clientAddress.toLowerCase(),
      feedbackIndex: Number(a.feedbackIndex),
      log,
    };
  }
  if (t0.toLowerCase() === TOPIC0.responseAppended.toLowerCase()) {
    return { kind: "ignored", event: "ResponseAppended", log };
  }
  const admin = ADMIN_TOPICS.get(t0.toLowerCase());
  if (admin !== undefined) return { kind: "ignored", event: admin, log };
  return null;
}
