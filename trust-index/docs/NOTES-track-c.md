# Track C notes (contracts)

Running log per SPEC 18.0. Track C owns `/contracts` and this file.

## Starting state

The previous Track C agent was terminated almost immediately, having only run a toolchain
probe (`src/Probe.sol`, a trivial one-line contract, plus its `out/` and `cache/` build
artifacts). No decisions were made and nothing else existed in the directory. The probe and its
build artifacts were deleted; the directory was built fresh.

## Decisions

- **No forge-std, no dependencies at all.** `forge install` of GitHub deps does not reach
  through this environment's proxy (confirmed: a leftover file in the scratchpad from the
  terminated agent's attempt held a raw GitHub-access-denied JSON error instead of a tarball).
  Rather than work around that, both contracts are zero-dependency Solidity, and the tests use a
  hand-written fifteen-line cheatcode interface (`test/utils/Vm.sol`) instead of importing
  forge-std's `Test.sol`. It declares the same address forge-std derives
  (`keccak256("hevm cheat code")`, truncated to 20 bytes) and only the six cheatcodes the suite
  actually calls (`prank`, `startPrank`, `stopPrank`, `roll`, `expectRevert` x2, `expectEmit`).
  Assertions are a dozen-line `TestBase.sol` wrapping `require`. This traded a little
  boilerplate for zero exposure to the proxy issue; happy to switch to forge-std later if a
  vendored copy becomes available, since nothing here is forge-std-specific in a way that would
  make swapping it out costly.
- **Ownership: two-step, hand-rolled, on both contracts.** `transferOwnership` /
  `acceptOwnership`, matching OpenZeppelin's `Ownable2Step` shape without importing it. This is
  the one piece of access-control machinery the brief called out as worth its lines; a
  single-step `Ownable` would risk permanently locking either contract's write path behind a
  typo'd address, which for `AnchorRegistry` means losing the ability to anchor at all (no
  recovery path exists by design, since there is no upgradeability) and for `ScoreOracle` means
  losing the ability to publish scores.
- **`getScore` reverts on an unknown agent rather than returning a zero-valued struct.** The
  spec left this open. A zero-valued `AgentScore` (`score: 0, coverageTier: 0, ...`) is not
  reliably distinguishable on the wire from a real score of exactly 0.00 with tier `none`; an
  integrator who forgets to call `hasScore` first would get a plausible-looking struct instead
  of a clear signal that nothing was ever written. Reverting with a named `UnknownAgent` error
  is more expensive to integrate against but cannot be misread. `hasScore()` gives the
  non-reverting path when that is inconvenient, and `meetsThreshold()` remains the intended path
  for a caller that never wants to handle a revert at all. Documented in the `getScore` NatSpec
  and in `contracts/README.md`.
- **`AnchorRegistry.anchor()` keeps the exact name and argument order from SPEC 20.1**
  (`anchor(bytes32 root, string dumpURI, bytes32 dumpHash, string methodologyVersion)`), even
  though `Anchor` is also the struct name; Solidity is case-sensitive and there is no collision.
  An early draft renamed the function to `postAnchor` to sidestep the visual similarity, then
  reverted that: off-chain dump tooling should be able to call the function name straight out of
  the spec without a lookup step.
- **`meetsThreshold`'s six-argument staleness overload guards against `asOfBlock` in the
  future** (`block.number < asOfBlock`) by returning `false` rather than underflowing. Solidity
  0.8's checked arithmetic would revert on that underflow, which would break the "never reverts"
  property the whole point of `meetsThreshold` rests on. A future `asOfBlock` should not happen
  since only the owner writes it, but the failure mode if it ever does is now "treated as
  maximally stale," not "the query call reverts."
- **`MerkleLib` is a separate file from `AnchorRegistry`** per the brief's carve-out, so the
  100-line budget applies to the registry contract only. `AnchorRegistry.sol` is 91 lines
  including all NatSpec.
- **Struct layout test reconstructs the expected encoding by hand, field by field, rather than
  asserting against a precomputed literal hash.** Both approaches "assert the exact expected
  encoding bytes"; hand reconstruction is self-documenting (the expected byte layout is visible
  in the test itself, tied to the field order in `oracle.ts`) and needs no separate script run to
  produce a magic constant. It still breaks loudly on any field reorder or width change, which is
  the property asked for.
- **Kept `foundry.toml` as the probe agent left it** (solc 0.8.24 pinned, optimizer on with
  10,000 runs, cancun EVM target, 100-char line length). No reason to change any of it.

## Gate C1 (inclusion proof verifies on anvil)

Ran against a live `anvil` instance, not just a forge test, per the brief's preference.

1. Started anvil (default chain id 31337, default account 0 as deployer).
2. `forge create src/AnchorRegistry.sol:AnchorRegistry --broadcast` against anvil, constructor
   arg the deployer address. Deployed to `0x5FbDB2315678afecb367f032d93F642f64180aa3`.
3. Built a 4-leaf sorted-pair Merkle tree off-chain (leaves `keccak256("leaf-0..3")`) using
   `cast keccak` for every hash, independent of any Solidity code, to keep the check honest about
   what "off-chain tooling reproduces the convention" means. Root and leaf-2's proof computed in
   a small script (kept in this session's scratchpad, not part of the deliverable).
4. `cast send ... "anchor(bytes32,string,bytes32,string)"` with that root: transaction succeeded
   (`status 1`), block 2, `anchorCount()` reads back `1`.
5. `cast call ... "verifyInclusion(uint256,bytes32,bytes32[])(bool)"`:
   - valid leaf-2 with its real proof: `true`.
   - same proof, wrong leaf (`keccak256("not-a-member")`): `false`.
   - real leaf, one proof element swapped for `keccak256("tampered")`: `false`.

Gate passes. Transcript (addresses, root, proof, and the three call results) is reproducible
from the steps above; not pasted verbatim here to keep this file scannable, all values are real
outputs from that anvil session and not fixtures.

## Test suite

`forge test`: 31 tests, 3 suites, all passing.

- `test/AnchorRegistry.t.sol` (12 tests): access control, append-only indexing, event contents,
  getter round-trip, Merkle verification (valid / tampered / wrong-leaf), full two-step
  ownership transfer path plus both revert branches.
- `test/ScoreOracle.t.sol` (18 tests): full-field round trip, both length-mismatch shapes,
  non-owner revert, `hasScore`/`getScore` unknown-agent behavior, `meetsThreshold` truth table
  (unknown agent, sentinel score, `coverageTier == 0`, each of the three floor comparisons, and
  the all-pass case, each as its own test), the `maxAgeBlocks` overload (within budget, beyond
  budget, still fails closed on tier-0 even with an unlimited budget, and confirmation that the
  base overload never enforces staleness even at 10,000,000 blocks of age), and a 100-agent
  batch write.
- `test/StructLayout.t.sol` (1 test): `abi.encode(AgentScore)` against a hand-built expected byte
  string, field by field.

## Gas

`forge test --gas-report`, full output kept in the PR/session transcript. Headline numbers:

- `ScoreOracle.setScores` for a **100-agent batch, all first-time writes (cold storage)**:
  **7,365,438 gas** total, isolated (traced directly, not the enclosing test's total including
  its own read-back assertions). That is about 73,650 gas per agent for a full first write of
  all ten fields. A same-day update to an already-written agent would be materially cheaper
  (warm storage slots); no update-path benchmark was run since the brief asked specifically for
  the fresh-write batch number.
- `AnchorRegistry.anchor`: roughly 137,991 gas average across the suite's calls (varies with
  `dumpURI` / `methodologyVersion` string length); the live anvil anchor in the C1 gate cost
  164,327 gas for a 19-character URI and a 5-character version string.
- `AnchorRegistry.verifyInclusion`: about 5,608 gas average for a 4-leaf tree (2-element proof).
- `ScoreOracle.meetsThreshold` (five-arg): 2,886 to 5,753 gas depending on which branch it exits
  on (unknown-agent short-circuits cheapest).

At Base gas prices these numbers are not a concern; SPEC 20.2's few-dollars-a-day estimate for
steady-state oracle writes looks consistent with 73,650 gas/agent for genuinely new agents and
much less for updates.

## Open questions / requests to the lead

- **Deployer-to-signer handoff is documented but unexercised.** `contracts/README.md` describes
  transferring ownership from a throwaway deployer to the dedicated per-chain signer wallet
  named in SPEC 20.4, then emptying the deployer. That sequence is straightforward given the
  two-step ownership transfer already tested, but it has not been run against a live signer
  setup since that setup does not exist yet. Flagging so whoever owns the actual Base deployment
  (G6/G7) knows the contract-side mechanics are ready and tested but the operational key
  handling is still to be done for real.
- **No dependency on forge-std going forward is a deliberate constraint, not a permanent one.**
  If a vendored copy of forge-std becomes available in this environment later, swapping
  `test/utils/Vm.sol` and `TestBase.sol` for real forge-std imports is a mechanical change; none
  of the tests rely on anything forge-std-specific beyond what is already declared here.
- **`meetsThreshold` recommended `maxAgeBlocks` values in the README are estimates**, not tuned
  numbers: Base block time and the SPEC 20.2 weekly-refresh cadence, nothing more. Worth
  revisiting once G7 has real write-cadence data.
