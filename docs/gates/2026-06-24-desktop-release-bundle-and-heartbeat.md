# Adversarial gate — desktop-release bundle clean + daemon heartbeat ungate (2026-06-24)

- **Branch / PR:** `fix/desktop-release-bundle-and-heartbeat` → `main` (#260)
- **Reviewed diff:** `git diff main..HEAD` at `25b8a447`
- **Gate run by:** Claude (4 parallel reviewers) on 2026-06-24

Two desktop-release hygiene fixes:
1. `.github/workflows/desktop-release.yml` — a `Clean stale installer bundles`
   step (before `tauri build`) wipes cache-restored `release/bundle` dirs so the
   release no longer leaks the prior version's installers.
2. `apps/desktop/src-tauri/app/src/lib.rs` — the app's status-refresher thread
   writes the daemon parent-liveness heartbeat (`app.heartbeat`) every tick
   unless the **last known** study state is `DELETED` (`last_known_deleted`,
   updated on a successful read, retained on a torn/`Err` read). Fixes MINOR-1:
   the old code only beat inside `if let Ok(status)`, so a torn mid-write read
   skipped the beat and could trip the daemon's fail-closed self-suspend on a
   live app.

## CI step (PR #260)
- typecheck: ☑  tests: ☑ (full suite green)  lint: ☑  audit: ☑  SAST: ☑  redaction corpus: ☑  trigger-graph: n/a
- Desktop app crate (cargo check): ☑  Observer daemon (fmt, clippy, cargo test): ☑  `rustfmt --check`: ☑  workflow YAML: ☑ valid

## Adversarial reviewers (.claude/agents/*)
| Reviewer | Verdict | P0 | P1 | P2 | P3 |
|---|---|---|---|---|---|
| red-team | PASS (no blocking) | 0 | 0 | 1 | 0 |
| claims-auditor | PASS | 0 | 0 | 0 | 1 |
| logic-skeptic | PASS | 0 | 0 | 0 | 2 |
| cost-auditor | N/A (no cost surface) | 0 | 0 | 0 | 0 |

## Findings (severity-ranked)

### P2 — C3 receipt-vs-disk race can leave a timestamp-only `app.heartbeat` residue (PRE-EXISTING; not introduced by this diff) — TRACKED
- **Where:** `apps/desktop/src-tauri/app/src/lib.rs` refresher loop ×
  `apps/desktop/src-tauri/observerd/src/lib.rs:622` `delete_raw_and_verify`.
- **Impact:** During the daemon's delete→verify→persist window, a concurrent app
  tick can re-write `app.heartbeat` after the verifier reported
  `verified=true`, so the C3 receipt's "nothing but study.json survives" claim
  can be momentarily false on disk. Residue is an RFC3339 timestamp only — **no
  raw data / no PII**, so not a privacy breach. A sibling interleaving can also
  cause a spurious (fail-closed, safe) deletion error.
- **Why not introduced by this PR:** `delete_raw_and_verify` removes
  `daemon.status` (line 640) *before* it verifies, so in the verify window
  `read_status` returns `Ok(DAEMON_OFFLINE)` (a missing status file is `Ok`, not
  `Err`). The **old** code (`if let Ok(status)` + `state != DELETED`) wrote the
  beat in exactly that case too, and no torn read can occur in the window
  (`daemon.status` is absent and `study.json` is not being written until
  `apply(DeletionVerified)` at line 667). So the new code is behaviorally
  identical here — the race predates this diff.
- **Fix (follow-up, daemon-side):** in `delete_raw_and_verify`, write the
  `DELETED` state (study.json/daemon.status) *before* removing `app.heartbeat`
  and verifying, so a concurrent `read_status` sees `DELETED` and suppresses the
  beat; or re-remove `app.heartbeat` + re-verify after `apply(DeletionVerified)`.
  Out of scope for this hygiene PR (touches the C3 deletion sequence, itself a
  sensitive surface). Tracked in the Company-Brain / desktop backlog.
- **Status:** Non-blocking, pre-existing, tracked.

### P3 — comment slightly overgeneralizes `last_known_deleted` stickiness (claims-auditor, logic-skeptic)
- A *clean* read while the daemon is offline returns `state:"DAEMON_OFFLINE"`
  (sourced from `daemon.status`, not `study.json`), which flips
  `last_known_deleted` back to `false`. The comment's "sticky across a torn read
  post-deletion" is accurate for *torn (`Err`)* reads (the stated scenario);
  the `DAEMON_OFFLINE` case is harmless (an offline daemon reads no heartbeat).
  Documentation nuance only — no code change required. **Status:** accepted.

### P3 — `find ... -path '*/release/bundle'` is name-based, not Tauri-aware (logic-skeptic)
- The clean step removes any dir whose path ends `*/release/bundle` under
  `target/`. Today only Tauri produces those; correct now. If future tooling
  ever nested an unrelated `release/bundle` under `target/`, it would be wiped.
  Not actionable. **Status:** accepted.

## Disposition
- Blocking (P0/P1) resolved: ☑ (none found)
- Non-blocking tracked: ☑ (P2 pre-existing C3 residue race → desktop backlog)
- **Gate verdict:** PASS
- **Signed:** Claude (pending John) on 2026-06-24
