# Hackathon experience and public hiring — 2026-09-09

Scope: `codex/hackathon-experience` from `98e656f4`; active Trust Index product,
not the archived creature/Observer milestones. Work is not yet released through
the marketplace production project. This report is updated as integration closes.

## Review status

| Reviewer | Findings and disposition |
|---|---|
| Claims | Three P1s: empty gates shown as clean, delivery hash not inspectable/verified, missing public-input warning. Corrected with evidence-limited gate copy, browser manifest verification, and mandatory public-data consent. |
| Logic | No additional P0/P1 in bounded review. P2 policy check after resume corrected for all active job states. Concurrent seller submissions may consume a capped nonce on a revert; no global distributed lock is claimed. |
| Cost | P1 unbounded public request volume mitigated with active project-scoped WAF rules. Expensive historical funding lookup replaced with exact receipt proof; nonce checked early and again before signing. Polling bounded/non-overlapping; testnet self-pay rejected. |
| Security | Dedicated red-team reviewer failed to run twice because of a platform safety restriction, including on a defensive read-only request. This is **not a passed independent security gate**. Root performed a bounded source review and regression verification; no comprehensive audit is claimed. |

Legacy privacy claims C1–C11 and retention clocks are N/A to this active surface,
not retroactively passed for archived v1. No scoring thresholds or LLM routing changed.

## Verified deployment evidence

- Testnet seller: https://nibbin-reference-testnet.vercel.app
  - Provider: `0x6f736f824B27F686e6cC5dbd945f9727812a1c72`.
  - Fresh in-memory smoke buyer: `0xfE501c706f5BA6d71Deb92114e2fFFFbeb3A4002`;
    no key was persisted or existing buyer account used.
  - Job 1169 create: `0x044a391164d2b3233a5142d5f819aa06b3059d7889b37616bc5cd4d5011e19f7`.
  - Register: `0x11d846680c9bc34d08a9cb26416e79ef71f1f5f02027198c17c78af4e90972ed`.
  - Budget: `0x164e47f21d757883dbdb579ce1a8cd79d2c921e71e6a81a4922581c4348ce88e`.
  - Fund: `0xfed40b4ef60a1818ea10fb332a21d93cd63878f7bbf419fc96f63f48dd825c1b`.
  - Submit: `0x07a3892205ae7b4a9f14865a73a713a713af45c85f9d174df1dfb6204d6dd260`.
  - All four buyer receipts had effectiveGasPrice=0. Their combined gas units
    were 1,028,956. Browser wallet gas sponsorship is not implemented.
  - Result https://nibbin-reference-testnet.vercel.app/result/v1/97/1169 returned
    HTTP200 and health factor1.6633. SDK manifest verification matched chain digest
    `0x88fc77cf97381a25d19dcac47eca954c9a8c98935dfb57e4e7dba90a6023ef6e`.
    Verified status2/SUBMITTED; settlement not performed at this checkpoint.
- Mainnet seller: https://nibbin-reference-mainnet.vercel.app
  - Provider: `0xf1d2541ee88ad9DCcFC4D7526EEFB4b31Ee56645`.
  - Only allowed buyer: `0x51e048a166d22e2898790a4806652bcff6f03a36`.
  - Separate fresh key stored as a sensitive Vercel production environment value.
  - Explicit env: chain56, nonce ceiling3, maximum gas liability1e14wei/tx.
    User approved0.0003BNB total seller gas; buyer gas is separate.
  - Canonical payment token, commerce, router and policy had deployed bytecode.
  - Unfunded quote request returnedHTTP400 with no quote signed. No mainnet
    transaction, payment, funding or completed hire is claimed.
- WAF configuration for both projects is documented in
  `trust-index/apps/reference-seller/ops/README.md`. Active control-plane rules
  were independently read back; an observed429 burst test has not been run.

## Verification checkpoint

- Full workspace typecheck/build/source ESLint pass.
- Workspace tests:1,029 passed,25 skipped (database/service-dependent and one
  intentional engine-availability branch). Skips are not claimed as verified.
- Marketplace:51 tests,14 Python pipeline tests,242 static pages,112 null-endpoint
  export assertions, typecheck and source ESLint pass after the UX simplification.
  Seller:16 tests pass. Collectors:457 tests pass after the fresh endpoint refresh.
- Actual browser quote request verified signer, chain97 and zero price without
  a wallet. URL query hydration, zero-result filters and recovery were checked.
  Responsive hire form inspected at390px; a user-signed wallet journey is pending.
- Final UX browser checks:12 cards/page; page2 range13–24 of230; search resets
  page1; mobile document width stays within viewport; footer follows main with
  a32pxgap. The initial pause control was tested then removed at user request;
  reduced-motion handling remains. Live example
  job1169 manifest was verified in the browser without a wallet or transaction.
- Rebrand: Nibbin BNB Agent Marketplace, Trust Index as evidence feature. Removed
  duplicate category navigation/cards, decorative eyebrows and snapshot header.
  Source Sans3; CSS geometry with reduced-motion handling.
  Final read-only claims review found noP1 regression; stale example freshness copy
  and generic mainnet real-token warning were corrected.
- Follow-up UX: category icons/16px name spacing, inline details, evidence-first
  default, return-to-results preserving search/page, themed listboxes with keyboard
  typeahead/selection and view-transition crossfade. Table overflow is contained
  at390px (335px region with640px table,375px document width). The global heading
  reset moved into the base cascade layer so spacing utilities actually apply.

## Fresh endpoint evidence

The07:35:35–07:36:17UTC pass requested38 listed URLs and explicitly skipped two
unresolved templates.33 listed registrations share four confirmed MCP endpoints;
15 have card evidence,4 auth-wall evidence,28 response records,38 unmeasured
records,112 no assessment. These are registration counts, not independent tests.
The new immutable artifact and per-assessment source links preserve older readings
when a planned skip does not constitute a fresh observation. No behavioral scores,
tool executions, trades or authenticated accesses were added.

## Release limits

Injected EIP-1193 wallets and EIP-191 quotes only. Mainnet is allowlisted and
unfunded at this checkpoint. Reference tasks calculate supplied numbers; they
do not monitor real positions, trade, protect liquidation or assess other agents.
WAF counters are per-region and do not create an aggregate hosting budget.
