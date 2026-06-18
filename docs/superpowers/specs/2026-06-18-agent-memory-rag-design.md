# Agent Memory (RAG) — Design Spec

**Date:** 2026-06-18
**Status:** Approved-path (defaults locked; semantic/vector layer deferred pending an embedding-provider decision). Implements the §12A persistent-memory slice of Agent Synthesis (`2026-06-17-agent-synthesis-design.md`).
**Scope:** **agent memory** (per-Nibbin) + **user memory** (per-user, cross-agent): **write → retrieve-at-run → forget**, derived-not-raw, RLS-scoped, provenance+confidence. NOT email RAG (it indexes distilled facts/preferences/entities, never raw content).

## 1. Why v1 has no embeddings (the one real fork)
The model-call path exists (`packages/router/src/anthropic.ts` → `apps/web/lib/llm/drafting.ts`, COGS-recorded) and an account-scoped **Grove Memory** block is already injected at draft time (`loadGroveMemoryBlock`). But there is **no embeddings endpoint** — Anthropic has none, so a semantic/vector layer needs a **new third-party embedding provider = a new subprocessor** sending derived text out (privacy/legal; #46-adjacent; LEARNINGS.md: a subprocessor row governs any embedding provider). That decision is deferred. **v1 retrieves by recency + Postgres full-text**, which is genuinely useful for short derived facts; the pgvector semantic layer is an **additive fast-follow** (§7).

## 2. Principles (carried from §12A + INVARIANTS)
- **Derived-not-raw:** every entry is built from already-redacted run context / user input and re-checked with `applyBattery()` (redaction-corpus-checked). Never raw email/connector content.
- **Per-user RLS, never crosses users:** `is_account_member` gate; cross-user value flows only via §12B aggregate (out of scope), never raw memory.
- **Provenance + confidence:** every entry tagged `observed | user-stated | inferred` + a confidence; low-confidence is labeled, never asserted as fact; user-visible/editable later (editing UI deferred).
- **Forget:** TTL + user deletion (honors C3).
- **Best-effort, never on the critical path:** memory write/retrieve failures never disrupt a run or a decision.

## 3. Components
### 3.1 Store — `memory_entries`
One table, both tiers (discriminated by `scope`):
- `id uuid pk`, `account_id uuid` (RLS anchor), `scope text check (scope in ('agent','user'))`, `nibbin_id uuid null` (set iff scope='agent'), `user_id uuid null` (set iff scope='user'), `kind text check (kind in ('fact','preference','entity'))`, `text text` (the derived statement, length-capped), `provenance text check (… 'observed'|'user-stated'|'inferred')`, `confidence numeric check (0..1)`, `source_run_id uuid null`, `created_at`, `last_seen_at`, `expires_at timestamptz null` (TTL), and a generated `fts tsvector` (`to_tsvector('english', text)`) with a GIN index.
- Dedupe anchor: `unique (account_id, scope, coalesce(nibbin_id,'…'), kind, lower(text))`-style guard so re-derivation doesn't stack (final form in the plan).
- **RLS:** member-read (`is_account_member(account_id)`); INSERT/UPDATE/DELETE revoked from `authenticated` — writes only via service-role / security-definer RPC (mirrors `grove_memory`/`notifications`).

### 3.2 Writer — model-extraction at write time
- Trigger: after a run completes or a draft is corrected (a gate-free hook alongside the existing post-decision path). Best-effort, async-ish, swallow errors.
- Distill ≤K (e.g. 3) durable entries from the **already-redacted** run context + the user's edit, via the existing router/drafting model seam (a dedicated extraction prompt → strict JSON: `{kind, text, provenance, confidence}[]`). COGS recorded like other model calls.
- **Every derived `text` is passed through `applyBattery()`** and dropped/flagged if it still trips a redaction rule (derived-not-raw guarantee).
- Dedupe/merge against existing entries (update `last_seen_at`/confidence rather than insert a near-duplicate).
- Skips low-signal runs (e.g. presentation-only, or no correction + routine approve with nothing new).

### 3.3 Retriever — at draft time (§7.4 injection)
- Injection point: `apps/web/lib/llm/drafting.ts`, right after `loadGroveMemoryBlock`. Fetch top-N for **(this nibbin's agent memory) ∪ (this user's user memory)**, ranked by **recency + full-text match** against the run `intent`/`context`, above a confidence floor, excluding expired. Format as a labeled system block (like Grove Memory), with provenance markers so the model treats `inferred` cautiously.
- Bounded (small N, e.g. 8) + cached per run.

### 3.4 Forget — retention + deletion
- `expires_at` TTL (configurable default; entries past it are excluded from retrieval and purged by the existing/!nightly path). User deletion (account erasure / a future per-entry delete) cascades. Honors C3.

## 4. Data flow
run/correction → **extract** (model, on redacted context) → **applyBattery()** → **dedupe/upsert** into `memory_entries` (service-role) → … next run → **retrieve** (recency+FTS, RLS-scoped) → inject as a system block → model draft. Forget on TTL/deletion.

## 5. What this is NOT (boundaries)
No raw content stored; no cross-user flow; no Tier-2 aggregate (separate); no account/team tier, Style-Profile unification, or editing UI (deferred); no embeddings/vector (deferred — §7).

## 6. Migrations / gating
- New migration(s): `memory_entries` + RLS + the FTS index + a service/security-definer write RPC + (optional) a retrieval helper. Numbering `20260618030000…`.
- **Gated** (migration + the writer touches `packages/runtime`/`apps/web/lib/runtime` + possibly `packages/router` for the extraction call) → `docs/gates/` report + adversarial gate + dev/staging/prod apply. Security testing: RLS never crosses users; derived-not-raw (applyBattery on every entry, corpus-checked); write path service-role-only; best-effort isolation from the run/decision path.

## 7. Deferred fast-follow — semantic/vector layer (needs a decision)
Once an **embedding provider** is chosen (recommendation: **Voyage AI**, Anthropic-aligned; alternatives OpenAI/Cohere; or self-host for zero new egress) and a **subprocessor row** is added: enable `pgvector`, add `embedding vector(N)` to `memory_entries`, embed each derived `text` (already redacted), and add semantic similarity to the retriever's ranking (hybrid with FTS+recency). Purely additive — no change to the store/write/forget contracts. This is the only piece blocked on the subprocessor decision.

## 8. Also deferred (own specs)
Account/team memory tier; Style-Profile unification (§4A); the user-facing memory-editing UI (Trust & Controls); the §12B Tier-2 fleet flywheel.

## Open decision
**Embedding provider for §7** (Voyage / OpenAI / Cohere / self-host) — a new subprocessor; gates the semantic layer only. v1 ships without it.
