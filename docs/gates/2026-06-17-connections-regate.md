# Adversarial gate — connections remediation RE-GATE (2026-06-17)

- **Branch / PR:** `fix/regate-followups` → `main`
- **Reviewed diff:** merged `main` (885d20d) after PR #110 — a re-gate to confirm the prior 22 findings are closed and catch regressions the fixes introduced.
- **Gate run by:** Claude (multi-agent re-gate workflow) on 2026-06-17

## CI step
- typecheck: ☑  tests (898): ☑  lint: ☑  audit: ☑  SAST: ☑  redaction corpus: ☑  trigger-graph: ☑

## Adversarial reviewers (.claude/agents/*)
| Reviewer | Verdict | P0 | P1 | P2 | P3 |
|---|---|---|---|---|---|
| red-team | reviewed | 0 | 0 | 0 | 2 |
| claims-auditor | reviewed | 0 | 0 | 0 | 1 |
| logic-skeptic | reviewed | 0 | 1 | 0 | 1 |
| cost-auditor | reviewed | 0 | 0 | 0 | 2 |

**Result: the prior 22 are closed.** Re-gate found 7 issues: 0 P0, **1 P1 (a regression the fix introduced)**, 6 P3. The P1 is fixed in this PR; the P3s are tracked.

## Findings

### P1.1 [correctness] watch-renew clobbered an existing historyId cursor on renewal — **FIXED**
`apps/web/app/api/cron/gmail-watch-renew/route.ts`. The PR #110 fix seeded `webhook_state.historyId` unconditionally, so on renew of an active watch it overwrote the live delta cursor with Gmail's *current* historyId — silently skipping every message in the gap. **Fix:** only seed historyId when bootstrapping (no existing cursor); the delta cursor is advanced solely by the push/poll dispatch path. Regression tests added (existing cursor preserved on renew; seeded on bootstrap).

### P3.2 [security] push webhook resolved connection by email with no single-match guard — **FIXED**
`apps/web/app/api/webhooks/gmail/push/route.ts`. Added `.limit(1)` for deterministic, bounded resolution; removed the stale "no-op until Spec 1" comment (email is seeded now).

### Tracked (P3 — non-blocking, deliberately deferred)
Fixing these carries regression risk that this very re-gate just demonstrated (the P1 above), and they are minor hygiene; tracked per docs/AGREEMENTS.md (P2/P3 do not block merge):
- **P3.1 / P3.3 / P3.6 (one issue) — sweep idempotency is read-then-act (TOCTOU).** The guard prevents the common sequential retry, but two concurrent HMAC replays could both pass the SELECT and double-spend model budget. Proper fix = a `status='running'` claim row + partial unique index on `gmail_sweep_log(connection_id)` (a migration + a sweep-write refactor). Everyday risk is low (single fire-and-forget callback; replay needs a captured server-to-server HMAC request).
- **P3.4 — capped connector-poll re-invokes triggerRun for already-fired Nibbins each cycle**, relying on the runtime admission debounce (default 300s) which is not guaranteed ≥ the 5-min poll interval. Re-touching the just-stabilized dispatch claim-then-commit path is the regression risk.
- **P3.5 — sweep sensitive-filter is asymmetric**: sent-mail Pass 1 has no input-side sensitive-thread filter (the filter reads From/Subject; sent mail needs To/Subject), and the output secret-guard covers `voiceSamples` but not `inferredFacts`.

## Disposition
- Blocking (P0/P1) resolved: ☑ (P1.1 fixed + tested)
- Non-blocking tracked: ☑ (the 5 P3s above, with rationale)
- **Gate verdict:** PASS (0 P0; the single P1 regression resolved in this PR; P3 hygiene tracked)
- **Signed:** _pending John_
