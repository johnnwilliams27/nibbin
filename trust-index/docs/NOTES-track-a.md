# Track A notes (data spine)

Running log of decisions, deviations, and requests. Owner: Track A subagent.
Scope: packages/db, packages/indexer, stage A1 gate plus code for A2 to A4.

## Status

- Started 2026-08-27. Scaffolding in progress.

## Environment facts

- No chain RPC access and no hosted database credentials in this environment.
  Live backfill gates (A2 to A4 counts) are out of scope; chain access is
  abstracted behind a ChainSource interface and tested against a simulated
  provider.
- Docker works after starting dockerd manually (`dockerd` was not running at
  session start; `docker info` now reports server 29.3.1). postgres:16 image
  pulled through the proxy without trouble. The A1 gate and the db test suite
  run against a disposable postgres:16 container.

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
    and ReviewerSnapshot.has_commerce_with_agent are built from it.

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
- has_commerce_with_agent is derived from commerce_events (reviewer address as
  counterparty for this agent). The broader "any non-feedback transaction with
  the agent wallet" signal needs an account-level trace source we do not have;
  noted for A6.
- Mint transfers (from the zero address) are excluded from snapshot.transfers,
  matching the fixture convention that mint is not a transfer.

## Round-trip gate fields

Deep equality against fixtures is expected to hold for the full AgentSnapshot
object. Fields the database legitimately does not carry: none at present; the
additions above were made precisely so the whole snapshot materializes.

## ABI verification status

The ERC-8004 event ABIs in packages/indexer/src/abi.ts are written from the
SPEC 8 function descriptions and are UNVERIFIED: the official contracts repo
(github.com/erc-8004/erc-8004-contracts) is unreachable from this build
environment. The ERC-721 Transfer event is the standard signature and is the
only entry considered settled. Lead tracks verification before any live run.

## Requests to the lead

- (open) Verify event names, parameter order, and indexed flags for
  Registered, AgentURIUpdated, NewFeedback, and FeedbackRevoked against the
  official contracts repo, then update packages/indexer/src/abi.ts.
- (open) The pg-backed CursorStore and FirstSeenCache live in @trust-index/db
  and match the indexer interfaces structurally; a compile-time assertion in
  packages/indexer/src/pgCompat.ts pins the compatibility. No types change
  needed.
