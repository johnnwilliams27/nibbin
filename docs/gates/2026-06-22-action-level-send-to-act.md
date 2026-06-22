# Adversarial gate — action level rename Send → Act (`feature/home-about-copy`)

- **Branch / PR:** `feature/home-about-copy` → `main` (#236)
- **Reviewed diff:** `git diff be37231c..HEAD` (the action-level rename + marketing refresh)
- **Gate run by:** Claude (four reviewers, opus) on 2026-06-22, signed by John
- **Trigger:** sensitive surfaces changed — `packages/runtime/` (the sole execution gate) and `supabase/migrations/`. The change renames the top action level value `send` → `act`. The ladder is unchanged: **Observe / Draft / Act**.

## CI step
- typecheck: ☑ (runtime + web clean)  tests (count): ☑ 2155 passed / 6 skipped (the only 3 failures are the pre-existing local `@sparticuz/chromium` optional-dep gap, green on CI's clean install)  lint: ☑  audit: ☑  SAST: ☑  redaction corpus: ☑ (unchanged)  trigger-graph: ☑ (unchanged)

## Adversarial reviewers (.claude/agents/*)
| Reviewer | Verdict | P0 | P1 | P2 | P3 |
|---|---|---|---|---|---|
| red-team | PASS | 0 | 0 | 0 | 1 |
| claims-auditor | PASS-WITH-FIXES | 0 | 9 | 4 | 1 |
| logic-skeptic | PASS | 0 | 0 | 0 | 2 |
| cost-auditor (≥M2) | PASS-WITH-FIXES | 0 | 0 | 0 | 1 (LOW) |

**Overall: PASS** — no P0; all P1 and P2 resolved in this gate's fix wave; remaining P3 either fixed or tracked.

## What passed (positive confirmation)
- **Gate stays fail-CLOSED** (red-team, logic-skeptic): `runner.ts` execute arm is now `else if (level === 'act')`; branch order unchanged — `observe`→deny (first), `presentation||draft`→draft, `act`→execute, **everything else (NULL / stale `send` / unknown / future enum) → draft**. The rename moved the magic value, so any un-migrated value *de-escalates* — strictly safer than the audited original. `?? 'draft'` NULL-coalesce intact in both stores.
- **`email.send` capability and `gmail.send` OAuth scope untouched** (all): only the action level value was renamed; sends are not broken. Desktop study `action:'send'` and the "Send to Nibbin" upload button correctly left alone.
- **Migration safe** (red-team, logic-skeptic): drop-check → `update send→act` → re-add `CHECK in ('observe','draft','act')`. Ordering correct (old check forbids `act`, dropped first); idempotent (`if exists`); default `draft` unchanged. Applied to dev/staging/prod, **0 rows affected** (no Nibbin was at the top level); prod constraint verified = `act`. IDOR guard on `setNibbinActionLevel` intact.
- **Single source of truth for the type** (logic-skeptic): one `ActionLevel` definition; all consumers import it. Validation array → `['observe','draft','act']` rejects the old value. No vacuous tests.
- **Zero cost/routing impact** (cost-auditor): no model selection, routing tier, token budget, run ceiling, or fan-out touched.

## Findings → disposition

### P1 (claims-auditor) — FIXED in this gate's fix wave
Authoritative/published registers still asserting the action level as "Send" (claim ≠ shipped value/UI). All updated to **Observe / Draft / Act**:
- `docs/INVARIANTS.md:17`, `SPEC.md:28/59/355`, `docs/submissions/google-oauth-verification.md:37/66`, `reference/subprocessors.html`, `reference/privacy.html`, `reference/data-ai.html` (incl. "grant Send"→"grant Act"), `docs/help-compendium.md` (all action-level occurrences, incl. "at Send, it acts"→"at Act, it acts").

### P2 (claims-auditor) — FIXED
Shipped in-app copy / Grovekeeper voice:
- `apps/web/components/adopt/AdoptHatch.tsx:109-110`, `packages/keeper/src/copy.ts:97`, `packages/keeper/src/prompt.ts:22` → "Observe, Draft, or Act".
- `apps/web/app/app/nibbins/[id]/page.tsx:49` "enable sending" → "enable it to act".

### P3 — FIXED
- **cost-auditor C1 (LOW):** orphaned IBM Plex Mono webfont — removed `plexMono` from `apps/web/app/fonts.ts` + `layout.tsx` (no `var(--font-plex-mono)` consumers remained after the `--mono`→Archivo swap).
- **red-team N1 / logic-skeptic L-2:** stale "observe/draft/send" docstrings in `packages/runtime/src/{templates,school,interpreter,capabilities}.ts`, `apps/web/lib/connections/grants.ts`, `trigger-graph.test.ts` → "observe/draft/act". Present-tense connector ADR/plan (`docs/decisions/2026-06-22-…`, `docs/superpowers/plans/2026-06-22-connector-batch-plan.md`) and the `reference/nibbin-demo.html` card → Act.

### P3 — TRACKED (non-blocking, cosmetic)
- **logic-skeptic L-1:** some `it(...)`/`describe(...)` test *titles* in `runner-invariants.test.ts`, `trust-gate.test.ts`, `interpreter.test.ts` still read "send" while bodies assert `'act'`. Title strings only; no logic effect. Follow-up rename.

### Correctly left unchanged (verified legit / historical)
- `email.send` / `gmail.send` identifiers and the grant capability `email.send`.
- Dated historical records: `docs/superpowers/specs/2026-06-20-*`, `plans/2026-06-20-*`, `docs/gates/2026-06-20-action-levels.md`, `docs/gates/2026-06-22-connector-phase0-calendar.md`, the original migration `20260620190000` — rewriting would falsify history.

## Disposition
- Blocking (P0/P1) resolved: ☑  Non-blocking tracked: ☑ (L-1 test-title drift)
- **Gate verdict:** PASS
- **Signed:** John on 2026-06-22
