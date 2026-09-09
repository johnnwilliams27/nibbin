# Buyer review service

Independent Node 24 / Vercel API, PostgreSQL only. No wallet key or seller service access. Launch publishing is restricted to `reference:97:health-factor` and confirmed Completed BSC testnet jobs from the fixed provider/router mapping. Mainnet submission is disabled.

## Local operation

Run `npm ci`, configure `DATABASE_URL`, `REVIEWS_API_ORIGIN` (canonical origin, such as `http://localhost:3101`) and `REVIEWS_ALLOWED_ORIGINS` (comma-separated exact marketplace origins), then run `npm run migrate` against an isolated development database and `npm run dev`. Never point development fixtures at a public database. The marketplace endpoint is the API origin plus `/api/reviews`.

`npm test` exercises real viem signatures. With `REVIEWS_TEST_DATABASE_URL` pointing to an explicitly isolated test database, integration tests create a randomly named schema, exercise transactions and remove that schema afterward. Without it, the integration test is explicitly skipped. No memory-backed production store exists.

## API

POST `/api/reviews` JSON `{action:"challenge",subject,jobId,buyer,rating,comment}` returns `{id,nonce,issuedAt,expiresAt,message}`. Sign the exact message using the buyer wallet. POST `{action:"publish",challengeId,signature}` returns `{review,replayed}`. Job IDs are canonical decimal strings; ratings are integers 1–5; comment is optional, max 1,000 UTF-16 units, no controls/newlines. HTML-like text is stored as text and must be rendered as text by consumers. Challenge lifetime is 600 seconds.

GET `?subjects=subject1,subject2` accepts up to 24 subjects and returns `{summaries}` containing enabled, mainnet and testnet buckets. GET `?subject=...&cursor=...` returns `{reviews,nextCursor}`, 20 descending records per page. Public review fields are id, subject, chainId, jobId, buyer, rating, comment, createdAt. IDs are strings. There are no public admin endpoints. Hidden reviews are absent from listing and aggregates; a signed retry still returns the persisted acknowledgement, not a new publication.

Canonical messages match the implementation plan verbatim, binding API origin, subject, chain, commerce, job, buyer, rating, JSON-encoded comment, nonce and expiry. Identical signed retries return the original record even after expiry; altered reviews conflict. Signature verification happens before replay lookup. New publication rechecks finalized chain evidence, then atomically consumes the challenge and inserts under the unique job constraint. The chain client never fetches user URLs, checks chain 97, reads the job at a finalized block and rechecks that block hash. An unsupported finalized RPC response fails closed.

## Operations

Provision storage and apply migration only with deployment authority. `npm run migrate` is transactional/idempotent for this schema version. Vercel root directory should be this package; Node runtime 24. Configure the three variables above. The configured build runs `verify:deployment`: migration plus integration tests in a temporary schema, using `DATABASE_URL_UNPOOLED` for the tests when available. Use this build only with the approved dedicated review database. Static output is limited to `public`. Database connection URLs must enforce the provider's TLS requirements; certificate verification is never disabled in code. No credentials should be checked in or printed. Missing database/API origin returns 503. RPC/database exceptions return generic 503 and never a publication acknowledgement.

`npm run hide -- REVIEW_ID "audit reason" "operator identity"` atomically hides a record and records its audit reason. Run `node scripts/cleanup.mjs` daily to delete expired unused challenges older than one day; consumed challenges remain as evidence. Global durable rate cap is 600 requests/minute, individual reads 120/minute, writes 20/minute and challenge requests 10/minute. Bucket values saturate; old buckets are removed during requests. Deploy an upstream Vercel WAF rule as an additional volumetric limit. CORS permits configured origins but is not authentication. Vercel's platform-owned IP header is used only when VERCEL=1; local dev uses the socket address. Rate keys hash IPs; old rate buckets are discarded.

One wallet is not one human. Counts refer to unique buyer wallets, and testnet is always separate from mainnet. This service does not score agents, invent reviews, or add fictional examples to aggregates. Publishing a genuine review and verifying it from a separate browser remains a release check requiring the buyer's own text and signature.
