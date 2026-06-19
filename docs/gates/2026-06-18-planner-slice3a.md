# Adversarial Gate Report — Planner Slice 3a (supervised bounded-ReAct Planner, mode C)

**Date:** 2026-06-18
**Branch:** `feat/planner-slice3a`
**Surface:** the HIGHEST-stakes change of the synthesis arc — TWO novel surfaces at once: (1) runtime model-driven tool-selection (an untrusted LLM picks its next tool each turn), and (2) the first open-web egress (web-search). Plus a refactor of the proven runner and a money/action-movement path (approval→effect). Migration `20260618060000_plan_runs.sql`.
**Spec:** `docs/superpowers/specs/2026-06-18-planner-slice3a-design.md` · **Plan:** `docs/superpowers/plans/2026-06-18-planner-slice3a.md`
**Reviewers (4 lenses):** red-team · logic-skeptic · claims-auditor · cost-auditor
**Verdict: PASS** — no surviving P0/P1. The gate found NO P0; the core safety thesis was verified by all four. Four P1s + several P2/P3s were fixed in-branch (two were security-critical: an approval-path C8 surface bypass and a double-execute TOCTOU). Two low-risk items are tracked as explicit follow-ups.

## Security thesis (verified by the gate)
- **The loop cannot exceed its provisioned surface.** `validatePlanSpec` gates the plan up front; `validatePick` re-validates EVERY runtime pick fail-closed (tool ∈ `toolsAllowlist`; args schema-checked; connector granted; read path through `assertSafeReadPath`; raw atomic draft/write rejected — effectArgs are built by trusted primitive code). Invalid pick → re-prompt once → `failed`. `dispatchStep` independently re-checks allowlist + quarantine. (red-team + logic-skeptic confirmed; the core safety test drives an off-surface `email.send` pick → rejected, run `failed`, nothing executed.)
- **The `dispatchStep` refactor is genuine parity.** logic-skeptic diffed `origin/main`'s `executeRun` clause-for-clause against the extracted `dispatchStep`: identical gate order (read: allowlist→repetition→quarantine; compose: clamp→record-before-overshoot-kill; draft: allowlist→School→grant→idempotency→execute) and identical terminal mapping. The 145 pre-existing runner/interpreter/composer/2a/2b/2c tests stayed green (the only changed existing test is the router task count 18→19 for the new `plan_synthesis` tier — legitimate, not a weakening).
- **Web egress is privacy-safe.** Query redacted via `applyBattery` BEFORE egress (websearch.test asserts the egressed body lacks raw seeded PII); host fixed + allowlisted; `web.fetch` rejects non-http(s) / credentials-in-URL / private / loopback / link-local / metadata-IP (169.254.169.254) + `redirect:'error'`; results quarantined + length-capped.
- **Cross-account isolation + provisioning.** `plan_runs` RLS is member-read-only, all writes via service-role RPCs, anon revoked; `store.load(runId, accountId)` account-scopes; a foreign account gets `failed` and the row is untouched. The surface is fixed in the plan snapshot at preview and re-validated; the loop cannot self-grant (§7.3).
- **Every write is approval-gated.** The synthetic nibbin is `student` stage → `gateSideEffect` always drafts; the execute branch is documented-unreachable in the loop; writes pause as `needs_input(approval)`.
- **Bounded + budgeted.** `frontier` weight; per-iteration picker calls draw the per-user daily frontier budget (`plan_synthesis`, `origin:'chat'`, NOT unbudgeted) and are COGS-recorded; the loop terminates via `maxIterations` + wall-clock + repetition + no-progress + budget-exhaustion.

## Findings & dispositions (all P1/P2 fixed in-branch)
| # | Lens | Sev | Finding | Fix |
|---|------|-----|---------|-----|
| 1 | red-team | P1 | **Approval-execute skipped the surface/write-class check** — `resolveResponse` executed whatever `pending.context.tool` said, capability-agnostic; a latent ungated-auto-send and a C8 inconsistency vs `/approvals`. | `resolveResponse` now re-asserts the capability ∈ `state.plan.toolsAllowlist` AND `sideEffect !== 'write'` (only draft-class approval-executable) before executing; failure → run `failed`, never executes. (Plan runs hold no grant row — the supervised human approval is the authorization, so allowlist+draft-class is the correct gate, not `hasGrant`.) Confirmed it bites. |
| 2 | red-team + logic-skeptic + claims-auditor | P1 | **Approval double-execute TOCTOU** — the `idempotencyKey` was a no-op (executor ignored it; no `claim`, no CAS); two concurrent resolves → two drafts. | Two layers: (a) new `plan_run_resolve` RPC does an atomic CAS (`status='needs_input' AND pending->>'requestId'=...`) → only the single winner proceeds, losers return the terminal outcome without executing; (b) the approved effect routes through `idempotency.claim → execute → markExecuted` keyed `plan:{runId}:{requestId}`. Test: concurrent double-resume → `executed` length 1. |
| 3 | cost-auditor | P1 | **`startPlanRun` trusted client-supplied ceilings; `maxTokens` unbounded** in `validatePlanSpec`. | `startPlanRun` re-stamps the server-side `PLAN_CEILINGS` onto the posted plan; `validatePlanSpec` bounds `maxTokens` (≤ `MAX_PLAN_TOKENS` 20k + floor). |
| 4 | cost-auditor | P1 | **No rate/concurrency cap** on `proposePlan`/`startPlanRun` → daily budget burnable in seconds + concurrent loops' connector-draft spend ungoverned. | Per-account concurrent-`running` cap (`MAX_CONCURRENT_RUNNING=3` via `countRunning`) + a fail-safe 3s per-account rate guard on both entry points. |
| 5 | red-team + logic-skeptic | P2 | **No-progress kill was dead for utility picks** (`beforeLen` compared after the push → always "grew") → a wedged picker could spin on `web.*` egress for full `maxIterations`. | Utility progress now = scratchpad changed OR a non-empty observation differing from the prior; plus a `util:(tool,hashArgs)` repetition guard (reuses `REPETITION_KILL_AT`), both primed from the resumed transcript. |
| 6 | red-team + logic-skeptic | P2 | **`done`/`ask_human` tool-shape silently no-op'd** (only the flag-shape was handled) → a genuine escalation/finish dropped, run died at `max_iterations`. | The utility dispatch now normalizes the tool-shape: `{tool:'done'}` ends with the artifact; `{tool:'ask_human'}` pauses as `needs_input`. |
| 7 | cost-auditor | P2 | **No per-run web-egress cap** (only `maxIterations`). | `MAX_WEB_CALLS=4` per run; beyond it → a quarantined "budget exhausted" observation, no egress. |
| 8 | cost-auditor | P2 | **Picker `model_calls` rows lacked `run_id`** → per-run anomaly accounting blind. | `runId` threaded into the picker's `recordModelCall`. |
| 9 | claims-auditor | P2 | **Test-honesty gaps:** the loop-level web-redaction test was tautological (pre-redacted input); the reject-branch was claimed-but-untested; idempotency wasn't proven; the off-surface failure reason wasn't pinned. | Loop web test rewritten to assert the real contract (real redaction stays covered in `websearch.test`); reject-branch test added; double-resume at-most-once test added; off-surface failure reason pinned. |
| 10 | claims-auditor | P3 | **Stowaway files** in commit `bc38804`. | `git rm`'d `reference/nibbin-about.md` + `docs/.../review-deferred-bits.md`. The 4 Tauri gen schemas were KEPT — they are byte-identical to and already tracked on `origin/main`'s tip (added by main after the merge-base); removing them would delete files main has. |
| 11 | logic-skeptic | P3 | **`terminalOutcome` hardcoded the kill reason/error.** | The real terminal `reason`/`error` is persisted in the row and echoed on idempotent re-read. |

### Tracked follow-ups (non-blocking — noted, not fixed)
- **DNS-rebinding SSRF:** `isPrivateHost` is literal-IP/string based; a public hostname resolving to a private IP isn't blocked (`redirect:'error'` blunts redirect-rebind). Needs a custom fetch agent with a resolved-IP check. The metadata/literal-IP/credentials vectors ARE closed.
- **Repetition map not rebuilt for primitive-internal reads on resume** (logic-skeptic) — low risk, bounded by `maxSteps`/`maxIterations`.

## Verification (post-fix)
- `npx tsc --noEmit -p packages/runtime` → exit 0
- `npx tsc --noEmit -p apps/web` → exit 0
- `npx vitest run packages/runtime/test apps/web/` → **498 passed (63 files)**
- `npx eslint packages/runtime/src apps/web/lib/planner apps/web/lib/runtime apps/web/app/app/planner` → clean
- `npm run build -w @nibbin/web` → Compiled successfully; static pages 20/20

## Migration
`supabase/migrations/20260618060000_plan_runs.sql` — `plan_runs` table + RLS (member-read-only, service-role-only writes, anon revoked) + `plan_run_create` / `plan_run_save` / `plan_run_resolve` (the FIX-2 atomic CAS). Applied to dev / staging / prod by the controller (see apply log).

## Deferred (per spec §8) — arc state after 3a
Browser/`computer_use` tools; crystallization C→B (Slice 4); write-to-long-term-memory; batch-drafts; multi-agent delegate/sub-task; the two tracked follow-ups above.
