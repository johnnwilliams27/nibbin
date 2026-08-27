/**
 * ERC-8004 event ABIs (SPEC section 8).
 *
 * UNVERIFIED. Written from the SPEC 8 function descriptions
 * (register/setAgentURI/getAgentWallet for Identity; giveFeedback/
 * revokeFeedback for Reputation), not from the official contracts repo
 * (github.com/erc-8004/erc-8004-contracts), which is unreachable from this
 * build environment. Event names, parameter order, and indexed flags are all
 * best-effort guesses and must be checked against the real ABI before any
 * live indexing run. See docs/NOTES-track-a.md for the open request to the
 * lead.
 *
 * The ERC-721 Transfer event is the one exception: it is the standard
 * signature and is settled.
 */
import type { Abi } from "viem";

/** Standard ERC-721 Transfer. Settled, not part of the UNVERIFIED set below. */
export const ERC721_TRANSFER_EVENT = {
  type: "event",
  name: "Transfer",
  inputs: [
    { name: "from", type: "address", indexed: true },
    { name: "to", type: "address", indexed: true },
    { name: "tokenId", type: "uint256", indexed: true },
  ],
} as const;

/** UNVERIFIED: emitted by register(). Guessed shape: agent id, owner, initial token URI. */
export const REGISTERED_EVENT = {
  type: "event",
  name: "Registered",
  inputs: [
    { name: "agentId", type: "uint256", indexed: true },
    { name: "owner", type: "address", indexed: true },
    { name: "tokenURI", type: "string", indexed: false },
  ],
} as const;

/** UNVERIFIED: emitted by setAgentURI(). */
export const AGENT_URI_UPDATED_EVENT = {
  type: "event",
  name: "AgentURIUpdated",
  inputs: [
    { name: "agentId", type: "uint256", indexed: true },
    { name: "tokenURI", type: "string", indexed: false },
  ],
} as const;

export const IDENTITY_REGISTRY_ABI: Abi = [
  REGISTERED_EVENT,
  AGENT_URI_UPDATED_EVENT,
  ERC721_TRANSFER_EVENT,
];

/**
 * UNVERIFIED: emitted by giveFeedback(agentId, value int128, valueDecimals
 * uint8, tag1, tag2, endpoint, feedbackURI, feedbackHash) (SPEC 8). Mirrors
 * the call arguments plus the feedback index the registry assigns.
 */
export const NEW_FEEDBACK_EVENT = {
  type: "event",
  name: "NewFeedback",
  inputs: [
    { name: "agentId", type: "uint256", indexed: true },
    { name: "clientAddress", type: "address", indexed: true },
    { name: "feedbackIndex", type: "uint256", indexed: false },
    { name: "value", type: "int128", indexed: false },
    { name: "valueDecimals", type: "uint8", indexed: false },
    { name: "tag1", type: "string", indexed: false },
    { name: "tag2", type: "string", indexed: false },
    { name: "endpoint", type: "string", indexed: false },
    { name: "feedbackURI", type: "string", indexed: false },
    { name: "feedbackHash", type: "bytes32", indexed: false },
  ],
} as const;

/** UNVERIFIED: emitted by revokeFeedback(). */
export const FEEDBACK_REVOKED_EVENT = {
  type: "event",
  name: "FeedbackRevoked",
  inputs: [
    { name: "agentId", type: "uint256", indexed: true },
    { name: "clientAddress", type: "address", indexed: true },
    { name: "feedbackIndex", type: "uint256", indexed: false },
  ],
} as const;

export const REPUTATION_REGISTRY_ABI: Abi = [NEW_FEEDBACK_EVENT, FEEDBACK_REVOKED_EVENT];
