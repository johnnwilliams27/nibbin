# Adversarial gate — Promotion gate v3: per-action stakes (F1) + index (F4) (2026-06-18)

- **Branch / PR:** `feat/promotion-gate-v3-stakes` → `main`
- **Reviewed diff:** `git diff main..feat/promotion-gate-v3-stakes` at `a649213`.
- **Scope:** finishes the #128 rubric follow-up **F1** — R3 severity now weights each decision by per-run **side-effect stakes** (`capability_stakes(run_steps.tool)`, max over a run's steps) instead of the dormant model-cost `weight_class` — plus **F4** (`run_steps(run_id,kind)` index). Migration `20260618020000_…`. Inherits the full v2 gate (`docs/gates/2026-06-18-promotion-gate-v2.md`); this is a scoped weight-basis swap.

## CI step
- typecheck (apps/web + packages/runtime): ✅ exit 0
- tests: ✅ `vitest run packages/runtime/test apps/web/` → 315 passed, incl. new `stakesOf` mapping cases + the `stakesOf('') === 3` parity pin. Existing R3 weighted-block / cannot-loosen `promotionCheck` cases unchanged (they pass `weights` arrays directly — unaffected by the weight *source* change).
- **SQL applied + verified on dev / staging / prod:** `capability_stakes` maps correctly (read=1, draft/nudge=3, delete/archive=10, null=1), `nibbin_promote` uses it, `run_steps_run_kind_idx` present.

## Verification of the two load-bearing properties
- **Non-loosening (controller-verified by diff):** `diff` of v3 vs v2 `nibbin_promote` shows the ONLY executable change is the `win` CTE `weight` expression (`case r.weight_class…` → `coalesce((select max(capability_stakes(rs.tool))…),1)`). Base unweighted 95%/25 gate, R3 condition, R1 coverage CTE, egg branch, floors (`greatest`), update/audit, and grants are byte-identical. R3 remains an additive AND after the unchanged base gate → v3 promotes a **subset** of what v2 would (strictly stricter), never more.
- **Non-gameable stakes:** `run_steps.tool` is written server-side by the runner (`runner.ts` `tool: step.capability`) from the trusted in-repo program literal — never from connector content, model output, or client input. A user/agent cannot relabel a high-stakes send as a `.read` to dodge weighting.

## Adversarial review (logic-skeptic + red-team on the weight-swap)
| Reviewer | Verdict | P0 | P1 | P2 | P3 |
|---|---|---|---|---|---|
| logic-skeptic | PASS | 0 | 0 | 0 | 1 (fixed) + nits |
| red-team | PASS | 0 | 0 | 0 | 0 |

- **logic-skeptic** confirmed non-loosening, SQL↔TS max-stakes alignment, count-eligibility early-return safety, division guards. **P3 (fixed):** `stakesOf('')` returned 1 (empty string falsy) while SQL `capability_stakes('')` returns 3 — a latent SQL↔TS divergence (unreachable today: capabilities are non-empty validated literals; NULL is the real no-tool sentinel and agrees at 1; SQL is authoritative so worst case = one wasted RPC). **Fixed `a649213`:** `stakesOf` guard changed to `capability == null` so `''` falls through to 3, matching SQL; test pins `stakesOf('') === 3`.
- **red-team** confirmed the stakes signal is server-set/non-gameable, the change is monotonic-tightening (v3 ⊆ v2 in what it promotes), `capability_stakes` is `immutable`/`search_path=''`/pure (no injection or RLS surface), and "unknown ⇒ 3" is the safe/stricter direction.
- Optional P3s left (auditor-endorsed): `capability_stakes` keeps default PUBLIC execute (a pure, data-free helper — no concern); "keep in sync" covered by the inline comment.

## Follow-ups resolved this PR (the rest of the #128/#129 backlog)
- **F1 — DONE** (this PR): R3 bites via per-action stakes.
- **F4 — DONE** (this PR): `run_steps(run_id,kind)` index.
- **F2 — resolved (no code):** coverage counts distinct `patternKey`s = the breadth metric; current programs emit exactly one draft (one patternKey) per run, so single-run inflation is unreachable. Revisit only if multi-draft programs land.
- **F3 — resolved (verified):** all six shipped programs set a `patternKey` on their draft step; "patternKey-less caps at Senior" can't bite today — it becomes a synthesis-time requirement.
- **cost-nit — wontfix (auditor-endorsed):** the per-senior/grad double `nibbins` PK read is one cheap lookup; threading stage through both functions adds coupling for negligible gain.

## Disposition
- Blocking (P0/P1): **none.** P3: the one substantive parity divergence **fixed**; rest are nits/wontfix.
- **Gate verdict: PASS.**
- **Signed:** Claude on 2026-06-18 (on behalf of John).
