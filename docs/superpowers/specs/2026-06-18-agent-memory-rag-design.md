# Agent Memory (RAG) — Design Spec

**Date:** 2026-06-18
**Status:** Approved — full semantic build. Embedding provider chosen: **Voyage `voyage-3`** (1024-dim), a new subprocessor (receives already-redacted derived text only; added to the subprocessor page). Implements the §12A persistent-memory slice of Agent Synthesis (`2026-06-17-agent-synthesis-design.md`).
**Scope:** **agent memory** (per-Nibbin) + **user memory** (per-account, cross-agent): **write → retrieve-at-run → forget**, derived-not-raw, RLS-scoped, provenance+confidence. NOT email RAG (it indexes distilled facts/preferences/entities, never raw content).

## 1. Embedding provider + the infra it reuses
The model-call path exists (`packages/router/src/anthropic.ts` → `apps/web/lib/llm/drafting.ts`, COGS-recorded) and an account-scoped **Grove Memory** block is already injected at draft time (`loadGroveMemoryBlock`) — so the **write-time extraction reuses it**. There is no embeddings endpoint today, so we add a **Voyage `voyage-3` client** in `packages/router` (new `VOYAGE_API_KEY`), used only to embed **already-redacted derived text** (facts/preferences/entities) — never raw content. Voyage becomes a **subprocessor** (added to `reference/subprocessors.html`, the draft list). Retrieval is **hybrid**: semantic (pgvector cosine) + full-text + recency.

## 2. Principles (carried from §12A + INVARIANTS)
- **Derived-not-raw:** every entry is built from already-redacted run context / user input and re-checked with `applyBattery()` (redaction-corpus-checked). Never raw email/connector content.
- **Per-account RLS — never crosses accounts:** the `is_account_member` gate makes the account the hard isolation boundary; the RLS test proves no row crosses accounts. Within an account, user-scoped memory is **shared among the account's members** in v1 (`match_memory` pools all `scope='user'` rows for the account — no `user_id` predicate, by design). True per-user isolation ships with the deferred **account/team tier**. Cross-account value would flow only via the §12B aggregate (out of scope), never raw memory.
- **Provenance + confidence:** every entry tagged `observed | user-stated | inferred` + a confidence; low-confidence is labeled, never asserted as fact; user-visible/editable later (editing UI deferred).
- **Forget:** C3 deletion is honored TODAY via FK cascade — deleting an account / nibbin / user cascades its memory rows. The `expires_at` TTL column + retrieval exclusion are in place and forward-compatible, but TTL **expiry is deferred**: nothing populates `expires_at` yet and there is no purge runner, so no entry is currently aged out by time.
- **Best-effort, never on the critical path:** memory write/retrieve failures never disrupt a run or a decision.

## 3. Components
### 3.1 Store — `memory_entries`
One table, both tiers (discriminated by `scope`):
- `id uuid pk`, `account_id uuid` (RLS anchor), `scope text check (scope in ('agent','user'))`, `nibbin_id uuid null` (set iff scope='agent'), `user_id uuid null` (set iff scope='user'), `kind text check (kind in ('fact','preference','entity'))`, `text text` (the derived statement, length-capped), `provenance text check (… 'observed'|'user-stated'|'inferred')`, `confidence numeric check (0..1)`, `source_run_id uuid null`, `created_at`, `last_seen_at`, `expires_at timestamptz null` (TTL), a generated `fts tsvector` (`to_tsvector('english', text)`) with a GIN index, and **`embedding vector(1024)` (Voyage voyage-3)** with an **HNSW cosine index** (`vector_cosine_ops`).
- Requires the **`vector` extension** (`create extension if not exists vector`).
- Dedupe anchor: `unique (account_id, scope, coalesce(nibbin_id,'…'), kind, lower(text))`-style guard so re-derivation doesn't stack (final form in the plan).
- **RLS:** member-read (`is_account_member(account_id)`); INSERT/UPDATE/DELETE revoked from `authenticated` — writes only via service-role / security-definer RPC (mirrors `grove_memory`/`notifications`).

### 3.2 Writer — model-extraction at write time
- Trigger: after a run completes or a draft is corrected (a gate-free hook alongside the existing post-decision path). Best-effort, async-ish, swallow errors.
- Distill ≤K (e.g. 3) durable entries from the **already-redacted** run context + the user's edit, via the existing router/drafting model seam (a dedicated extraction prompt → strict JSON: `{kind, text, provenance, confidence}[]`). COGS recorded like other model calls.
- **Every derived `text` is passed through `applyBattery()`** and dropped/flagged if it still trips a redaction rule (derived-not-raw guarantee) — this happens **before** it is sent to Voyage to embed.
- **Embed** the (redacted) `text` via the Voyage `voyage-3` client; store the 1024-dim vector. Embedding failure is non-fatal — the entry is still stored (retrievable by FTS/recency) and can be back-filled.
- Dedupe/merge against existing entries (update `last_seen_at`/confidence rather than insert a near-duplicate).
- Skips low-signal runs (e.g. presentation-only, or no correction + routine approve with nothing new).

### 3.3 Retriever — at draft time (§7.4 injection)
- Injection point: `apps/web/lib/llm/drafting.ts`, right after `loadGroveMemoryBlock`. Embed the run `intent`/`context` (Voyage), then fetch top-N for **(this nibbin's agent memory) ∪ (this user's user memory)** by **hybrid rank** — semantic cosine (pgvector) blended with full-text match + recency — above a confidence floor, excluding expired. Entries lacking an embedding still rank via FTS/recency. Format as a labeled system block (like Grove Memory), with provenance markers so the model treats `inferred` cautiously.
- Bounded (small N, e.g. 8) + cached per run.

### 3.4 Forget — retention + deletion
- **Deletion (active):** account erasure / nibbin / user deletion cascades the owning memory rows via FK — this is how C3 is honored today. A per-entry delete UI is deferred.
- **TTL (deferred):** the `expires_at` column exists and retrieval already excludes `expires_at <= now()`, so the path is forward-compatible — but nothing populates `expires_at` yet and there is no purge runner, so TTL expiry is not active. Wiring a default TTL + a purge runner is a follow-up.

## 4. Data flow
run/correction → **extract** (model, on redacted context) → **applyBattery() + NER name check** → **dedupe/upsert** into `memory_entries` (service-role) → … next run → **retrieve** (recency+FTS, RLS-scoped) → inject as a system block → model draft. Forget on deletion (FK cascade); TTL expiry deferred.

## 5. What this is NOT (boundaries)
No raw content stored; no cross-account flow; no Tier-2 aggregate (separate); no account/team tier (so user-scoped memory is shared among an account's members — per-user isolation deferred), no Style-Profile unification, no editing UI (deferred); no active TTL expiry yet (deletion-via-cascade only).

## 6. Migrations / gating
- New migration(s): `memory_entries` + RLS + the FTS index + a service/security-definer write RPC + (optional) a retrieval helper. Numbering `20260618030000…`.
- **Gated** (migration + the writer touches `packages/runtime`/`apps/web/lib/runtime` + possibly `packages/router` for the extraction call) → `docs/gates/` report + adversarial gate + dev/staging/prod apply. Security testing: RLS never crosses accounts (the RLS test proves it; within an account, members share user-scoped memory — per-user isolation deferred); derived-not-raw (applyBattery + a deterministic NER name check on every entry, corpus-checked); write path service-role-only; best-effort isolation from the run/decision path.

## 7. Voyage subprocessor
Add **Voyage AI** to `reference/subprocessors.html` (the DRAFT, unrouted list — publication still #46-gated): purpose "embeddings for agent-memory semantic retrieval"; data "already-redacted derived memory text (facts/preferences/entities), never raw content." `VOYAGE_API_KEY` server-only env. The embedding client lives in `packages/router` alongside the Anthropic client.

## 8. Also deferred (own specs)
Account/team memory tier; Style-Profile unification (§4A); the user-facing memory-editing UI (Trust & Controls); the §12B Tier-2 fleet flywheel.
