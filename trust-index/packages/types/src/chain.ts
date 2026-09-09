/** Chain identity and registry configuration (SPEC §8, §24A "Chain slug"). */

/** Lowercase canonical chain name used in URLs and dumps; maps 1:1 to an EIP-155 chain id. */
export type ChainSlug = string;

export type ChainConfig = {
  chain_id: number;
  slug: ChainSlug;
  name: string;
  rpc_url_env_key: string;
  identity_registry: `0x${string}`;
  reputation_registry: `0x${string}`;
  validation_registry: `0x${string}` | null;
  first_block: number;
  enabled: boolean;
};

/**
 * Registry addresses per SPEC §8. UNVERIFIED against
 * github.com/erc-8004/erc-8004-contracts (network-restricted build env);
 * verify before any live indexing run. Tracked in docs/NOTES-lead.md.
 */
export const MAINNET_IDENTITY_REGISTRY: `0x${string}` =
  "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";
export const MAINNET_REPUTATION_REGISTRY: `0x${string}` =
  "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63";

export const KNOWN_CHAINS: readonly ChainConfig[] = [
  {
    chain_id: 8453,
    slug: "base",
    name: "Base",
    rpc_url_env_key: "RPC_URL_BASE",
    identity_registry: MAINNET_IDENTITY_REGISTRY,
    reputation_registry: MAINNET_REPUTATION_REGISTRY,
    validation_registry: null,
    first_block: 0,
    enabled: true,
  },
] as const;
