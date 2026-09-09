# Buyer reviews implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development task-by-task. Preserve all pre-existing worktree changes.

**Goal:** Public wallet-signed, completed-hire reviews with honest card summaries.
**Architecture:** Static marketplace plus isolated Node/Vercel review API and PostgreSQL. No seller signer access. Local tests precede public provisioning.
**Tech Stack:** Node 24, viem 2.56.0, pg 8.23.0, Next 15/React 19.
**Spec:** ../specs/2026-09-09-buyer-reviews-design.md

## Global constraints

- Integer rating 1–5; optional plain-text comment maximum 1,000 characters.
- Only reference:97:health-factor can publish in v1; provider 0x6f736f824B27F686e6cC5dbd945f9727812a1c72.
- Canonical chain-97 commerce 0xa206c0517B6371C6638CD9e4a42Cc9f02A33B0DE and router/hook 0xD7d36D66d2F1B608A0F943f722D27e3744f66F25.
- Completed job, actual buyer signature, 10-minute nonce, atomic one review per job. No mainnet publishing or wallet transactions.
- Testnet reviews and fictional demo examples never enter real mainnet summaries or Trust Index.
- Public storage failure is not success. No localStorage publication fallback. Preserve user funds, keys and existing changes.

## Shared HTTP contract

Single endpoint: configured NEXT_PUBLIC_REVIEWS_API_URL ending /api/reviews.
POST {action:'challenge',subject,jobId,buyer,rating,comment} -> {id,nonce,issuedAt,expiresAt,message}.
POST {action:'publish',challengeId,signature} -> {review,replayed:boolean}.
GET ?subjects=<comma-separated subjects> -> {summaries:[{subject,enabled,mainnet:{count,average,uniqueBuyers},testnet:{count,average,uniqueBuyers}}]} (max24).
GET ?subject=<subject>&cursor=<optional decimal review id> -> {reviews,nextCursor} (20 per page).
Public review: {id,subject,chainId,jobId,buyer,rating,comment,createdAt}.
Errors: {error:string}, meaningful 400/403/409/429/503.
Subject for ordinary agents: erc8004:<chain>:<tokenId>; they are read-only until authoritative seller mappings exist.

Signature message is exactly these lines joined with LF (no trailing LF):
```text
Nibbin buyer review v1
Audience: <API origin>
Subject: <subject>
Chain: 97
Commerce: <lowercase canonical commerce>
Job: <canonical decimal ID>
Buyer: <lowercase address>
Rating: <integer>/5
Comment: <JSON.stringify(comment)>
Nonce: <64 lowercase hex characters>
Issued at: <integer epoch seconds>
Expires at: <integer epoch seconds>
Public review. No transaction or spending approval.
```

### Task 1: Durable review service

Ownership: trust-index/apps/buyer-reviews/** only. Create package.json, lib/{protocol,service,postgres,chain}.mjs, api/reviews.mjs, migrations/001_reviews.sql, scripts/{migrate,dev}.mjs, tests/*.test.mjs, README.md, vercel.json.

- [ ] Write node:test cases using real viem signatures and controlled readJob/store boundaries. Assert unfinished/wrong buyer/provider rejects, text tampering fails, duplicates converge and storage failures reject.
```js
await assert.rejects(() => service.challenge({...input, rating: 0}), /rating/i);
await assert.rejects(() => service.publish({challengeId, signature: wrongSignature}), /signature|buyer/i);
```
- [ ] Run `node --test tests/*.test.mjs`; capture missing-feature failure.
- [ ] Implement strict protocol parsing, human-readable message, finalized RPC job read and fail-closed verification. Server owns nonce and fixed subject mapping.
- [ ] Implement parameterized PostgreSQL statements, unique job identity, challenge consumption + insert transaction, idempotent signed retries, bounded rate buckets, list pagination, network-separated aggregates and auditable hide script. No schema changes to seller/indexer stores.
- [ ] Implement bounded HTTP body and CORS with fixed allowlist; endpoint returns 503 without database configuration. No in-memory production store.
- [ ] Run offline tests and real isolated Postgres integration tests if a local server/container exists. Document skips accurately.

### Task 2: Review form and card presentation

Ownership: marketplace src/lib/reviews.ts, src/components/{BuyerReviewForm,BuyerReviews}.tsx, tests/reviews.test.mjs; small integration edits AgentCard.tsx, HireFlow.tsx, AgentExplorer.tsx and /try/page.tsx. Do not touch seller/API files.

- [ ] Write behavioral tests for strict challenge message reconstruction, API endpoint config, summary selection and signature request guards; capture failing run.
```js
assert.equal(reviewSummary({mainnet:{count:0,average:null,uniqueBuyers:0},testnet:{count:1,average:4,uniqueBuyers:1}},97).label,'Testnet reviews');
```
- [ ] Implement endpoint client with timeouts/body bounds, no fallback fake data, and exact message verification before personal_sign. Recheck account and chain before signing and publishing. Signed reviews may be retried after uncertain HTTP errors without a second signature.
- [ ] Add accessible rating radio controls, optional comment, full message preview, explicit public disclosure, cancellation/error/success states. Job Completed displays form; wallet rejection never publishes.
- [ ] Replace card placeholder with summary/read reviews, batched per page. Loading/error/empty distinctions. Render reviews in expandable details. Fictional demo examples have no real identities, no badges and no aggregation.
- [ ] Add reference testnet review display on /try and existing separate reference area. Preserve independent-unrated reference status.
- [ ] Run marketplace tests/typecheck; browser check desktop/mobile, no wallet transaction.

### Task 3: Integration, review and release readiness

Ownership: root coordinates reports, integration tests and deployment readiness; no overlapping worker edits.

- [ ] Compare server and browser message construction using same fixture and cross-module test, verify version/field agreement.
- [ ] Independently review Task1 security/quality and Task2 claims/UX; fix findings through original owners.
- [ ] Run production static build, marketplace tests/typecheck and service suite. Record exact results and deployment limitations in docs/STATE.md.
- [ ] Check available storage tools/accounts read-only. Do not provision a paid plan or run production migrations without authority. Public launch requires configured durable storage and API, not just local UI.
- [ ] Once deployed, user enters actual review and signs; read from separate browser to establish persistence. Until then report the remaining live-test step explicitly.

## Progress and preflight ledger

Existing worktree is codex/hackathon-experience, heavily dirty from authorized marketplace work; no bulk commits or resets.

| Tasks | Shared boundary | Check |
|---|---|---|
| 1 / 2 | HTTP and signature contract above | Exact fields fixed; client validates server message before signing. |
| 1 / 3 | DB lifecycle and public launch | No configured DB means explicit 503, never memory fallback. |
| 2 / 3 | Wallet browser proof | Offline tests cannot claim user signature or public persistence. |
| 1 | API/store tests vs implementation | Tests exercise core with real signatures; DB concurrency separately. |
| 2 | Existing component ownership | Only assigned files; preserve all prior UX and hire guards. |
| 3 | Release claims | Report build and live verification separately. |

Task 1: pending. Task 2: pending. Task 3: pending.
