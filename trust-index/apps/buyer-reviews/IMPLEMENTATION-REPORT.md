# Task 1 implementation evidence

2026-09-09. Ownership was limited to this package; no seller, marketplace, indexer, production data, keys or transactions changed by this worker.

Implemented the agreed API/message contract, viem buyer signatures, strict payload parsing, fixed provider/chain/commerce/router checks, finalized block reads with hash recheck, PostgreSQL transactions and unique job identity, exact signed retries, public paging and separate network summaries, durable rate buckets, CORS/body bounds, local HTTP development server, transactional idempotent migration, operator audit/hide and expired-challenge cleanup. There is no production memory store.

## Test evidence

- Tests were written before the service, PostgreSQL adapter and HTTP handler. After dependency installation the first run failed with three missing implementation module errors (service, postgres, handler). Earlier setup runs exposed a test syntax issue and then missing viem installation; these were corrected before implementation.
- The initial implemented suite passed 25 tests, with one explicit PostgreSQL skip. The chain adapter's three subsequent tests failed because the controlled RPC client was not yet injectable; adding that boundary made finalized-block/hash/chain checks testable and passing.
- Real viem signatures are generated from fixed test-only keys (never live wallets). Tests exercise wrong signer, rating/comment tampering, expired nonce, unfinished/rejected jobs, wrong buyer/provider/router/hook/job, unsupported input, publication-time job recheck, RPC/storage failures, strict HTTP body/origin/page limits, and public-field exclusion.
- PostgreSQL integration test requires `REVIEWS_TEST_DATABASE_URL`. It creates an isolated UUID-named schema; tests concurrent publication, immutable conflicts, paging, network aggregates, audit hiding and rate counters; drops only that schema afterward. It has not run locally: Docker daemon is unavailable and psql is absent. A skipped test does not establish database correctness.

## Release limitations

Root coordinates approved isolated Neon provisioning and deployment. No credentials were fetched by this worker. Live read-only service RPC verification confirmed job 1179 Completed, expected buyer/provider, at finalized block 129999992 with hash `0x88b7275e10783a12943f59dbe79b1840d8d223736d2846c91954dfa0c035182b`. The fixed RPC is `https://bsc-testnet-dataseed.bnbchain.org`. The final proof requires the buyer to supply actual text/rating and sign, then read the persisted review from another browser. Offline tests are not public-persistence evidence.

Apply the migration only to authorized isolated review storage. Runtime environment names: `DATABASE_URL`, `REVIEWS_API_ORIGIN`, `REVIEWS_ALLOWED_ORIGINS`. Schedule `node scripts/cleanup.mjs` daily and configure upstream WAF limits. Rate limiting is shared across instances through PostgreSQL but upstream request volume still consumes database work. The service supports ordinary EOA personal-sign signatures (65-byte); smart-contract wallets/EIP-1271 are not enabled in this first slice.

Worker final local suite: 32 passing, 1 isolated PostgreSQL test skipped. The cloud `verify:deployment` build migrates the approved dedicated database then runs that PostgreSQL test with `DATABASE_URL_UNPOOLED` (falling back to DATABASE_URL) only in its child environment. It creates/drops only its generated schema. The concurrency test includes both same-challenge retry and two distinct actual buyer-signed challenges for a fresh job. The static output directory is limited to `public`; no package source is intentionally exported.

Vercel parsed-body regression was reproduced (400 instead of expected 200), then fixed with bounded parsing of either the platform body or native request stream. Runtime origin config is trimmed to tolerate CLI newlines. Slow streaming body requests still rely on Vercel's 60-second function duration (and Node server timeout in local development); no custom 10-second body deadline was added in this slice. Exact release test totals should be taken from the root integration run, including whether the isolated PostgreSQL test ran.
