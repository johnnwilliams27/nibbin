# P5 — User-facing synthesis (`think`): design spec

**Date:** 2026-06-23
**Status:** Design spec — do not build until this spec is accepted and a plan is written.
**Branch:** `feature/company-brain-synthesis` (worktree `C:\nib-p5`)
**Decisions binding:** D18 (Grovekeeper-only surface; reusable engine; no second budget tally; discoverability via Keeper-surfaced prompts; structured output via "view details" modal); D21 (extend hybrid retrieval to `sources`, bounded-agentic loop, synthesis-quality eval).
**Foundation prerequisite:** F1+F2 (migration `20260622140000_company_brain_foundation.sql`) — `sources`, `field_evidence`, `proposals`, `decide_memory_proposal`. All already committed on this branch.

---

## 1. What this spec covers

P5 adds one new capability — **synthesis** — on top of the existing codebase. Synthesis answers the question "what do I know about X?" by retrieving evidence from both `memory_entries` (derived agent/user facts) and the new `sources` corpus (documents, connector artifacts, observations), composing a cited prose answer, performing a gap check, and optionally firing one targeted follow-up retrieval. Nothing else changes: no new user-facing route, no new budget, no new embedding model.

The synthesis result surfaces **only inside the Grovekeeper chat**, rendered as a compact bubble with a "view details" button that opens a modal. Discoverability is entirely through the Keeper — it recognizes synthesis-eligible questions and answers them with the engine, not by routing to a second surface.

---

## 2. Positioning inside the codebase

| Layer | Files today | P5 change |
|---|---|---|
| Retrieval RPC | `supabase/migrations/20260618030000_agent_memory.sql` (`match_memory`) | New parallel RPC `match_sources` on the `sources` corpus (see §4) |
| Retrieval caller | `apps/web/lib/memory/retrieve.ts` (`retrieveMemoryBlock`) | New sibling `apps/web/lib/synthesis/retrieve-sources.ts` |
| Synthesis engine | (none) | New `apps/web/lib/synthesis/engine.ts` — the reusable service |
| Keeper action | `apps/web/app/app/grove/actions.ts` (`keeperChatAction`) | Inject synthesis call when Keeper classifies question as synthesis-eligible |
| Keeper prompt | `packages/keeper/src/prompt.ts` | Extend `buildKeeperContext` to accept a `SynthesisResult` block |
| Chat UI | `apps/web/app/app/grove/KeeperChat.tsx` | Render `synthesis` card kind + trigger modal |
| Card types | `packages/keeper/src/` (card shapes) | New `SynthesisCard` card kind |
| Budget | `supabase/migrations/20260621120000_chat_total_budget.sql` (`frontier_budget_take`) | No change — synthesis turns draw the `chat_total` bucket identically to normal turns |
| Quality eval | (none) | New `apps/web/lib/synthesis/eval.ts` (offline harness, not in the hot path) |

---

## 3. Reusable synthesis service interface

### 3.1 Public signature

```ts
// apps/web/lib/synthesis/engine.ts
export interface SynthesisResult {
  answer: string;           // 100-300 word cited prose
  citations: Citation[];    // ordered by relevance, max 5
  gapNote: string | null;   // null when coverage is sufficient
  corpusCounts: { memory: number; sources: number }; // for the modal "from N items"
}

export interface Citation {
  label: string;            // human-readable: doc title or memory provenance tag
  kind: 'memory' | 'source';
  sourceId?: string;        // present when kind === 'source'
  excerpt: string;          // max 200 chars, the verbatim snippet cited
  score: number;            // normalised 0-1 hybrid score
}

export interface SynthesisInput {
  accountId: string;
  nibbinId: string;         // the Keeper's nibbin — for scoping agent memory
  question: string;         // the user's raw question, ≤ 2000 chars
  userId: string;           // for budget debit + audit
}

/**
 * Synthesize a cited answer from the account's memory + sources corpus.
 * Best-effort throughout: any sub-step failure degrades gracefully
 * (missing corpus → partial answer; missing citations → uncited prose).
 * Never throws — returns an error-state SynthesisResult instead.
 */
export async function synthesize(input: SynthesisInput): Promise<SynthesisResult>
```

### 3.2 Bounded-agentic loop

The loop has at most four steps and is strictly bounded — no recursive agent, no unbounded tool calls.

```
Step 1 — RETRIEVE
  Parallel:
    a. match_memory(accountId, nibbinId, embedding, question, limit=8)
    b. match_sources(accountId, embedding, question, limit=6)
  → up to 14 candidate passages

Step 2 — COMPOSE + CITE
  LLM call (T1 model, synthesis-system-prompt):
    Input: question + ranked passages (memory first, then source chunks)
    Output: structured JSON { answer, citations: [{label, kind, sourceId, excerpt}], hasGap: bool, gapNote }
  Max output tokens: 600
  Temperature: 0.3

Step 3 — GAP ANALYSIS (conditional)
  If hasGap === true AND total passages retrieved < 6:
    One targeted re-query: embed gapNote → match_sources(limit=4, minScore=0.45)
    Append new hits, re-run compose step with the extended passage set
    Max one re-query — never loops again

Step 4 — RETURN SynthesisResult
  Assemble from compose output; normalise citations; set corpusCounts.
```

**Bounded-ness invariants:**
- At most 2 LLM calls (compose + optional recompose).
- At most 2 embedding calls (initial query + optional gap-note re-embed).
- At most 3 RPC calls (match_memory + match_sources + optional re-query).
- Hard timeout: 12 s for the whole loop; degrade to a partial answer on breach.
- If VOYAGE_API_KEY is absent: embeddings are null, both RPCs fall back to FTS + recency (same pattern as `retrieveMemoryBlock`).

### 3.3 System prompt (synthesis model call)

A dedicated system prompt lives in `packages/keeper/src/synthesis-prompt.ts`, separate from `KEEPER_SYSTEM_PROMPT`. The synthesis prompt:

- Instructs the model to answer from the provided passages only, never from parametric memory.
- Requires every claim to be attributed to a passage by its index.
- Requires a `hasGap: bool` and a `gapNote` (1 sentence) when the passages don't fully answer.
- Sets output format as JSON (structured output / response_format constraint).
- Is marked cacheable (`cache: true`) — it is identical for all accounts and all questions.

The volatile suffix (the passages + the question) follows after, same prefix-discipline as `KEEPER_SYSTEM_PROMPT` / `buildKeeperContext`.

---

## 4. Extending retrieval to the `sources` corpus

### 4.1 Chunking strategy

Source documents are chunked at ingest time (P2 — document ingestion). The chunking output is stored in a new `source_chunks` table (one row per chunk, FK to `sources.id`). P5 does not build ingest — it only reads chunks that P2 will write. For the P5 eval harness, a small seed set of manually chunked docs is sufficient.

**Chunk parameters (open fork — see §9.1):**
- Target: 400 tokens per chunk, 80-token overlap.
- Splitter: paragraph-boundary-aware (split on double newline first, then sentence boundary, never mid-sentence).
- Metadata per chunk: `source_id`, `chunk_index`, `char_start`, `char_end`, `token_count`.

### 4.2 `source_chunks` table (migration in P5's migration file)

```sql
create table public.source_chunks (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  source_id uuid not null references public.sources (id) on delete cascade,
  chunk_index integer not null check (chunk_index >= 0),
  text text not null check (btrim(text) <> '' and char_length(text) <= 2400),
  token_count integer not null check (token_count > 0 and token_count <= 600),
  fts tsvector generated always as (to_tsvector('english', text)) stored,
  embedding vector(1024),
  created_at timestamptz not null default now(),
  unique (source_id, chunk_index)
);
create index source_chunks_account_idx on public.source_chunks (account_id);
create index source_chunks_fts_idx on public.source_chunks using gin (fts);
create index source_chunks_embedding_idx on public.source_chunks
  using hnsw (embedding vector_cosine_ops);
```

RLS: member-read, no authenticated writes — identical pattern to `memory_entries`.

### 4.3 `match_sources` RPC

Mirrors `match_memory` exactly — same 60/25/15 weighting — but queries `source_chunks` and joins back to `sources` for title and `source_tier`.

```sql
create function public.match_sources(
  p_account uuid,
  p_embedding text,         -- vector literal or null
  p_query text,
  p_limit integer default 6,
  p_min_score numeric default 0.25
) returns table (
  chunk_id uuid, source_id uuid, source_title text, source_tier smallint,
  text text, score numeric
)
```

Score formula:
```
0.60 * cosine_similarity      (or 0 when embedding null)
+ 0.25 * ts_rank(fts, query)  (or 0 when query blank)
+ 0.10 * recency_decay        (same 30-day half-life as match_memory)
+ 0.05 * source_tier / 100.0  (authority boost: a signed contract outranks an email)
```

The 5 % source-tier bonus is a direct implementation of the §4.4 authority signal (recency > authority > human). It does not override the primary semantic + FTS signal — it is a tie-breaker.

Revoked from `public`, `anon`, `authenticated`; granted to `service_role` only — same as `match_memory`.

### 4.4 Embedding writes for chunks

Source chunk embeddings are written at ingest time by P2, using `embedTexts` from `apps/web/lib/llm/embed.ts` (no new embedding call path). P5 only adds reads. When embedding is null (no VOYAGE_API_KEY), chunks still match via FTS + recency — same graceful degradation as `memory_entries`.

---

## 5. Keeper integration

### 5.1 When the Keeper calls synthesis

The Keeper's `keeperChatAction` (in `apps/web/app/app/grove/actions.ts`) already runs a router that classifies complexity. P5 adds a second classification check **before** the normal LLM dispatch: the router detects "knowledge-lookup" questions (e.g. "what do I charge for X?", "what's my policy on Y?", "do I have any notes about Z?") and flags them as `synthesis-eligible`.

This classification is lightweight — either a pattern-match on the pre-existing complexity signal, or a small deterministic heuristic (the question contains knowledge-lookup markers). It must not add a model call or slow the hot path.

If `synthesis-eligible`:
1. Call `synthesize(input)` with a 12 s timeout.
2. On success: return a `SynthesisCard` message to the client (see §5.2). The synthesis LLM calls draw from the Keeper's `chat_total` daily budget bucket identically to any other chat turn — no second counter.
3. On failure / timeout: fall through to the normal Keeper chat path, which answers from its own knowledge. Never surface a synthesis error to the user.

### 5.2 The `SynthesisCard` message type

New card kind in `packages/keeper/src/` (alongside existing `prose`, `question`, `celebration`):

```ts
export interface SynthesisCard {
  kind: 'synthesis';
  summary: string;         // 1-2 sentence condensed answer for the bubble
  fullAnswer: string;      // full cited prose for the modal
  citations: Citation[];
  gapNote: string | null;
  corpusCounts: { memory: number; sources: number };
}
```

The Keeper wraps the `SynthesisResult` from the engine into a `SynthesisCard`: the `summary` is a condensed version (≤ 60 words, derived by the compose step's JSON output — add a `summary` field to the synthesis model output schema).

### 5.3 Rendering in `KeeperChat.tsx`

The `CardView` component (already called for every keeper bubble via `<CardView card={item.message!.card} />`) gains a branch for `card.kind === 'synthesis'`:

```
[Keeper bubble]
  "[summary — 1–2 sentences]"
  [View details →] button (small, ghost variant)
```

The "view details" button opens a `<SynthesisModal>` (new component, `apps/web/app/app/grove/SynthesisModal.tsx`).

No layout changes to `KeeperChat` — the card renders inside the existing `keeperBubble` div. The modal is a portal (renders in `<body>`, reuses the existing modal pattern from the codebase).

### 5.4 `SynthesisModal` contents

```
[Modal header]  "What I found"

[Full answer block]
  Cited prose (§3.2 output). Citations rendered inline as superscript [1], [2]…

[Citations list]
  For each citation:
    • [label]  —  "[excerpt]"  [kind badge: memory / doc]

[Gap note]  (omitted when gapNote is null)
  "What I couldn't find:  [gapNote]"

[Footer]
  "From [N] memory entries and [M] sources"   ← corpusCounts
  [Close] button
```

The modal is read-only. No actions (no "add to memory", no "run agent"). Those belong to future P6/C1 work.

### 5.5 Budget accounting

No change to the budget schema or the `frontier_budget_take` RPC. The synthesis path is treated as a single chat turn: `keeperChatAction` draws one `chat_total` token before dispatching synthesis, exactly as it does today before dispatching the normal model call. A synthesis turn that also fires a gap-requery does not draw an extra budget unit — the budget gate is per user turn, not per internal model call.

The synthesis's two LLM calls (compose + optional recompose) are recorded via `recordModelCall` with `task: 'synthesis'` and `origin: 'chat'` so COGS dashboards can separate them. No new ledger table — `origin` is already a free-text field.

---

## 6. Discoverability (no second surface)

Per D18, there is no separate "ask the brain" UI. Users reach synthesis by chatting with the Keeper. Discoverability comes from two mechanisms:

1. **Keeper-surfaced prompts.** When the Keeper's onboarding step reaches `done`, the Grovekeeper already surfaces contextual nudges. P5 adds one new nudge type: when a proposal is approved (a new `grove_memory` field is ratified), the Keeper proactively surfaces "Ask me what you know about [field]" as a chip suggestion in its next message. This wires synthesis to the existing proposal-approval flow without adding new notification machinery.

2. **"I don't know, ask me" affordance.** The Keeper's existing fallback prose (when it doesn't have an answer from its parametric knowledge) is updated to include: "If you're wondering what's in your notes, just ask and I'll search." This is a prompt-level change, not a code change — it goes into `KEEPER_SYSTEM_PROMPT`.

Both mechanisms are lightweight. Neither requires a new notification type or a new surface.

---

## 7. Synthesis-quality eval

Per D21, a small offline eval harness verifies three properties: citation correctness, gap detection, and no hallucination. This is not in the chat hot path — it runs offline (CI or manual trigger) against a seeded test corpus.

### 7.1 Eval file location

`apps/web/lib/synthesis/eval.ts` — a standalone script, not imported by any app code. Run with:

```bash
tsx apps/web/lib/synthesis/eval.ts
```

### 7.2 Test cases

Each test case has:
- `question`: a user question.
- `corpus`: the passages the engine should retrieve from (injected, bypassing real retrieval for determinism).
- `expectedCitedClaims`: string[] — phrases that must appear in the answer with a valid citation index.
- `expectedGap`: boolean — whether the engine should flag a gap.
- `forbiddenClaims`: string[] — phrases that must NOT appear (hallucination guard).

Minimum eval suite at launch: 6 test cases:
1. Question fully answerable from memory — gap = false, 2+ citations.
2. Question partially answerable from sources — gap = false, 1+ citation, cites source.
3. Question not answerable — gap = true, gapNote present.
4. Question spanning both corpora — citations from both memory and source.
5. Adversarial: passage contains a number not relevant to the question — number must not appear in answer (hallucination test).
6. Gap-requery case: first retrieval returns 0 source hits; gap-note triggers re-query; second retrieval returns 1 hit that answers the question.

### 7.3 Metrics

- **Citation precision:** fraction of `citation.excerpt` values that appear verbatim (or near-verbatim ≥ 0.85 Jaccard) in the provided corpus.
- **Gap recall:** fraction of `expectedGap=true` cases where `hasGap=true` in output.
- **Hallucination rate:** fraction of `forbiddenClaims` that appear in the answer.

Pass threshold (enforced by the CI eval step):
- Citation precision ≥ 0.90
- Gap recall ≥ 0.80
- Hallucination rate = 0.00

The eval is a gate for P5 PRs — a failing eval blocks merge.

---

## 8. Data flow diagram

```
User types question in KeeperChat
    │
    ▼
keeperChatAction (server action)
    │
    ├─ classify: synthesis-eligible?
    │       │ yes
    │       ▼
    │   synthesize(input)
    │       │
    │       ├─ embedQuery(question)     [Voyage, async]
    │       │
    │       ├─ match_memory(...)        [service_role RPC, async]
    │       ├─ match_sources(...)       [service_role RPC, async]
    │       │       (parallel)
    │       │
    │       ├─ LLM compose+cite call   [T1 model, structured JSON]
    │       │
    │       ├─ gap? → re-embed gapNote → match_sources → LLM recompose
    │       │         (at most once)
    │       │
    │       └─ → SynthesisResult
    │               │
    │               ▼
    │           SynthesisCard message
    │           recordModelCall(task:'synthesis')
    │
    ├─ not eligible → normal keeperChat() path (unchanged)
    │
    ▼
GroveChatPayload → KeeperChat.tsx
    │
    ▼
CardView(SynthesisCard)
  → [summary bubble] + [View details →]
        │
        ▼
    SynthesisModal (portal)
      full answer + citations + gap note
```

---

## 9. Open forks for John

These decisions are not made in this spec and need a call before the build plan is written.

### 9.1 Chunk size (FORK)

Spec proposes 400-token target chunks with 80-token overlap. The tradeoffs:
- **Smaller (200 tokens):** higher citation precision (shorter excerpts = cleaner attribution), more RPC rows, more HNSW index entries, higher Voyage embed cost at ingest.
- **Larger (600 tokens):** richer context per passage, lower ingest cost, but citations may span multiple claims making attribution harder to verify.
- **Recommended starting point:** 400 tokens — matches common RAG benchmarks and keeps the `source_chunks.text` column well under the 2400-char cap.

### 9.2 Where chunked source embeddings are stored (FORK)

Two options:
- **A. Same Supabase instance, `source_chunks` table** — simple, consistent with `memory_entries`, no new infra. Trade-off: pgvector HNSW index lives in the same Postgres instance as all other data; at large corpus scale (thousands of docs) this adds index memory pressure.
- **B. Dedicated pgvector schema or a separate Supabase project** — isolates vector index memory. Trade-off: adds a second connection, second migration track, cross-project RLS complexity.
- **Recommended:** Option A for now. The brain's corpus is per-account and bounded — a solo operator's document library will not stress a Supabase Pro instance's HNSW index for a long time. Revisit at B2B launch if needed.

### 9.3 Synthesis-eligible classification heuristic vs. model call (FORK)

Two options to decide if a question should trigger synthesis:
- **A. Deterministic heuristic** — keyword list ("what do I charge", "my policy", "do I have", "what's in my notes", etc.) + question-mark presence. Zero latency, zero cost, misses paraphrase.
- **B. Router signal reuse** — the existing grove router already assigns a `complexity` score and a `classification`. P5 adds a new classification tag `knowledge_lookup` that the router emits when it sees a retrieval-shaped question. Adds ~50 ms (router call already happens) but no extra model call — the router is a rule-based scorer, not an LLM.
- **Recommended:** Option B — reuse the router's classification signal. Avoids maintaining a keyword list and keeps the synthesis gate consistent with the existing routing architecture.

### 9.4 Gap-note re-query: recompose in a new LLM call or append to the existing call? (FORK)

- **A. New LLM call** — cleaner, full passage set passed fresh, but always charges two compose calls when a gap triggers.
- **B. Continuation** — pass the original compose output + new passages as a continuation message in the same conversation thread. Saves one full-prompt token cost but requires the model to reconcile two passage sets, which risks confabulation at the join.
- **Recommended:** Option A. The cost of a second 600-token generation is small; the confabulation risk in Option B is not.

---

## 10. What this spec does NOT cover

- **P2 (document ingest):** chunk writes, parse/extract, embedding on ingest. P5 only reads chunks that P2 will write. The `source_chunks` table schema (§4.2) is P5's migration, but writes are P2's responsibility.
- **P6 (attention-queue wiring):** Keeper-dock red bubble, stakes field. The "Keeper-surfaced prompts" affordance in §6 reuses the existing notification chip pattern; it does not require P6.
- **C1 (morning brief):** synthesis engine is designed to be called from C1 (the `synthesize` function is reusable), but C1 scheduling, digest formatting, and proactive surface are out of scope for P5.
- **Multi-modal retrieval:** image/PDF extraction is P2's concern. P5 treats chunk text as already-extracted plain text.
- **User-editable synthesis results:** out of scope. Synthesis is read-only; editing flows through the existing proposal/ratification path.
- **Synthesis history / caching:** synthesis results are ephemeral (not persisted). A repeated identical question fires the engine again. Caching can be added later if latency or cost warrants it.

---

## 11. Migration file

P5 ships one new migration: `20260623<sequence>_synthesis_source_chunks.sql`, containing:
- `source_chunks` table (§4.2)
- `match_sources` RPC (§4.3)
- RLS policy (member-read, no authenticated writes)

No changes to existing migrations or existing RPCs.

---

## 12. Acceptance criteria

P5 is done when:

- [ ] `synthesize()` returns a `SynthesisResult` given a question, with ≥ 1 citation when the corpus is non-empty.
- [ ] When VOYAGE_API_KEY is absent, synthesis degrades to FTS + recency (returns an answer, may have lower quality; does not throw).
- [ ] A synthesis-eligible question in KeeperChat renders a synthesis bubble with a "view details" button.
- [ ] "View details" opens `SynthesisModal` with full answer, citation list, and (when present) gap note.
- [ ] A non-synthesis question follows the normal Keeper path unchanged.
- [ ] Budget accounting: a synthesis turn draws exactly one `chat_total` budget unit (same as a normal turn).
- [ ] `recordModelCall` records both compose calls (when gap requery fires) with `task: 'synthesis'`.
- [ ] Eval harness (`eval.ts`) passes all 6 cases at the thresholds in §7.3.
- [ ] `match_sources` RPC is revoked from `public`, `anon`, `authenticated`; granted to `service_role` only.
- [ ] TypeScript builds clean; `npm run lint` and `npm run typecheck` pass.
- [ ] Adversarial gate: 4-reviewer gate (red-team / claims-auditor / logic-skeptic / cost-auditor) passes. Report to `docs/gates/`.
