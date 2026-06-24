# Adversarial gate — connector re-nudge cadence / safety floor (2026-06-24)

- **Branch / PR:** `feat/connector-renudge-floor` → `main`
- **Reviewed diff:** `git diff main..feat/connector-renudge-floor` at `78cc234c` (+ fix commit)
- **Gate run by:** Claude Opus 4.8 (feature lead) on 2026-06-24
- **Feature:** Connector batch Task 5a — a cross-run re-nudge safety floor for the
  Stripe overdue-invoice email nudge (PR #237). Required before any Tally Nibbin
  may run at the `act` (Send) action level.

## CI step
- typecheck: ✅ (clean after `rm -rf apps/web/.next apps/admin/.next`)
- tests (count): ✅ 425 passed (packages/runtime + apps/web/lib/runtime); the 21
  failing files are all `tests/rls/*` requiring a live Postgres (env-gated, not
  this change) — CI is the arbiter for those.
- lint: ✅  build: ✅
- audit / SAST / redaction corpus / trigger-graph: not affected by this diff.

## Adversarial reviewers (.claude/agents/*)
| Reviewer | Verdict | P0 | P1 | P2 | P3 |
|---|---|---|---|---|---|
| red-team | PASS (conditional) | 0 | 0 | 2 | 2 |
| claims-auditor | PASS | 0 | 0 | 1 | 1 |
| logic-skeptic | PASS | 0 | 0 | 2 | 3 |
| cost-auditor (≥M2) | PASS | 0 | 0 | 1 | 2 |

No P0/P1 from any reviewer. All actionable P2s resolved; P3s resolved or
documented as accepted.

## Findings (severity-ranked)

- **P2 (red-team + claims-auditor) — NaN clamp hole.** `resolveCadencePolicy`
  used `Math.max/Math.min`, which propagate `NaN` (`typeof NaN === 'number'`
  slips past the type guard), silently DISABLING both gates (`x < NaN` /
  `x >= NaN` are false). A crafted `nudgeCadence:{maxNudges:NaN}` would defeat
  the hard count cap. **FIXED** — `resolveCadencePolicy` now coerces non-finite
  input to the clamped default via `Number.isFinite` before clamping
  (`nudge-floor.ts`). Regression test added (`nudge-floor.test.ts`).

- **P2 (cost-auditor) — sustained `record` failure silently resumes spam.** A
  durable nudge-ledger write failure (writes down, reads up) would reset the
  cap/cadence and resume per-tick sends, observable only as a `console.warn`.
  **FIXED** — the runner now emits a `nudge_record_failed` product event
  (structural only: `{resourceKind}`, no id/PII) so a sustained failure is
  alarmable. New event added to the `product_events` allowlist (runtime
  `events.ts` + the migration's `emit_product_event` recreation).

- **P2 (logic-skeptic) — "lifetime cap" is actually a 180-day windowed cap,
  silently coupled to the 90-day Stripe read window.** The `≤ FLOOR_MAX_NUDGES`
  property is only a lifetime cap while `read window < lookback`. **FIXED** — the
  read window is now a named constant `OVERDUE_INVOICE_READ_WINDOW_MS` with a
  documented coupling, and a CI test asserts `NUDGE_LOOKBACK_MS > read window`
  (trips CI if anyone widens the read window). The residual (a never-paid invoice
  left `open` > 180 days could accrue ≤4 more nudges in the next window) is
  documented and accepted as tiny.

- **P2 (logic-skeptic) — clock-source mismatch.** The floor decision uses
  `deps.now()`; the ledger row is stamped with DB `now()` (the `atMs` param is
  not threaded to `record_nudge`). **ACCEPTED + documented.** Skew is normally
  sub-second; the ledger is DB-clock authoritative and the floor tolerates skew.
  `atMs` is retained on the interface for the in-memory store (which honors it)
  and for a future `p_at` parameter; the divergence is noted in code.

- **P3 (claims-auditor) — test gap.** The integration docstring claimed "only
  touches nudge sends" with no test exercising a non-invoice send. **FIXED** —
  added a test that drives an ordinary `email.send` reply (threadId, no
  invoiceId) through `executeRun` with a would-block floor store and asserts the
  send fires (the floor is never consulted).

- **P3 (logic-skeptic) — record-failure comment understated the interval-floor
  breach.** Corrected the runner comment: a missed record can fire one send
  inside the interval floor (not just erode the count). The velocity cap is the
  absolute-volume backstop; sustained failure is alarmed (P2 above).

- **P3 (logic-skeptic) — Stripe-coordination null/past `next_payment_attempt`.**
  Documented as intentional: null/past = "Stripe not currently dunning" → we
  nudge; only a future scheduled retry suppresses the nudge.

- **P3 (cost-auditor) — `record_nudge` trusts caller `p_account`.** Service-role
  only; a wrong account id only mis-files a cadence row (can only make the floor
  stricter). Accepted.

- **Draft-level bypass (logic-skeptic, informational).** The floor binds the
  `act`/auto-execute send only; at Draft level the human approving each draft is
  the rate-limiter and approved drafts are sent manually from Gmail (no
  server-side send). Any FUTURE server-side send-of-approved-draft MUST route
  through `deriveNudgeFloor`/`decideNudge`/`record`. Noted in code.

## Disposition
- Blocking (P0/P1) resolved: ✅ (none raised)
- Non-blocking tracked: ✅ (P2s fixed; P3s fixed or documented-accepted)
- **Gate verdict:** PASS
- **Signed:** (pending John) on 2026-06-24
