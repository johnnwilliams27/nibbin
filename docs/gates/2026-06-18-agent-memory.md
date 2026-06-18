# Adversarial gate — Agent Memory (RAG, full semantic via Voyage) (2026-06-18)

- **Branch / PR:** `feat/agent-memory-v1` → `main`
- **Reviewed diff:** `git diff main..feat/agent-memory-v1` at `62ce837` (post-fixes; 13 commits).
- **Gate run by:** Claude — 4 adversarial reviewers (red-team, logic-skeptic, cost-auditor, claims-auditor) in parallel, then a consolidated fix pass.
- **Scope:** §12A persistent memory — `memory_entries` (pgvector, migration `20260618030000`) + `match_memory` RPC; Voyage `voyage-3` embedder (`packages/router`); model-extraction writer (`apps/web/lib/memory/extract.ts`, hooked in `decide.ts`); hybrid retriever injected at draft time (`drafting.ts`); Voyage subprocessor row. Spec: `docs/superpowers/specs/2026-06-18-agent-memory-rag-design.md`.

## CI step
- typecheck (apps/web + packages/router): ✅ exit 0
- tests: ✅ `vitest run apps/web/ tests/rls/ packages/router/` → 439 passed, 1 (pre-existing) skipped, **with NO `VOYAGE_API_KEY`** (embedding skipped → FTS/recency path). 8 RLS + unit tests for extract/retrieve.
- redaction corpus: ✅ green. lint: ✅.
- **SQL applied + verified on dev / staging / prod:** `vector` extension, `memory_entries` (+ HNSW + GIN + RLS), `match_memory` (runs on the null-embedding fallback path).

## Reviewers
| Reviewer | Verdict | P0 | P1 | P2 | P3 |
|---|---|---|---|---|---|
| red-team | PASS | 0 | 0 | 1 | 2 |
| logic-skeptic | PASS | 0 | 0 | 0 | 3 |
| cost-auditor | CHANGES→fixed | 0 | 1 | 0 | 1 |
| claims-auditor | CHANGES→fixed | 0 | 1 | 1 | 1 |

**Verified clean by the panel:** egress to Voyage is **only already-redacted derived text** (writer redacts→embeds in that order) and **only the static pattern `intent`** at retrieval (never `context`/evidence); RLS prevents cross-**account** leakage (tested); `match_memory` + writes are service-role-only; no string-built SQL (vector literal is Voyage floats; `plainto_tsquery` parameterized); `VOYAGE_API_KEY` server-only, never logged; CI pgvector image digest-pinned; best-effort isolation (writer/retriever never throw into the decision/draft path — tested); null-key fallback honest; C3 deletion via FK cascade.

## Findings + dispositions
| # | Sev | Reviewer | Finding | Disposition |
|---|---|---|---|---|
| 1 | **P1** | cost | Extraction fired on EVERY decision and was `await`ed inline on the approve/edit hot path (Haiku + Voyage + ≤6 DB round-trips before the UI responds) | **FIXED** (`5012c10`): gated to `decision === 'edited'` only (the rich correction signal; cuts the large majority of calls) + deferred via Next `after()` so it runs post-response (guarded for request context). |
| 2 | **P1** | claims | "per-user RLS, never crosses users" was an overclaim — code pools all `scope='user'` rows within an account (no `user_id` predicate); the test only proves cross-*account* | **FIXED** (`62ce837`, docs): spec + plan reworded to **per-account** ("never crosses accounts; members share user-scoped memory in v1; true per-user isolation ships with the deferred account/team tier"); "the test proves it" scoped to cross-account. Behavior unchanged (intended v1). |
| 3 | P2 | red-team | derived-not-raw guard was `applyBattery` (regex battery) only — no NER, so an unstructured name could pass | **FIXED** (`10e709c`): added a deterministic `HeuristicNer` name check as defense-in-depth via an exported `isClean(text)` = battery AND NER; writer drops entries failing either; `EXTRACT_PROMPT` strengthened to forbid personal names (role-only); comments no longer claim full PII removal (honest: the load-bearing sidecar redaction is upstream on the source draft). |
| 4 | P2 | claims | no `docs/gates/` report on the branch | **FIXED** — this report. |
| 5 | P3 | logic/cost | dimension/cast or unique-violation → entry silently lost | **FIXED** (`10e709c`): on insert error, retry once with `embedding: null` so the entry is still stored + FTS-retrievable. |
| 6 | P3 | red-team | `intent`-only egress is convention, not enforced | **FIXED** (`10e709c`): invariant comment at the retrieval call (never interpolate connector content into `intent`; `context` is never embedded). |
| 7 | P3 | claims | redaction unit test re-implemented the filter | **FIXED** (`10e709c`): test now exercises the exported production `isClean` (proves it drops "the client Maria Sanchez …"). |
| 8 | P3 | logic/red-team | dedupe `ilike` ↔ `lower(text)` expression-index coupling; TOCTOU on concurrent identical extraction | **DOC** (`10e709c`): comment noting the coupling; a race is benign (best-effort, logged, no crash). Optimize-later. |

## Tracked follow-ups (deferred, recorded)
- **TTL expiry:** `expires_at` column + retrieval exclusion are forward-compatible, but nothing populates it and there's no purge runner — no entry ages out by time yet (C3 *deletion* is active via cascade). Wire a default TTL + purge later.
- **Per-user isolation / account/team tier:** v1 is per-account; per-seat isolation is its own spec.
- **Approval-derived learning:** v1 learns only from `edited` decisions; sampling approvals is a later option.
- **dedupe index efficiency** (`ilike` not served by the expression index) — optimize at scale.

## Disposition
- Blocking (P0/P1): both **fixed**. P2/P3: fixed or doc'd; follow-ups tracked.
- **Gate verdict: PASS.**
- **Signed:** Claude on 2026-06-18 (on behalf of John).
- **Post-merge action:** set `VOYAGE_API_KEY` in Vercel (prod + preview) + local `.env`. Until set, memory runs FTS/recency-only by design.
