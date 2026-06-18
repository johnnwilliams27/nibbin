# Adversarial gate — Promotion gate v2 (R1 coverage + R3 severity) (2026-06-18)

- **Branch / PR:** `feat/promotion-gate-v2` → `main`
- **Reviewed diff:** `git diff main..feat/promotion-gate-v2` at `482c2ba` (review) + the fix commit on top.
- **Gate run by:** Claude (4 adversarial reviewers, in parallel) on 2026-06-18.
- **Scope:** authoritative trust SQL — adds two **strictly additive** promotion conditions (R3 stakes-weighted ratio; R1 ≥4 distinct routine patterns for Senior→Grad) on the unchanged 95%/25 base gate. Spec: `docs/superpowers/specs/2026-06-18-promotion-rubric-design.md`.

## CI step
- typecheck (apps/web + packages/runtime): ✅ exit 0
- tests: ✅ `vitest run packages/runtime/test` → 71 passed (incl. R3 weighted-block, R3 cannot-loosen, R1 coverage-block, R1 senior-only, floor-only-tightens, edited-weighted)
- lint: ☑ (CI) · audit: ☑ (CI) · SAST: ☑ (CI) · redaction corpus: ☑ (CI) · trigger-graph: ☑ (CI)
- **SQL applied + verified on dev / staging / prod** (function body confirms coverage + severity + window-scoping; new window/coverage query validated against live dev rows — division guarded, no error).

## Adversarial reviewers (.claude/agents/*)
| Reviewer | Verdict | P0 | P1 | P2 | P3 |
|---|---|---|---|---|---|
| red-team | PASS | 0 | 0 | 2 | 1 |
| logic-skeptic | PASS | 0 | 0 | 2 | 3 |
| claims-auditor | PASS | 0 | 0 | 1 | 2 |
| cost-auditor | PASS | 0 | 0 | 2 | 1 |

**Core invariant verified by all four:** the gate is strictly additive — `eligible` only ever flips true→false; the base unweighted 95%/25 check is unchanged and required; no input promotes anything v1 refused. Floors only tighten (`greatest`/`Math.max` on 25/0.95/4). Window is count-based (no wall-clock — paused≠penalized). Egg→student branch byte-for-byte unchanged. No reset/fall-back. SQL is authoritative; the TS pre-check fails in the safe direction (can only wrongly withhold, never wrongly grant). SQL safe: `security definer` + `search_path=''`, service_role-only grant, guarded division, `patternKey` is a trusted server literal (coverage not gameable), `weight_class` server-stamped (severity not dodgeable).

## Findings (all P2 resolved in the fix commit; P3 tracked)
| # | Sev | Reviewer | File | Finding | Disposition |
|---|---|---|---|---|---|
| 1 | P2 | red-team, cost, claims, logic | nibbin_promote SQL + engine.ts | Coverage counted patterns over the WHOLE stage, not the qualifying 25-run window (spec divergence + unbounded `run_steps` scan + "ancient breadth + 25 easy runs" loophole) | **FIXED** — coverage scoped to a `win` CTE (last v_window decided); engine.ts mirrors via the windowed approved run_ids. |
| 2 | P2 | logic-skeptic | engine.ts maybePromote | Unbounded `.in('run_id', runIds)` (all-time run ids) could exceed PostgREST limits → pre-check wrongly returns 0 → a legit Senior never promotes (safe-direction, but real) | **FIXED** — query scoped by `runs.nibbin_id` via the inner join; the unbounded id list + the redundant approvals query removed. |
| 3 | P2 | red-team | SQL R3 + templates.ts | R3 is dormant today: all 6 templates ship `weight_class='standard'` (a model-cost tier, not per-action stakes), so weighted ratio ≡ unweighted | **DOCUMENTED** — code comment marks R3 a safe no-op until `weight_class` varies / a per-action stakes map lands. Tracked follow-up below. |
| 4 | P2 | claims-auditor | SQL + engine.ts comments | R1 comment overclaimed "currently-available patterns / paused can't block" — code consults neither pause nor availability | **FIXED** — reworded to "patterns proven (approved-unedited) within this window"; the overclaim wording removed (grep-clean). |
| 5 | P2 | logic-skeptic | trust-gate.test.ts | `edited` (the common near-miss) untested in R3, though it's weighted like a rejection | **FIXED** — added a case: 24×standard approved + 1×computer_use **edited** → weighted 24/34<0.95 → NOT eligible (71st test). |

## Tracked (non-blocking) follow-ups
- **F1 — R3 per-action stakes (from finding #3).** `weight_class` conflates *model cost* with *side-effect stakes*. To make R3 actually bite ("a rejected external send weighs more than a rejected internal draft"), introduce a per-run/per-step stakes weight derived from the side-effecting capability, mapped to 1/3/10. Until then R3 is a safe, inert scaffold. Belongs with the deferred "stakes taxonomy."
- **F2 — multi-pattern run (logic P3-2).** A single approved run emitting draft steps with N distinct `patternKey`s credits N toward coverage. Rare in practice (patternKeys are trusted server literals; runs typically emit one draft), and SQL↔TS consistent. If the rubric means "distinct approved *runs*," that's a spec refinement, not this PR.
- **F3 — patternKey coverage (plan note).** Agents whose draft steps don't set `patternKey` (none today; possible for future synthesized agents) silently cap at Senior — intended for narrow agents, but worth watching as Capture/synthesis bring-up adds agents.
- **F4 — run_steps index (cost P2).** Consider `create index run_steps_run_kind_idx on run_steps (run_id, kind)` — now low-priority since the queries are window-bounded (≤25 runs), but cheap insurance at scale.

## Disposition
- Blocking (P0/P1): **none.** Non-blocking P2: **all 5 resolved.** P3/follow-ups: tracked (F1–F4).
- **Gate verdict: PASS.**
- **Signed:** Claude on 2026-06-18 (on behalf of John).
