/**
 * ERC-8004 event ABIs (SPEC section 8).
 *
 * VERIFIED against the deployed registries on Base mainnet (chain 8453) on
 * 2026-09-04. Both registry addresses in @trust-index/types are ERC-1967
 * proxies; their implementations are verified on Sourcify, and these
 * definitions are copied from those published ABIs rather than inferred:
 *
 * - Identity Registry proxy 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432
 *   implementation 0x7274e874ca62410a93bd8bf61c69d8045e399c02
 * - Reputation Registry proxy 0x8004BAa17C55a88189AE136b182e5fdA19dE9b63
 *   implementation 0x16e0fa7f7c56b9a767e34b192b51f921be31da34
 *
 * `scripts/verify-abi.mts` re-derives every topic0 below from the committed
 * definitions and checks it against logs the live registries actually emit, so
 * a drift between this file and the deployed contracts fails a check rather
 * than silently indexing nothing. Run it before any backfill against a chain
 * this file has not been verified against.
 *
 * The previous version of this file was guessed from the SPEC 8 prose, and
 * every one of its five event definitions was wrong: parameter order in
 * Registered, the event name and arity of the URI update, an extra indexed
 * string and a narrower integer in NewFeedback, and an indexed flag in
 * FeedbackRevoked. Because topic0 is the hash of the whole signature, none of
 * them would have matched a single log. The indexer would have run clean and
 * reported an empty chain. That failure mode is why the verification script is
 * committed alongside the definitions.
 */
import type { Abi } from "viem";

/** Standard ERC-721 Transfer, as emitted by the Identity Registry. */
export const ERC721_TRANSFER_EVENT = {
  type: "event",
  name: "Transfer",
  inputs: [
    { name: "from", type: "address", indexed: true },
    { name: "to", type: "address", indexed: true },
    { name: "tokenId", type: "uint256", indexed: true },
  ],
} as const;

/**
 * Emitted by register(). Note the parameter order: the agent URI sits between
 * the two indexed parameters, so a signature with the address second hashes to
 * a different topic0 and matches nothing.
 */
export const REGISTERED_EVENT = {
  type: "event",
  name: "Registered",
  inputs: [
    { name: "agentId", type: "uint256", indexed: true },
    { name: "agentURI", type: "string", indexed: false },
    { name: "owner", type: "address", indexed: true },
  ],
} as const;

/**
 * Emitted when an agent's URI changes. The event is `URIUpdated`, not
 * `AgentURIUpdated`, and carries the updating address as a third parameter.
 */
export const URI_UPDATED_EVENT = {
  type: "event",
  name: "URIUpdated",
  inputs: [
    { name: "agentId", type: "uint256", indexed: true },
    { name: "newURI", type: "string", indexed: false },
    { name: "updatedBy", type: "address", indexed: true },
  ],
} as const;

/**
 * Emitted when a metadata key is written on an agent. Not consumed by scoring
 * today; included so the decoder can recognise it rather than treat the most
 * common Identity Registry event after Registered as an unknown log.
 *
 * `indexedMetadataKey` is a dynamic type marked indexed, so the topic carries
 * keccak of the key rather than the key itself. The unhashed key is in
 * `metadataKey`.
 */
export const METADATA_SET_EVENT = {
  type: "event",
  name: "MetadataSet",
  inputs: [
    { name: "agentId", type: "uint256", indexed: true },
    { name: "indexedMetadataKey", type: "string", indexed: true },
    { name: "metadataKey", type: "string", indexed: false },
    { name: "metadataValue", type: "bytes", indexed: false },
  ],
} as const;

export const IDENTITY_REGISTRY_ABI: Abi = [
  REGISTERED_EVENT,
  URI_UPDATED_EVENT,
  METADATA_SET_EVENT,
  ERC721_TRANSFER_EVENT,
];

/**
 * Emitted by giveFeedback().
 *
 * Two shapes here differ from what SPEC 8's prose suggests. `feedbackIndex` is
 * uint64, not uint256. And `indexedTag1` is a separate indexed parameter
 * carrying keccak of tag1, sitting between valueDecimals and the unhashed
 * tag1: the readable tag is `tag1`, and `indexedTag1` decodes to a hash, never
 * to text.
 */
export const NEW_FEEDBACK_EVENT = {
  type: "event",
  name: "NewFeedback",
  inputs: [
    { name: "agentId", type: "uint256", indexed: true },
    { name: "clientAddress", type: "address", indexed: true },
    { name: "feedbackIndex", type: "uint64", indexed: false },
    { name: "value", type: "int128", indexed: false },
    { name: "valueDecimals", type: "uint8", indexed: false },
    { name: "indexedTag1", type: "string", indexed: true },
    { name: "tag1", type: "string", indexed: false },
    { name: "tag2", type: "string", indexed: false },
    { name: "endpoint", type: "string", indexed: false },
    { name: "feedbackURI", type: "string", indexed: false },
    { name: "feedbackHash", type: "bytes32", indexed: false },
  ],
} as const;

/** Emitted by revokeFeedback(). Every parameter is indexed, so the data is empty. */
export const FEEDBACK_REVOKED_EVENT = {
  type: "event",
  name: "FeedbackRevoked",
  inputs: [
    { name: "agentId", type: "uint256", indexed: true },
    { name: "clientAddress", type: "address", indexed: true },
    { name: "feedbackIndex", type: "uint64", indexed: true },
  ],
} as const;

/**
 * Emitted when an agent or a third party appends a response to existing
 * feedback. Recognised but not consumed by scoring: a response is a reply, not
 * a rating, and SPEC 11 gives it no weight.
 */
export const RESPONSE_APPENDED_EVENT = {
  type: "event",
  name: "ResponseAppended",
  inputs: [
    { name: "agentId", type: "uint256", indexed: true },
    { name: "clientAddress", type: "address", indexed: true },
    { name: "feedbackIndex", type: "uint64", indexed: false },
    { name: "responder", type: "address", indexed: true },
    { name: "responseURI", type: "string", indexed: false },
    { name: "responseHash", type: "bytes32", indexed: false },
  ],
} as const;

export const REPUTATION_REGISTRY_ABI: Abi = [
  NEW_FEEDBACK_EVENT,
  FEEDBACK_REVOKED_EVENT,
  RESPONSE_APPENDED_EVENT,
];
