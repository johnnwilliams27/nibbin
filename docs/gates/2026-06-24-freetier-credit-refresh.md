# Adversarial gate — free-tier monthly credit refresh (2026-06-24)

- **Branch / PR:** `feat/freetier-credit-refresh` → `main`
- **Reviewed diff:** `git diff main..feat/freetier-credit-refresh`
- **Gate run by:** Claude Opus 4.8 (feature lead) + 4 adversarial sub-agents on 2026-06-24

## Feature summary
Usage metering (#259) now charges credits on ALL model usage. Paid tiers
(grove/canopy) get their monthly allowance from the Stripe webhook on each paid
invoice; the free **Hatchling** tier pays no invoice, so once it spends its
initial 100 credits it stays at/below zero forever. This adds a **monthly cron**
(`/api/cron/freetier-credit-refresh`, `0 3 1 * *`) that calls a set-based,
service-role RPC (`refresh_free_tier_credits`) to top every Hatchling account
**UP TO** its monthly allotment.

### Design decisions (documented for John)
- **Allotment:** `TIERS.hatchling.monthlyCredits = 100` credits/month (= $1.00 of
  usage at `USD_PER_CREDIT = $0.01`). Reused the existing constant — no new
  number invented.
- **Refresh semantics:** **top-up to the allotment** (`clamp(allotment -
  balance, 0, allotment)`), NOT add-the-allotment. A dormant account is refilled
  to 100 (never 200/300); an account at/above 100 gets 0 (no stacking); a
  negative balance is forgiven **up to one allotment only** (a deep overdraft is
  not fully wiped).
- **Idempotency:** keyed to the calendar month (`freemonthly_YYYY-MM`); deduped
  by a partial unique index `(account_id, source_id) where reason='refill'` +
  `on conflict do nothing`. A same-month re-run is a no-op.
- **Dedicated `refill` ledger reason** (not `grant`): a refill is a *variable*
  top-up deficit; `grant` is a *fixed* paid tier amount bound to
  `GRANT_AMOUNTS`. Keeping them distinct preserves the "grant ⇒ tier amount"
  invariant and keeps free/paid idempotency keys in disjoint index spaces.

## CI step
- typecheck: ☑  tests (3239+ passed; DB-integration/RLS failures are pre-existing
  parallel-Postgres contention — every error names an unrelated existing
  migration, isolated runs pass): ☑  lint: ☑  audit: n/a (no dep change)  build: ☑

## Adversarial reviewers (.claude/agents/*)
| Reviewer | Verdict | P0 | P1 | P2 | P3 |
|---|---|---|---|---|---|
| red-team | PASS (after fix) | 0 | 0 | 1→fixed | 2 |
| claims-auditor | PASS | 0 | 0 | 0 | 1 (=F1, fixed) |
| logic-skeptic | PASS (after fix) | 0 | 1→addressed | 2→fixed | 2 |
| cost-auditor (≥M2) | PASS | 0 | 0 | 0 | 2 (advisory) |

## Findings (severity-ranked)

- **F1 — P2 (red-team, logic-skeptic, claims-auditor — unanimous): grant
  invariant erosion.** The RPC originally wrote `reason='grant'` rows with
  arbitrary deltas (e.g. 30, 70), bypassing `validateAppend`'s `GRANT_AMOUNTS`
  check (the documented "grant ⇒ tier amount" invariant). DB accepted them
  (only `delta>0` enforced) but any audit re-validating the ledger would throw.
  **FIXED:** introduced a dedicated `refill` ledger reason (variable, bounded by
  one allotment, own unique index + CHECK). `grant` stays pure.
  `packages/shared/src/credits.ts`, migration.

- **F-overdraft — P2 (logic-skeptic): unbounded overdraft forgiveness.** A
  negative balance (usage soft-gate) was restored to the *full* allotment, so a
  −500 balance would be granted +600 — forgiving $5 of prior usage every month.
  **FIXED:** `freeRefreshDelta` and the RPC now cap the refill at one allotment
  (`least(allotment, allotment-balance)`), so a deep overdraft gets at most +100.

- **F-upgrade — P1 (logic-skeptic): free+paid double-allotment on a mid-month
  upgrade.** If the free job refills an account, then that account upgrades
  *later in the same month*, it keeps the refill (not clawed back) and also
  receives the paid grant — at most one free allotment (100cr / **$1**) of extra
  credit, that month only, not repeatable. **DISPOSITION: accepted & documented.**
  The two are now different reasons in disjoint index spaces (no invariant
  confusion). Clawing back a free refill on a later upgrade event is a risky
  cross-event reversal for a bounded $1 edge; not worth it. Flagged for John.
  Tested (`refill does NOT collide with a paid grant`).

- **F2 — P3 (red-team): deletion-grace blind spot.** The filter excluded only
  fully-purged accounts; an account mid-grace-window (`purge_after` set,
  `purged_at` null) still got refilled. **FIXED:** added `and a.purge_after is
  null`.

- **F3 — P3 (red-team, logic-skeptic): misleading "guarded" comment** about
  `accounts.purged_at`. **FIXED:** comment now states the migration depends on M7
  and references the columns unconditionally (verified M7 precedes it).

- **P3 (cost-auditor, advisory — FOR JOHN): no fleet-level free-tier spend cap.**
  Per-account cost is capped at $1/mo, but total cost scales linearly with free
  signups (10k free ⇒ $10k/mo max). Recommend confirming $1/mo is the intended
  free ceiling and considering a global monthly free-tier kill-switch before a
  GTM signup spike. Not a code defect.

- **P3 (cost-auditor, advisory): ledger-scan scaling.** The RPC full-aggregates
  `credit_ledger` (fastest-growing table post-#259). Fine now; revisit a
  per-account balance cache or range-batching before ~10M ledger rows. The job
  is pure SQL — zero LLM cost.

### Attacks that HELD (no finding)
- Credit farming via account churn: top-up semantics cap balance at the
  allotment; a reset can never exceed 100. Multi-account farming = N×$1, gated by
  upstream signup controls, no within-account amplification.
- Replay / double-refill (Vercel double-invoke, manual re-run): real idempotency
  via the partial unique index + `on conflict do nothing` + server-derived UTC
  period key.
- Paid account receiving a free refill: `subscriptions.account_id` is UNIQUE
  (no join fan-out); grove/canopy never matched.
- SQL injection via `p_period`: bound parameter concatenated into a value, never
  SQL text; `search_path=''`.
- AuthZ: RPC is `security definer`, revoked from public/anon/authenticated,
  granted to service_role only; route gate `isAuthorizedCronRequest` is
  fail-closed + constant-time (tested: no-header / wrong / unset → 401, no RPC).
- Append-only invariant: RPC only INSERTs; M1 append-only trigger blocks
  UPDATE/DELETE for every role.

## Disposition
- Blocking (P0/P1) resolved: ☑  (the one P1 is an accepted, documented, bounded
  $1 edge; the P2s are fixed via the `refill` reason + allotment cap)
- Non-blocking tracked: ☑  (two P3 cost advisories flagged for John)
- **Gate verdict:** PASS
- **Signed:** Claude Opus 4.8 (feature lead) on 2026-06-24 — pending John's review
