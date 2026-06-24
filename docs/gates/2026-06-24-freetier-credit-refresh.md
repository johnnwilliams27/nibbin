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

---

# Addendum — fleet-level free-tier spend KILL-SWITCH (2026-06-24, same PR #262)

Owner (John) decision: do NOT ship the recurring free giveaway without a
fleet-level spend ceiling + an instant off-switch. This addendum closes the
prior gate's own advisory (cost-auditor P3: "no fleet-level free-tier spend
cap") and re-runs the billing-sensitive adversarial gate against the full
updated diff.

## What the kill-switch does
- **Fleet monthly budget cap** (`FREE_TIER_FLEET_MONTHLY_BUDGET_CREDITS`,
  default **50,000 credits = $500/mo** at $0.01/credit). The RPC now takes a
  `p_budget` argument and grants free refills **oldest-account-first** until the
  PERIOD budget is exhausted, then stops (fail-safe: remaining accounts skipped,
  no error). Enforced INSIDE the set-based RPC (atomic), not in app code.
  - **Greedy partial fill:** the boundary account takes a partial refill of the
    remaining headroom (not all-or-nothing), so 100% of the budget is used and a
    large-deficit oldest account cannot permanently starve the smaller accounts
    behind it (logic-skeptic P2 fix).
  - **Idempotent under the cap:** credits already granted this period count
    toward the budget (`v_already`), so a re-run never double-spends.
  - **Concurrency-safe:** a period-scoped `pg_advisory_xact_lock` serializes
    same-period invocations (Vercel cron double-invoke / manual re-run), so two
    runs can't each read stale headroom and overshoot the cap (red-team P2 fix).
  - **Observable:** emits a `freetier_budget_capped` product event (fleet-level,
    `account_id = null`) when a non-zero ceiling clips wanted spend. Added to the
    `emit_product_event` allowlist (full prior allowlist preserved verbatim;
    exactly one new name).
- **Hard disable flag** (`FREETIER_REFRESH_ENABLED`, default ON). Set falsy
  (`false`/`0`/`no`/`off`) to turn the whole giveaway off **instantly, no
  deploy-revert** — the route returns `{ok:true, disabled:true}` and never calls
  the RPC.

### Knobs for John (both env-configurable)
| Env var | Default | Meaning |
|---|---|---|
| `FREETIER_REFRESH_ENABLED` | unset = ON | falsy ⇒ free grant fully off, instantly |
| `FREETIER_MONTHLY_BUDGET_CREDITS` | 50,000 (=$500/mo) | aggregate ceiling on free refill credits/calendar month; `0` = soft-pause |

**Default budget rationale:** deliberately round + conservative for a pre-GTM
product (≈ 500 fully-dormant free accounts fully topped, more for partially-spent
ones). **John's to tune** once real free-tier signup + spend telemetry lands.
Malformed/negative/absent env values fall back to the default (never silently
lifts the cap).

## CI step
- typecheck ☑  lint ☑  test (3644 passed / 8 skipped) ☑  build ☑  audit n/a (no dep change)
- SQL cap logic verified empirically against a real Postgres (nibbin-staging,
  in a rolled-back transaction): oldest-first partial fill, idempotent re-run no
  double-spend, paid accounts never refilled, at-allotment accounts skipped,
  capped flag pre-insert, starvation case (budget 50 / A1 deficit 100 / A2
  deficit 40 → A1 partial 50, full budget used, A2 advances next period), paused
  (budget 0 → no grant, no alert), advisory lock present.

## Adversarial reviewers (full updated diff)
| Reviewer | Verdict | Findings |
|---|---|---|
| red-team | PASS (after fix) | **P2 concurrency double-spend → FIXED** (advisory lock); rest of attack surface HELD |
| claims-auditor | PASS | 0 — every code/comment/doc claim verified (allowlist exact, $500=50k×$0.01, disable skips RPC) |
| logic-skeptic | PASS (after fix) | **P2 head-of-line starvation → FIXED** (partial fill); **P3 budget=0 alert noise → FIXED** (suppressed); P3 concurrent cap-flag → moot (lock serializes) |
| cost-auditor | PASS | prior advisory CLOSED; $500/mo default endorsed as conservative + tunable; job is pure SQL (~zero LLM cost); P3 ledger-scan scaling (inherited, revisit ~10M rows) |

## Kill-switch findings (resolved)
- **KS-1 — P2 (red-team): cap racy across concurrent invocations.** Two
  same-period cron fires could each read `v_already` pre-insert and each grant up
  to the headroom, overshooting by ~1×. **FIXED:** `pg_advisory_xact_lock` on the
  period key serializes them; the second reads the committed `v_already`.
- **KS-2 — P2 (logic-skeptic): head-of-line starvation.** Strict
  `cumulative <= v_remaining` was all-or-nothing per account, so an oldest account
  whose deficit exceeded the headroom blocked every younger account behind it,
  recurring monthly. **FIXED:** greedy partial fill — each account gets
  `least(deficit, headroom-before-it)`; the tail always advances and 100% of the
  budget is used.
- **KS-3 — P3 (logic-skeptic): paused-state alert noise.** `budget=0` (soft
  pause) reported `capped=true` and would emit the alert every paused month.
  **FIXED:** the capped flag + event are suppressed for the pure operator-pause
  case (`p_budget=0` with nothing yet granted).

## Accepted / inherited (unchanged)
- **F-upgrade — P1 (accepted, documented above):** free→paid mid-month upgrade
  keeps one free refill + gets the paid grant — bounded one-time ≈ $1, not
  clawed back. Still accepted.
- **P3 (cost-auditor): ledger-scan scaling** — the RPC full-aggregates
  `credit_ledger`; fine now, revisit batching before ~10M rows.

## Disposition (addendum)
- Blocking (P0/P1) from the kill-switch: none (the two P2s are FIXED + re-verified).
- **Gate verdict (addendum): PASS**
- **Signed:** Claude Opus 4.8 (feature lead) on 2026-06-24 — pending John's review
