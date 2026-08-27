# Contracts

Two contracts, both on Base (SPEC 20). No token, no upgradeability, no funds held.

- `src/AnchorRegistry.sol`: append-only daily Merkle anchor of the scores dump (integrity).
- `src/ScoreOracle.sol`: owner-gated batch writer, public reads, publishes score plus
  uncertainty for on-chain composability.
- `src/MerkleLib.sol`: the sorted-pair keccak256 verifier `AnchorRegistry` calls.

Zero external dependencies. Ownership uses a hand-rolled two-step transfer pattern instead of
an imported library; tests use a hand-written cheatcode interface instead of forge-std (see
`test/utils/Vm.sol` for why).

## Building and testing

```
forge build
forge test
forge test --gas-report
```

## Deployment

Per SPEC 20.4: a dedicated signer wallet per chain, funded with roughly $50 equivalent, held in
an isolated job runner with a per-day transaction cap and an allowlist of exactly the two
contract addresses on that chain. Never the web process. Never a personal wallet.

The deployer key that sends the `CREATE` transaction is not the same key as the day-to-day
signer: fund a throwaway deployer, deploy both contracts, call `transferOwnership` on each to
move ownership to the dedicated signer, have the signer call `acceptOwnership`, then empty the
deployer wallet back out. The deployer never needs to hold funds again after that.

```
forge create src/AnchorRegistry.sol:AnchorRegistry \
  --rpc-url <RPC_URL> --private-key <DEPLOYER_KEY> --broadcast \
  --constructor-args <DEPLOYER_ADDRESS>

forge create src/ScoreOracle.sol:ScoreOracle \
  --rpc-url <RPC_URL> --private-key <DEPLOYER_KEY> --broadcast \
  --constructor-args <DEPLOYER_ADDRESS>
```

Then transfer ownership on each contract to the dedicated signer (two-step: `transferOwnership`
from the deployer, `acceptOwnership` from the signer) before the deployer key is discarded.

Redeploy `ScoreOracle` as a new instance on any methodology major-version bump; do not mutate
semantics under integrators who are already reading the old one.

## Reading the oracle

### Struct encoding

`AgentScore` has ten fields, all static (value) types, in this exact order. `abi.encode` of the
struct is these ten fields each widened to a 32-byte word and concatenated, with no offset
pointer (see `test/StructLayout.t.sol`).

| Field | Type | Encoding |
|---|---|---|
| `score` | `int32` | display value * 100 (2 decimals), or -1 (`NULL_SCORE_SENTINEL`) if null |
| `scoreLow` | `int32` | as `score` |
| `scoreHigh` | `int32` | as `score` |
| `confidence` | `uint16` | basis points |
| `nEff` | `uint32` | effective sample size * 100 (2 decimals) |
| `coverageTier` | `uint8` | 0 none, 1 thin, 2 moderate, 3 strong |
| `lifecycleState` | `uint8` | 0 placeholder, 1 registered, 2 live, 3 dormant |
| `ownershipEpoch` | `uint32` | see SPEC 11.6 |
| `asOfBlock` | `uint64` | block number the score was computed as of |
| `methodologyVersion` | `uint32` | major*1_000_000 + minor*1_000 + patch |

This mirrors `OracleAgentScore` in `packages/types/src/oracle.ts` field-for-field; that file is
the source of truth for the fixed-point scalings.

### getScore vs meetsThreshold

`getScore(chainId, agentId)` reverts with `UnknownAgent` if the pair was never written. Call
`hasScore(chainId, agentId)` first if a revert is inconvenient in your call path.

`meetsThreshold(chainId, agentId, minScore, minConfidence, minCoverageTier)` never reverts. It
fails closed: `false` for an unknown agent, a sentinel (-1) score, `coverageTier == 0`, or any of
the three named floors not met.

The five-argument overload does not check staleness. A six-argument overload adds
`maxAgeBlocks` and additionally fails closed when `block.number - asOfBlock > maxAgeBlocks`.

### Recommended max age

`asOfBlock` is public; every caller can check it directly, and the contract does not enforce a
staleness bound on its own (SPEC 20.2). As a starting point until real write-cadence data says
otherwise: on Base (roughly 2-second blocks), 43,200 blocks is about one day. Given the weekly
full-refresh cadence in SPEC 20.2, a caller that wants "no older than about a week" should pass
roughly 300,000 as `maxAgeBlocks`; a caller that wants same-day freshness should pass roughly
43,200. Integrators own their own risk tolerance; this is a starting point, not a promise.

### Merkle inclusion proofs

`AnchorRegistry.verifyInclusion(anchorIndex, leaf, proof)` uses sorted-pair keccak256 hashing:
at every level, the two nodes being combined are compared as `uint256` and hashed in ascending
order, `keccak256(abi.encodePacked(min, max))`. A proof is the sibling hash at each level in
leaf-to-root order; no left/right flag is needed. Off-chain dump tooling building the tree that
gets anchored must use this exact rule at every level, including the first level above the
leaves, or its roots will not match what verifies on chain. See `src/MerkleLib.sol` for the
full NatSpec and `test/AnchorRegistry.t.sol` for a worked example built independently of the
library under test.
