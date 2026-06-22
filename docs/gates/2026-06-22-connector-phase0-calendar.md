# Adversarial Gate — Connector Batch Phase 0 + Calendar Proof (`feature/connector-phase0-calendar`)

**Date:** 2026-06-22
**Range:** `6bae0467..e9ca37c3` (4 commits, ~5 files)
**Plan:** `docs/superpowers/plans/2026-06-22-connector-batch-plan.md`
**Reviewers:** red-team (opus), logic-skeptic (sonnet), claims-auditor (sonnet), cost-auditor (sonnet)
**Sensitive surface:** `packages/runtime/` — a new calendar-write **verb** (`schedule.focus-block`) makes `calendar.event-create` reachable by synthesis for the first time; 4 new capability descriptors.

## Scope of change

1. Register 4 runtime capability descriptors (`crm.read`, `dm.read`, `gallery.read`, `dm.reply`) declared on connectors in `registry.ts` but missing from `CAPABILITY_REGISTRY` (Task 1). `dm.reply` is ONE shared write capability (honeybook + instagram-dm; nominal home honeybook).
2. Add `schedule.focus-block` calendar-write primitive: reads the calendar, finds the first overloaded weekday, proposes a 90-min focus block via `calendar.event-create` (Task 3 — the end-to-end proof for a second connector).

Per-connector executor branches (`invoice.nudge`, `dm.reply`) were **reclassified** to their connector phases (they need not-yet-built client write methods + velocity handling, and are inert until then).

## Verdicts

| Reviewer | Verdict | P0 | P1 | P2 |
|---|---|---|---|---|
| red-team | PASS | 0 | 0 | 1 |
| logic-skeptic | PASS | 0 | 0 | 1 |
| claims-auditor | PASS-WITH-FIXES | 0 | 1 | 0 |
| cost-auditor | CONDITIONAL PASS | 0 | 1 | 0 |

**Overall: PASS after fixes** (both P1s resolved; P2s are the same tracked timezone follow-up).

## Positive confirmations

- **No untrusted-data injection (red-team):** the event `summary` is a hardcoded literal; start/end ISO strings derive solely from the trusted `nowMs` clock via `isoDateAt`; calendar read content is used only as a numeric overload count; `byDay` is a `Map` so untrusted keys can't poison the trusted-key lookup or prototype; `calendarId` is never set from content (defaults to owner `primary`).
- **New write is contained (red-team):** action-level is the sole gate (observe/draft/send proven), at most one event per run on a single google-calendar connection, replay blocked by the effect idempotency key + the `calendar.event-create` resource-claim, `sanitizeEffectArgs` strips reserved keys as a backstop.
- **`dm.reply` fails closed (red-team):** registered with nominal home honeybook does NOT mis-resolve (validateSpec keys on `CONNECTOR_REGISTRY`), has NO executor branch (hits `default: throw "no executor"`) and no synthesis-reachable primitive — it cannot silently execute. Raw atomic writes rejected by `validateComposedSpec`.
- **Detection fires correctly (logic-skeptic):** `byDay` date-keying aligns with the `isoDateAt(nowMs, offset)` lookup for UTC events (Google Calendar's default); tests are substantively real (drive `executeRun` end-to-end, shared store for the idempotency replay, independently-constructed payloads).
- **Routing/cost unchanged (cost-auditor):** descriptors are pure metadata; the primitive adds one read + at most one create per run; no N+1, no routing/token change.

## Findings → resolution

- **P1 (cost-auditor) — cross-run pile-up.** The send-path idempotency key falls back to `runId` for schedule triggers (no `dedupeKey`), so a daily Send-level run would create a new focus block on the same overloaded day every day. The reviewer's proposed fix (date in `patternKey`) was verified **insufficient** — the key already includes `effectArgs`/date, but the `runId` scope still varies per run. **Resolved (`e9ca37c3`)** with the correct fix: the primitive reads the calendar anyway, so it now **skips any day that already carries a `FOCUS_BLOCK_SUMMARY` event** — idempotent by self-observation, independent of the trigger dedupeKey. New unit test covers it.
- **P1 (claims-auditor) — misleading draft copy.** "your busiest upcoming day" implied a max-density sort; the algorithm picks the FIRST overloaded weekday. **Resolved (`e9ca37c3`)** → "your next overloaded weekday." Shared `FOCUS_BLOCK_SUMMARY` const so detection and creation can't drift.
- **P2 (red-team + logic-skeptic) — timezone-naive 08:00Z slot.** For a US owner the block lands overnight; for non-UTC events near midnight the `slice(0,10)` vs UTC-compute date keys can ±1-day miscount. No security impact. **Tracked** as a self-documented follow-up in the primitive (the timezone-aware slot is calendar use-case work the Planner will parameterize).

## Advisories (non-blocking)

- `dm.reply`'s nominal `requiredConnector: honeybook` would, in a *hypothetical* composed atomic use, make crystallize demand a honeybook grant — unreachable today because `validateComposedSpec`/`crystallizeTranscript` reject raw atomic writes (logic-skeptic + Task-1 review M1).

## Verification

Full runtime suite **331 passed**; lint clean; CI typecheck/build is the cross-package arbiter (worktree `@nibbin/*` tsc errors are stale-symlink false-positives).

**Gate status: PASS** (no P0; both P1 resolved and re-tested; P2 tracked).
