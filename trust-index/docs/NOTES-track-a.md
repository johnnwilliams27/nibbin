# Track A notes (data spine)

Running log of decisions, deviations, and requests. Owner: Track A subagent.
Scope: packages/db, packages/indexer, stage A1 gate plus code for A2 to A4.

## Status

- 2026-08-27: first Track A session left packages/db in a partial state
  (mid-edit on a commerce evidence table) and packages/indexer not yet
  started; its docker claim below (see superseded note) could not be
  reproduced.
- 2026-08-27, resumed: inventoried packages/db in full, verified it against
  the fixtures and a real Postgres 16 instance (not docker; see below), kept
  it as-is with no code changes, then built packages/indexer from scratch.
  A1 gate passes. Stage A2-A4 code (backfill, decode, metadata, first-seen,
  poller) is complete and unit-tested against SimulatedChainSource; no live
  run was possible or attempted (see environment facts).

## Environment facts

- No chain RPC access and no hosted database credentials in this
  environment. Live backfill gates (A2 to A4 counts) are out of scope; chain
  access is abstracted behind a ChainSource interface (packages/indexer) and
  every test in that package runs against SimulatedChainSource, never the
  network.
- Docker is broken in this environment: the daemon is unreachable
  (`Cannot connect to the Docker daemon at unix:///var/run/docker.sock`) and
  cannot be started (`dockerd` fails under the container's init; `service
  docker start` and `systemctl start docker` both fail, the latter because
  PID 1 is not systemd). This superseded a prior note in this file claiming
  docker had been made to work in this environment; that could not be
  reproduced in this session and is not relied on.
- Verified the A1 gate and the full packages/db test suite instead against a
  scratch Postgres 16 cluster built from the system binaries
  (`/usr/lib/postgresql/16/bin`), run as the `postgres` OS user (initdb and
  postgres refuse to run as root):
  - `initdb -D <scratchpad>/pg -U postgres --auth=trust --no-locale` (the
    scratchpad's ancestor directories needed `chmod o+x`, execute-only, no
    read, so the non-root `postgres` user could traverse into it; nothing
    under scratchpad was made listable or readable to other users).
  - `pg_ctl -D <scratchpad>/pg -l <scratchpad>/pg/server.log -o '-p 54329 -k
    /tmp -h 127.0.0.1' start`.
  - packages/db's `test/globalSetup.ts` already supports this without any
    code change: it starts a docker container only when
    `TRUST_INDEX_TEST_DB_URL` is unset. Tests were run with
    `TRUST_INDEX_TEST_DB_URL=postgres://postgres@127.0.0.1:54329/postgres`.
  - Cluster was stopped after the gate: `pg_ctl -D <scratchpad>/pg stop`.
  - Any future session in this same environment should reuse this recipe
    rather than assume docker works; re-check `docker info` first in case
    the environment changes.

## Decisions and deviations from SPEC section 9

The SPEC 9 table list is implemented exactly, with these documented additions
(no SPEC column was removed or renamed):

1. `chains.slug` added. ChainConfig in @trust-index/types carries `slug` and
   the glossary requires a 1:1 slug to chain id mapping; the table needs it.
2. `agents.agent_wallet_active` added (boolean). Lifecycle classification
   (SPEC 11.7) and AgentSnapshot both need "agent wallet has outbound
   activity"; there is no SPEC 9 home for it.
3. `agent_transfers.log_index` added and used in the primary key
   `(chain_id, tx_hash, log_index)`; SPEC 9 declares no key for this table and
   one ERC-721 transfer per log line needs a stable identity for idempotent
   upserts.
4. `agent_transfers.same_funder` and `agent_transfers.bidirectional_history`
   added (nullable booleans). AgentSnapshot.transfer_linkages (SPEC 11.6
   custody migration evidence) has to be stored somewhere; these are written by
   the enrichment pass, null until computed, and read as false when null.
5. `validations.ts` added. ValidationRecord in the types package carries a
   timestamp; SPEC 9 validations has only last_update_block.
6. `reviewer_wallets.portfolio_top_funder_share` and
   `reviewer_wallets.first_seen_source` added. ReviewerSnapshot needs the
   former; SPEC 10.4 defines three first-seen sources and the value is worth
   keeping for the reviewer analysis.
7. `scores` carries score_low, score_high, confidence, n_eff,
   lifecycle_state, inputs_hash, and result_json in addition to the SPEC 9
   columns. SPEC 11.11 makes these part of every score output and the anchor
   leaf (SPEC 20.1) needs them without re-deriving from signals_json.
8. `index_cursors.last_processed_hash` added. Reorg detection by parent-hash
   mismatch (SPEC 10.5) needs the hash of the last processed block persisted
   next to its number.
9. New table `score_overrides` (SPEC 23 incident response, SPEC 24 admin
   surface): id, chain_id, agent_id, suppress flag, author, reason (not
   null), created_at, lifted_at, lifted_by, lift_reason. Every override is a
   row with an author, a timestamp, and a written reason.
10. New table `priors` (chain_id, methodology_version, context, value, basis,
    n_basis, computed_at). Context '' means the global prior. Written by the
    prior computation job from high-weight evidence only; buildAgentSnapshot
    reads it and falls back to a neutral placeholder (0.500000, n_basis 0)
    when no rows exist, so stage G1 has a defined behavior before the job
    lands.
11. New table `detected_scales` (chain_id, client_address, tag1, min_raw,
    max_raw): the per (client, tag) scale detection of SPEC 11.10 is an
    index-wide aggregate, so it is materialized by an enrichment pass rather
    than recomputed per snapshot query. A missing row means the scale is
    uninferable and the snapshot carries detected_scale null.
12. New table `commerce_events` (A6 ingest target): chain_id, agent_id,
    counterparty, outcome, block, ts, source, tx_hash. AgentSnapshot.commerce
    is built from it, and it is one of two sources for
    ReviewerSnapshot.has_commerce_with_agent (see 13).
13. New table `reviewer_agent_commerce` (chain_id, address, agent_id,
    evidence_source, first_block, tx_hash): the broader "reviewer has at
    least one non-feedback on-chain transaction with the agent's wallet"
    evidence SPEC 11.2 needs for the commerce weight multiplier. This is not
    the same set as commerce_events (ingested job outcomes only);
    `has_commerce_with_agent` is true when either table has a matching row
    for (chain_id, agent_id, reviewer address). Answers the fixture mismatch
    a predecessor session flagged (fixtures set reviewers'
    has_commerce_with_agent without a matching commerce_events row): the db
    layer derives the field from this table, populated by wallet-transfer
    evidence, not only from commerce ingest.

## packages/db inventory (this session)

Found packages/db already scaffolded: schema.ts, snapshot.ts, stores.ts,
client.ts, migrate.ts, migrations.ts, format.ts, the committed migration and
its drizzle-kit meta, and a full test suite (format.test.ts,
test/roundtrip.test.ts, test/insertFixture.ts, test/globalSetup.ts). Read
every file and every line against SPEC 9 and the @trust-index/types
snapshot/chain/methodology/fixed modules before trusting any of it, then
verified mechanically rather than by inspection alone:

- `pnpm --filter @trust-index/db run typecheck`: clean.
- `pnpm --filter @trust-index/db run test` against the scratch Postgres
  (see environment facts): 21/21 passing, including all 10 fixture cases in
  the manifest round-tripped through insert-rows-then-buildAgentSnapshot
  with `toStrictEqual` against the fixture JSON, plus the as_of_block
  cutoff, neutral-prior-fallback, missing-first-seen-raises, and pg-store
  round-trip tests.
- `pnpm --filter @trust-index/db run migrate` against a fresh database: applies
  clean, seeds the Base chain row, and is idempotent (ran it twice; second
  run is a no-op beyond the chain upsert).
- `drizzle-kit generate`: "No schema changes, nothing to migrate" - the
  committed migration matches schema.ts exactly, no drift.

Kept the entire package as-is: no code changes were needed. Everything
below this line about packages/db (decisions, buildAgentSnapshot notes,
round-trip gate fields) describes what was already there, verified, not
work done this session.

## buildAgentSnapshot notes

- Signature is `buildAgentSnapshot(db, chainSlug, agentId, asOfBlock, opts?)`.
  `opts.asOfTs` supplies as_of_ts, because the database does not store a
  timestamp for arbitrary block heights; callers (poller, recompute job) know
  the head timestamp. When absent it falls back to the latest indexed event
  timestamp at or below asOfBlock, which understates as_of_ts and is
  documented on the function.
- Reviewer aggregates come from the reviewer_wallets row as last refreshed
  (SPEC 23 daily job); they are not rewound to asOfBlock. Recorded as a known
  limitation; exact-as-of reviewer stats would need an event-sourced rebuild.
- has_commerce_with_agent is true when the reviewer address appears either as
  a commerce_events counterparty for this agent, or in reviewer_agent_commerce
  for this (chain, agent, address). The latter is the general wallet-level
  evidence (SPEC 11.2); the former is A6 ingested job outcomes. Populating
  reviewer_agent_commerce from real wallet transaction data (an account-level
  trace source) is A4/A6 work, not done in this session.
- Mint transfers (from the zero address) are excluded from snapshot.transfers,
  matching the fixture convention that mint is not a transfer.

## Round-trip gate fields

Deep equality against fixtures is expected to hold for the full AgentSnapshot
object. Fields the database legitimately does not carry: none at present; the
additions above were made precisely so the whole snapshot materializes.

## packages/indexer (this session, built from scratch)

Did not exist at the start of this session. Built per SPEC 10 and the task
scope (A1 code fully, A2-A4 code without a live run). Design:

- `chainSource.ts`: the `ChainSource` interface (`getLatestBlockNumber`,
  `getBlock`, `getLogs`), plus `RawLog`/`BlockRef` types. Every other module
  in this package depends only on this interface, never on viem or a
  simulated chain directly.
- `viemChainSource.ts`: real-RPC implementation. Reads the RPC URL from the
  chain's configured env var (`resolveRpcUrl`, throws
  `ViemChainSourceConfigError` if unset). `getLogs` calls raw `eth_getLogs`
  through the transport (not viem's typed `getLogs` action, which derives
  topics from an `event` argument rather than accepting the standard
  RPC topic-array filter this package's decoders build). Not exercised by
  any test beyond construction and env resolution: no RPC endpoint is
  reachable here.
- `simulatedChainSource.ts`: deterministic in-memory chain. `seed()` +
  `appendBlock`/`appendBlocks` build a chain with real parent-hash linkage;
  `reorgAt(fromBlock, newBlockCount, logsPerBlock)` truncates and rebuilds a
  suffix with different hashes (an epoch counter guarantees no collision
  with the discarded chain); `injectGetLogsError` and
  `injectGetBlockFailure` simulate provider errors on demand. Every test in
  this package runs against this, never the network.
- `abi.ts` / `decode.ts`: event ABIs and decoders for Registered,
  AgentURIUpdated, Transfer (Identity Registry) and NewFeedback,
  FeedbackRevoked (Reputation Registry). Decoded addresses are lowercased on
  the way out to match the AgentSnapshot wire contract ("addresses are
  lowercase 0x hex", snapshot.ts). Raw int128 feedback values are kept as
  decimal strings end to end, never coerced to a JS number (SPEC 22),
  verified with a value at the actual int128 minimum
  (-170141183460469231731687303715884105728) in decode.test.ts.
- `rateLimiter.ts`: token bucket, `now`/`sleep` both injectable so tests run
  in zero real time (asserted directly: a test that would need ~100ms of
  real waiting completes in under 50ms wall-clock).
- `cursorStore.ts` / `logCache.ts`: the `CursorStore` and `LogCache`
  interfaces plus in-memory implementations for tests; `logCache.ts` also
  has a file-based implementation (`createFileLogCache`) for real backfill
  runs, keyed by `(chainId, contract, fromBlock, toBlock)` under
  `baseDir/chainId/contract/`.
- `backfill.ts`: `runBackfill` chunks `[fromBlock, toBlock]` starting at
  2,000 blocks (SPEC 10.1), halves on a `getLogs` error down to
  `minChunkBlocks` (throws if even the minimum fails), checks the log cache
  before every fetch, writes to the log cache before calling `onLogs`, and
  only advances `index_cursors` after `onLogs` returns. That ordering is
  what makes resumability work: a crash inside `onLogs` (the abrupt-kill
  test uses a real thrown error, not a process signal, since this is a unit
  test) leaves the cursor at the last *committed* chunk, and the chunk that
  was already fetched and cached is replayed from disk on restart rather
  than re-fetched (asserted directly by counting `getLogs` calls on restart
  via a `Proxy`). `reparseFromCache` replays every cached chunk through a
  new `onLogs` with zero `ChainSource` calls, satisfying "re-parsing must
  never require re-fetching."
- `metadata.ts`: `resolveMetadata` never throws; every failure path maps to
  a `MetadataStatus` (`resolved | unreachable | malformed | absent`),
  matching "unreachable is a coverage signal, never a negative signal about
  the agent" (SPEC 10.2). `ipfs://` resolves through the configured
  gateway; `http(s)://` is used directly; anything else is `malformed`.
  256KB cap, JSON schema check against the SPEC 8 registration fields
  (name, description, services[], x402Support, active, supportedTrust[]).
  Tested only against an injected fetcher.
- `firstSeen.ts`: `resolveFirstSeen` is pure earliest-of-three-candidates
  logic (SPEC 10.4); assembling the three candidate signals from chain data
  is left to the caller by design (see the module docstring: "first
  outbound tx" and "contract creation block" are not general
  getLogs/getBlock queries). `getOrResolveFirstSeen` is the cache-through
  wrapper; a cache hit never recomputes (asserted directly via a call
  counter).
- `poller.ts`: `Poller.tick()` does one poll cycle: verify the cursor's
  recorded block hash is still canonical (a `getBlock` failure during that
  check is treated as "assume no reorg this tick," not a rewind, to avoid a
  transient RPC hiccup causing a spurious reprocess), rewind by
  `confirmationDepth` on a mismatch, then process any range between the
  (possibly rewound) cursor and `head - confirmationDepth`. `lagSeconds` is
  chain-time (head block timestamp minus last-processed block timestamp),
  not wall-clock, so it stays deterministic in tests. `start`/`stop` use an
  injectable `Timers` (default real `setTimeout`/`clearTimeout`); the reorg
  test in poller.test.ts reorgs 10 blocks deeper than confirmationDepth on
  purpose, to exercise the parent-hash mismatch safety net itself rather
  than rely on confirmation depth alone to prevent it from ever firing.
- `pgCompat.ts`: not exported from index.ts (it is a typecheck-only file,
  included by tsconfig's `src/**/*.ts` glob but never imported). Asserts
  `ReturnType<typeof createPgCursorStore>` and
  `ReturnType<typeof createPgFirstSeenCache>` from `@trust-index/db` are
  assignable to this package's `CursorStore`/`FirstSeenCache` interfaces, so
  a drift in db's store shape fails `pnpm --filter @trust-index/indexer run
  typecheck`, not a live run. `@trust-index/db` is a devDependency of
  indexer for this reason only (type-only usage; no runtime import).

Gate result: `pnpm --filter @trust-index/indexer run typecheck` and
`run test` both clean, 60/60 tests passing across 9 files. Combined with
packages/db: 81/81 tests passing across both packages.

## ABI verification status

RESOLVED 2026-09-04. The ABIs are verified against the deployed Base mainnet
registries. Both registry addresses are ERC-1967 proxies; their implementations
(identity 0x7274e874ca62410a93bd8bf61c69d8045e399c02, reputation
0x16e0fa7f7c56b9a767e34b192b51f921be31da34) are verified on Sourcify, and
packages/indexer/src/abi.ts now carries those published definitions. Confirmed
a second way by decoding real logs: `scripts/verify-abi.mts` fetches live logs
and decodes each committed event, and four captured logs are pinned in
test/fixtures/live-base-logs.json and decoded in the unit suite.

Every one of the five guessed definitions was wrong:

| Event | Guessed | Actual |
|---|---|---|
| Registered | `(uint256 indexed, address indexed, string)` | `(uint256 indexed agentId, string agentURI, address indexed owner)` |
| URI update | `AgentURIUpdated(uint256 indexed, string)` | `URIUpdated(uint256 indexed agentId, string newURI, address indexed updatedBy)` |
| NewFeedback | 10 params, `uint256 feedbackIndex` | 11 params, `uint64 feedbackIndex`, extra `string indexed indexedTag1` |
| FeedbackRevoked | `uint256` index, not indexed | `uint64 indexed feedbackIndex` |
| (absent) | not handled | `MetadataSet`, `ResponseAppended` |

The failure mode this would have produced is the dangerous one. topic0 is the
keccak of the whole signature, so a wrong signature matches no log at all: the
backfill would have completed, reported zero events, and looked like a quiet
chain rather than a broken indexer. Nothing in the unit suite could have caught
it, because encode.ts built its fixtures from the same wrong ABI the decoder
read. That is why the ground-truth checks are committed alongside the fix.

Note for other chains: this verification covers Base mainnet (8453) only. Run
`scripts/verify-abi.mts --rpc <url>` against any new chain before backfilling
it. The registries are deployed at the same addresses across mainnets, but that
is an expectation, not something this repo has checked.

## Requests to the lead

- (open) Verify event names, parameter order, and indexed flags for
  Registered, AgentURIUpdated, NewFeedback, and FeedbackRevoked against the
  official contracts repo, then update packages/indexer/src/abi.ts.
- (open) The pg-backed CursorStore and FirstSeenCache live in @trust-index/db
  and match the indexer interfaces structurally; a compile-time assertion in
  packages/indexer/src/pgCompat.ts pins the compatibility. No types change
  needed.
- (open, reconfirmed this session) Both items above carried over unchanged
  from the prior session; still true, still unresolved. No new type or
  fixture change requests from this session.
- (informational, not a request) docs/ENVIRONMENTS.md and docs/RUNBOOK.md
  should note that this build environment's docker daemon is unreachable
  and the recipe above (system Postgres 16 binaries, run as the `postgres`
  OS user) is the working local substitute, in case a future session in the
  same environment starts from docs rather than re-discovering this.
