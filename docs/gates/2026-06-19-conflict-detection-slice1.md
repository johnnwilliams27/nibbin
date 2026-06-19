# Adversarial gate — Multi-agent conflict detection Slice 1 (SPEC §18.3 / R53)

- **Branch / PR:** `feat/conflict-detection-slice1` → `main`
- **Scope:** `resource_claims` table + `claim_resource`/`release_run_claims` RPCs + auto-release
  trigger (migration `20260619310000`); runtime claim-before-send integration
  (`packages/runtime`); the production claim store wired into the runner (`apps/web/lib/runtime`).
- **Slice 1 = the focused cut (John's call):** claim ONLY at the irreversible auto-execute/send
  point; drafts that pause for human approval are NOT claimed (the human is the dedup).

## Design / invariants
- **One active claim per resource per account** — DB-enforced by the partial unique index
  `resource_claims (account_id, resource_type, resource_id) where released_at is null`.
- **`claim_resource`** (service_role-only, under `lock_account`): granted=true on a free resource,
  idempotent re-grant for the same run, reclaim of a terminal/stale holder (holder run's
  `ended_at` set, or claim >24h old); granted=false + holder identity on a live conflict.
- **Auto-release** via a trigger on `runs.ended_at` (null→set). `run_finish` sets `ended_at` for
  completed/failed/killed and leaves it null for `awaiting_approval`, so a claim is correctly held
  across an approval wait and released the instant the run terminates. Path-independent + crash-safe
  (fires in the finishing txn). Stale-reclaim covers a never-finished run.
- **Single send chokepoint:** the only irreversible auto-execute is the `gate.action==='execute'`
  branch in `dispatchStep` (`packages/runtime/src/runner.ts`). The planner's approved-send path is
  already blocked from `sideEffect:'write'` (it only sends `draft`-class, human-dedup'd), so no
  claim is needed there.
- **Resource identity:** `deriveResourceClaim(step)` → email = `effectArgs.threadId`||`inReplyTo`
  (`resource_type='email'`); invoice = `effectArgs.invoiceId` (`resource_type='invoice'`). No
  derivable id → claim skipped (send proceeds).
- **On conflict (granted=false):** the send is SKIPPED (never double-acts); the run completes with
  a `resource_conflict` annotation naming the holder Nibbin.
- **Fail-OPEN on infra error (deliberate):** if `claim_resource` THROWS (DB error, not a conflict),
  the runner catches and PROCEEDS with the send. Conflict detection is additive protection; an
  outage must not drop legitimate sends. A genuine granted=false is NOT an error and DOES skip.
- **Production wiring:** `SupabaseResourceClaimStore` (`apps/web/lib/runtime/stores.ts`) calls the
  `claim_resource` RPC and is passed as `claims` into the runner deps in `engine.ts` — so the
  feature is live, not an inert table. (The implementer's first pass shipped only the seam +
  in-memory store; the production store + wiring were added here.)

## Tests
- `tests/rls/resource-claims.test.ts` (live PG, CI): first-claim-granted; second active run refused
  with the holder; idempotent self-reclaim; independent resources; **auto-release on run_finish
  frees the resource**; service_role-only (authenticated/anon denied); member-read + no client write.
- `packages/runtime/test/conflict-detection.test.ts` (16): `deriveResourceClaim` cases; granted→send
  proceeds; conflict→send skipped + recorded; invoice conflict; fail-open on infra error; no-store
  wired → proceeds; same-run idempotency; no-derivable-id → skip.

## CI / local checks
- Migration applied + structurally verified on **dev** (table, 5-arg `claim_resource`
  service_role-only, release trigger, unique index). Staging/prod at merge.
- Runtime tests green (40 incl. runner-invariants no-regression). Lint clean on touched files.
- tsc: only `@nibbin/*` "Cannot find module" worktree artifacts (49-file class incl. adopt.ts) +
  their downstream implicit-any cascades; CI's fresh install resolves them (versioning-PR precedent).
  `SupabaseResourceClaimStore` matches the `ResourceClaimStore` interface exactly.

## Verdicts
(appended after the reviewer pass)
