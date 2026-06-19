# Adversarial Gate Report — Write-to-long-term-memory

**Date:** 2026-06-19
**Branch:** `feat/memory-write` (rebased onto main incl. router #158 + browser #159)
**Surface:** a write path to durable per-account memory (`memory_entries`, #135) — privacy-load-bearing. Adds a `memory.write` Planner utility. Migration `20260619120000_memory_write.sql` (additive `source` column + partial index).
**Reviewers (4 lenses):** red-team · logic-skeptic · claims-auditor · cost-auditor.
**Verdict: PASS** — no P0/P1 from any reviewer. P2/P3s fixed in-branch.

## What it is
A `memory.write` utility lets a Planner agent persist a DERIVED, reusable fact/preference for future retrieval. **derived-not-raw:** the LLM-proposed text is run through the SAME `isClean` predicate (`applyBattery` regex battery + `HeuristicNer`) the #135 writer uses, BEFORE embed AND insert — tripped content is dropped, so neither the stored row nor the embedding vector carries raw/PII. Per-account service-role write under #135's RLS; the LLM controls only `text`/`kind`/`confidence` (schema-checked, unknown keys rejected fail-closed) — `account_id`/`userId`/`scope`/`source` are stamped by trusted code. Bounded by `MAX_MEMORY_WRITES=3`/run (resume-primed) + natural-key dedup (bump, not duplicate). No-key → `embedding=null` FTS/recency fallback. Rows stamped `source='agent'` for auditability.

## Findings — no P0/P1
All four reviewers PASS:
- **red-team:** every lane holds — redaction covers the embedding (byte-identical text), no cross-account path (account/owner server-derived, unknown args rejected), parameterized service-role writes under unchanged RLS, resume-primed budget + dedup, and **retrieved agent-memory is quarantined-as-data** (no prompt-injection escape vs #135).
- **logic-skeptic:** redact→embed→insert ordering correct; budget enforced + resume-primed (no off-by-one); scope-coercion (ephemeral plan → `user` scope anchored to `userId`) satisfies `memory_scope_owner`; null-userId fail-closed; migration additive; no regression.
- **claims-auditor:** all privacy claims TRUE + non-tautologically tested (PII-drop test feeds real PII through the real `isClean` and asserts no insert); migration additive/back-compat, no view.
- **cost-auditor:** bounded — ≤3 embeds/run (cap gates before embed), dedup, index-backed lookup, no new entry point/model call, partial index doesn't bloat.

### P2/P3s fixed (`3af9479`)
| Lens | Issue | Fix |
|------|-------|-----|
| logic-skeptic + red-team | a missing/whitespace `text` arg → `String(undefined)` stored as a `"undefined"` junk row | dispatch now refuses a missing/empty `text` cleanly (no handler call, no budget spent); test asserts no insert |
| claims-auditor | "resume-primed budget" correct in code but only cold-tested | added a resume-budget test (resumed from 3 prior writes → 4th blocked) |
| logic-skeptic | 2 strict-tsc errors in `write.test.ts` | typed the select/update mock chains |
| claims-auditor | stale `scope` docstring (arg not exposed) | aligned the comment to reality (LLM sets only text/kind/confidence) |

### Carry-forward (non-blocking)
- **P3 (repo-wide, pre-existing, matches #135):** Voyage embed spend isn't recorded as COGS (tiny magnitude — ≤3 short embeds/run). Consider attributing embed usage if memory volume grows. Applies to both this write path and the #135 retrieve path.
- **P3:** no human-confirmation gate on the first cut (acknowledged in the file header; `source='agent'` is the documented hook for a future gate).

## Rebase integrity
Rebased onto main (router + browser merged). Conflicts in `planner.ts`/`run.ts` resolved by UNIONing — the browser `computer_use` dispatch + `cu:` repetition priming AND the `memory.write` dispatch + `memoryWrites` priming both survive. **Proof:** the full browser/`computer_use` suite (45 tests) passes alongside the memory suite post-rebase.

## Verification (post-rebase + fixes)
- `tsc -p packages/runtime` + `-p apps/web` → 0
- `vitest run packages/runtime/test apps/web/lib/memory apps/web/lib/planner` → **278 passed** (incl. 45 browser/cu tests — no dropped change)
- `eslint …` → clean · `npm run build -w @nibbin/web` → Compiled successfully

## Migration
`20260619120000_memory_write.sql` — additive `memory_entries.source ('ingested'|'agent', default 'ingested')` + partial agent-source index; reuses #135's table/RLS/RPC; no view. Applied to dev/staging/prod by the controller.
