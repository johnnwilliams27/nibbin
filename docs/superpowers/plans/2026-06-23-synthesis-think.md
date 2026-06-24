# P5 — User-facing synthesis (`think`): TDD implementation plan

**Date:** 2026-06-23
**Branch:** `feature/company-brain-synthesis` (worktree `C:\nib-p5`)
**Source of truth:** `docs/superpowers/specs/2026-06-23-synthesis-think-design.md`
**Foundation prerequisite:** F1+F2 (`20260622140000_company_brain_foundation.sql`) — already committed.
**Status:** Ready to build. Do not deviate from confirmed decisions; the forks listed in §9 of the spec are already resolved (baked in below).

---

## Goal

Add the `synthesize()` engine + `SynthesisCard` Grovekeeper surface. When the Keeper detects a knowledge-lookup question it calls the engine, which retrieves from both `memory_entries` and the new `source_chunks` corpus, composes a cited prose answer, optionally fires one gap-requery, and returns a `SynthesisResult` that renders as a compact bubble + "view details" modal inside `KeeperChat`. Nothing else changes: no new route, no new budget counter, no new embedding model.

---

## Architecture

```
packages/keeper/src/
  synthesis-prompt.ts    ← cacheable synthesis system prompt + output schema
  types.ts               ← SynthesisCard type added to KeeperCard union

apps/web/lib/synthesis/
  engine.ts              ← synthesize() — the reusable bounded-agentic service
  retrieve-sources.ts    ← retrieveSourcesBlock() — sibling to retrieve.ts
  eval.ts                ← offline quality eval harness (not in hot path)

apps/web/app/app/grove/
  SynthesisModal.tsx     ← portal modal (full answer + citations + gap note)
  cards.tsx              ← SynthesisCard branch added to CardView
  actions.ts             ← keeperChatAction: synthesis-eligible guard + call

supabase/migrations/
  20260623010000_synthesis_source_chunks.sql
    ← source_chunks table, match_sources RPC, RLS

tests/rls/
  synthesis-source-chunks.test.ts   ← RLS + RPC attack suite
```

**Confirmed architectural decisions (from spec §9 forks, all resolved by John):**
- Chunk size: 400 tokens / 80-token overlap.
- Storage: same Supabase instance, `source_chunks` table (Option A).
- Eligibility classification: reuse router's `classification.signals` array — add `'knowledge_lookup'` signal in the classifier when the text contains retrieval markers (Option B — extend the existing classifier, no extra model call).
- Gap recompose: fresh 2nd LLM call with the extended passage set (Option A).

**P2 dependency:** P5 creates `source_chunks` + `match_sources` but does NOT write chunk rows in production. The seed path in the eval harness (`insertTestChunks` helper) provides the mocked-chunk path needed for tests. The real ingest pipeline is P2's job.

**Budget:** synthesis turns draw exactly one `chat_total` bucket unit via the existing `frontier_budget_take` call in `keeperChat`. No second counter. Both compose calls are recorded via `recordModelCall(task: 'synthesis', origin: 'chat')`.

**Bounded-loop invariants:** ≤2 LLM calls, ≤2 embed calls, ≤3 RPC calls, 12s hard timeout. Fail-open on any sub-step (never throws; degrades to partial answer).

---

## Global constraints

- `import 'server-only'` at the top of every file under `apps/web/lib/synthesis/`.
- Never pass raw user text to the synthesis model without the passage-grounded system prompt; the prompt instructs the model to answer only from provided passages.
- All new RLS policies follow the member-read / no-authenticated-write pattern from `memory_entries`. `match_sources` is `service_role`-only (revoke from `public, anon, authenticated`).
- Every new `SynthesisCard` must have a `transcript` field for screen-reader/a11y parity (spec §4.2).
- Keep `KEEPER_SYSTEM_PROMPT` (the stable, cached block) separate from the synthesis system prompt. The synthesis prompt lives in `packages/keeper/src/synthesis-prompt.ts` and is marked `cache: true` for the same prefix-discipline.
- Run `npm run lint && npm run typecheck && npm run test` (from repo root) before every commit. Confirm green before marking a task done.
- Each task ends with a `git commit`. Message format: `p5: <what>`.
- Adversarial gate (4-reviewer: red-team / claims-auditor / logic-skeptic / cost-auditor) runs on the final PR. Report to `docs/gates/`.

---

## Tasks

### T0 — Read + orient (no code; ~15 min)

Confirm the branch is `feature/company-brain-synthesis` and `20260622140000_company_brain_foundation.sql` is applied to dev. Verify:

```bash
cd /c/nib-p5
git branch
git log --oneline -8
grep -r "source_chunks" supabase/migrations/  # must return nothing yet
```

No commit for T0.

---

### T1 — Migration: `source_chunks` + `match_sources` + RLS

**File:** `supabase/migrations/20260623010000_synthesis_source_chunks.sql`

**What to write (exact schema from spec §4.2 + §4.3):**

```sql
-- source_chunks: one row per chunk produced at ingest time (P2).
-- P5 only reads; writes are P2's job. Embedding may be null (no VOYAGE_API_KEY).
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

-- RLS: member-read, no authenticated writes (identical pattern to memory_entries).
alter table public.source_chunks enable row level security;
create policy "members read own account chunks"
  on public.source_chunks for select
  using (private.is_account_member(account_id));
revoke insert, update, delete on public.source_chunks from authenticated, anon;

-- match_sources: hybrid retrieval over source_chunks + sources join.
-- 60/25/10/5 weighting: semantic + FTS + recency + source_tier bonus.
-- Mirrors match_memory; service_role-only.
create function public.match_sources(
  p_account uuid,
  p_embedding text,   -- postgres vector literal '[x,y,...]' or null
  p_query text,
  p_limit integer default 6,
  p_min_score numeric default 0.25
) returns table (
  chunk_id uuid,
  source_id uuid,
  source_title text,
  source_tier smallint,
  text text,
  score numeric
)
language sql
security definer
set search_path = public, private
as $$
  select
    sc.id as chunk_id,
    s.id  as source_id,
    s.title as source_title,
    s.source_tier,
    sc.text,
    round((
      coalesce(
        case when p_embedding is not null
          then 0.60 * (1 - (sc.embedding <=> p_embedding::vector))
          else 0.0
        end,
        0.0
      )
      + coalesce(
        case when p_query <> ''
          then 0.25 * ts_rank(sc.fts, plainto_tsquery('english', p_query))
          else 0.0
        end,
        0.0
      )
      + 0.10 * exp(-extract(epoch from (now() - s.captured_at)) / 2592000.0)
      + 0.05 * (s.source_tier::numeric / 100.0)
    )::numeric, 4) as score
  from public.source_chunks sc
  join public.sources s on s.id = sc.source_id
  where sc.account_id = p_account
    and (p_embedding is null or sc.embedding is not null
         or p_query <> '')
  having round((
      coalesce(
        case when p_embedding is not null
          then 0.60 * (1 - (sc.embedding <=> p_embedding::vector))
          else 0.0
        end,
        0.0
      )
      + coalesce(
        case when p_query <> ''
          then 0.25 * ts_rank(sc.fts, plainto_tsquery('english', p_query))
          else 0.0
        end,
        0.0
      )
      + 0.10 * exp(-extract(epoch from (now() - s.captured_at)) / 2592000.0)
      + 0.05 * (s.source_tier::numeric / 100.0)
    )::numeric, 4) >= p_min_score
  order by score desc
  limit p_limit;
$$;

revoke execute on function public.match_sources(uuid, text, text, integer, numeric)
  from public, anon, authenticated;
grant execute on function public.match_sources(uuid, text, text, integer, numeric)
  to service_role;
```

**Apply to dev:**

```bash
supabase db push --db-url "$DEV_DATABASE_URL"
# or via supabase CLI local: supabase migration up
```

*(Staging/prod apply at merge — same procedure as all prior migrations.)*

**Commit:** `p5: migration 20260623010000 — source_chunks + match_sources RPC`

---

### T2 — RLS + RPC attack suite (write tests BEFORE the engine)

**File:** `tests/rls/synthesis-source-chunks.test.ts`

Follow the exact pattern of `tests/rls/memory.test.ts` and `tests/rls/company-brain-foundation.test.ts`.

**Tests to write:**

```ts
describe('source_chunks RLS + match_sources RPC')

it('a member reads only their own account chunks; cross-account returns 0 rows')
it('anon cannot select from source_chunks')
it('authenticated cannot insert/update/delete source_chunks directly')
it('match_sources as authenticated throws permission denied')
it('match_sources as anon throws permission denied')
it('match_sources as service_role returns rows when FTS matches (p_embedding=null path)')
it('match_sources as service_role returns empty set when no match and min_score is high')
it('match_sources respects p_min_score threshold')
it('every new table in this migration has RLS enabled')
```

**Seed pattern (inside `beforeAll`):**
Insert a `source` row via service_role (matching the F1 `sources` table schema); insert two `source_chunks` rows (no embedding — FTS-only path so no VOYAGE_API_KEY needed in CI).

**Run tests:**

```bash
cd /c/nib-p5
npx vitest run tests/rls/synthesis-source-chunks.test.ts
```

Tests should be RED on schema errors only (no logic failures) if T1 was applied correctly. Fix any schema issues in the migration now.

**Commit:** `p5: RLS attack suite for source_chunks + match_sources`

---

### T3 — `retrieve-sources.ts` — the source-corpus retrieval caller

**File:** `apps/web/lib/synthesis/retrieve-sources.ts`

Mirrors `apps/web/lib/memory/retrieve.ts` exactly — `import 'server-only'`, `serviceClient()`, `embedQuery()`, pass to `match_sources` RPC.

```ts
import 'server-only';
import { serviceClient } from '../supabase/service';
import { embedQuery } from '../llm/embed';

export interface SourceChunkRow {
  chunk_id: string;
  source_id: string;
  source_title: string;
  source_tier: number;
  text: string;
  score: number;
}

/**
 * Best-effort: returns ranked source chunk rows, or [] on any failure.
 * With no VOYAGE_API_KEY: p_embedding is null, RPC ranks by FTS + recency only.
 */
export async function retrieveSourceChunks(
  accountId: string,
  query: string,
  limit = 6,
  minScore = 0.25,
): Promise<SourceChunkRow[]> {
  try {
    const svc = serviceClient();
    const vec = await embedQuery(query);
    const pEmbedding = vec ? `[${vec.join(',')}]` : null;
    const { data } = await svc.rpc('match_sources', {
      p_account: accountId,
      p_embedding: pEmbedding,
      p_query: query,
      p_limit: limit,
      p_min_score: minScore,
    });
    return (data ?? []) as SourceChunkRow[];
  } catch (err) {
    console.error('[synthesis] retrieveSourceChunks failed (best-effort)', err instanceof Error ? err.message : err);
    return [];
  }
}
```

**Unit test:** `apps/web/lib/synthesis/__tests__/retrieve-sources.test.ts`

Use vitest. Mock `serviceClient` and `embedQuery`. Tests:

```ts
it('calls match_sources with vector literal when embedQuery returns a vector')
it('calls match_sources with p_embedding=null when embedQuery returns null (no-key path)')
it('returns [] on RPC error (best-effort, never throws)')
it('returns typed SourceChunkRow[] when RPC returns rows')
```

**Run:**

```bash
npx vitest run apps/web/lib/synthesis/__tests__/retrieve-sources.test.ts
```

**Commit:** `p5: retrieve-sources.ts + unit tests (source chunk retrieval caller)`

---

### T4 — `synthesis-prompt.ts` — the cacheable synthesis system prompt

**File:** `packages/keeper/src/synthesis-prompt.ts`

This is a **pure string export** — no dependencies. Stable across all accounts and all questions (marks `cache: true` when the caller passes it to the LLM).

```ts
/**
 * Grovekeeper synthesis system prompt (P5 §3.3).
 * Stable and cacheable — every token here is paid once. Do NOT add per-account
 * or per-question content here; that goes in the volatile suffix after.
 *
 * Output schema (JSON mode):
 *   { summary, answer, citations, hasGap, gapNote }
 * Each citation: { passageIndex, label, kind, sourceId?, excerpt }
 */
export const SYNTHESIS_SYSTEM_PROMPT = `You are the Grovekeeper's knowledge engine. Your job is to answer a user's question using only the passages provided below. You may not use any knowledge that is not in the provided passages.

Rules:
1. Answer from the passages only. If a claim appears in no passage, do not make it.
2. Cite every claim: after each sentence that draws on a passage, append [N] where N is the passage's index in the list (zero-based).
3. Keep the answer between 80 and 300 words.
4. Write a summary of 1–2 sentences (≤ 60 words) — a condensed headline of the answer.
5. Set hasGap to true if the passages do not fully answer the question, and write one sentence in gapNote describing what is missing. Set hasGap to false and gapNote to null if the passages cover the question adequately.
6. Do not mention that you are an AI. Do not break character. Answer warmly, plainly, sentence case.

Output: respond ONLY with a JSON object (no markdown fences, no preamble) matching this schema exactly:
{
  "summary": "<1–2 sentence condensed answer, ≤60 words>",
  "answer": "<cited prose, 80–300 words>",
  "citations": [
    {
      "passageIndex": <integer, 0-based index of the passage cited>,
      "label": "<doc title or memory provenance tag>",
      "kind": "memory" | "source",
      "sourceId": "<uuid or null>",
      "excerpt": "<verbatim snippet from the passage, ≤200 chars>"
    }
  ],
  "hasGap": <boolean>,
  "gapNote": "<one sentence or null>"
}`;
```

Also export a helper that builds the volatile suffix:

```ts
export interface SynthesisPassage {
  index: number;
  kind: 'memory' | 'source';
  label: string;
  sourceId?: string;
  text: string;
}

/** Volatile suffix: the ranked passages + the question. Paid per call. */
export function buildSynthesisInput(question: string, passages: SynthesisPassage[]): string {
  const passageBlock = passages
    .map((p) => `[${p.index}] (${p.kind}) ${p.label}\n${p.text}`)
    .join('\n\n');
  return `Passages:\n\n${passageBlock}\n\nQuestion: ${question}`;
}
```

**Unit test:** `packages/keeper/src/__tests__/synthesis-prompt.test.ts`

```ts
it('SYNTHESIS_SYSTEM_PROMPT is a non-empty string')
it('buildSynthesisInput includes passage index, kind, label, and text')
it('buildSynthesisInput includes the question at the end')
it('buildSynthesisInput produces correct output for 0 passages (edge case)')
```

**Run:**

```bash
npx vitest run packages/keeper/src/__tests__/synthesis-prompt.test.ts
```

**Commit:** `p5: synthesis-prompt.ts — cacheable system prompt + buildSynthesisInput`

---

### T5 — `SynthesisCard` type + classifier `knowledge_lookup` signal

#### 5a — `SynthesisCard` type in `packages/keeper/src/types.ts`

Add to `types.ts` (after `ChartCard`):

```ts
export interface SynthesisCard extends CardBase {
  kind: 'synthesis';
  summary: string;         // 1-2 sentence condensed answer for the bubble
  fullAnswer: string;      // full cited prose for the modal
  citations: Citation[];
  gapNote: string | null;
  corpusCounts: { memory: number; sources: number };
}

export interface Citation {
  label: string;           // human-readable: doc title or memory provenance tag
  kind: 'memory' | 'source';
  sourceId?: string;       // present when kind === 'source'
  excerpt: string;         // max 200 chars, verbatim snippet cited
  score: number;           // normalised 0-1 hybrid score
}
```

Add `SynthesisCard` to the `KeeperCard` union.

Ensure `packages/keeper/src/index.ts` exports `SynthesisCard`, `Citation`.

#### 5b — `knowledge_lookup` signal in `packages/router/src/classifier.ts`

Add before the final `return` in `classifyComplexity`:

```ts
/** Knowledge-lookup marker — retrieval-shaped questions.
 *  Must fire before the tier threshold check so the signal is present
 *  on the RouteDecision regardless of complexity tier. */
const KNOWLEDGE_LOOKUP =
  /\b(what do I charge|my (policy|rate|policies|rates|pricing)|do I have|what('?s| is) in my (notes|memory|files)|what('?ve| have) I|tell me (about|what)|what do (you|I) know about)\b/i;

if (KNOWLEDGE_LOOKUP.test(trimmed)) {
  signals.push('knowledge_lookup');
}
```

The `signals` array is already returned in `Classification` and surfaced on `RouteDecision.classification.signals`. No schema change needed.

**Unit tests for 5a+5b:** `packages/keeper/src/__tests__/synthesis-types.test.ts` + `packages/router/src/__tests__/classifier-knowledge-lookup.test.ts`

For types test — compile-time check only (TypeScript widening into `KeeperCard` union; verify `kind: 'synthesis'` is accepted).

For classifier test:

```ts
it('emits knowledge_lookup signal for "what do I charge for portraits"')
it('emits knowledge_lookup signal for "what is my policy on deposits"')
it('emits knowledge_lookup signal for "do I have any notes about Acme"')
it('does NOT emit knowledge_lookup for "hey what time is it"')
it('emits knowledge_lookup alongside other signals (e.g. drafting)')
```

**Run:**

```bash
npx vitest run packages/router/src/__tests__/classifier-knowledge-lookup.test.ts
```

**Commit:** `p5: SynthesisCard type + knowledge_lookup classifier signal`

---

### T6 — `engine.ts` — the bounded-agentic synthesis service

**File:** `apps/web/lib/synthesis/engine.ts`

This is the heart of P5. Write the RED tests first, then implement.

#### 6a — Write the tests first

**File:** `apps/web/lib/synthesis/__tests__/engine.test.ts`

Use vitest. Mock `retrieveMemoryBlock` (from `../memory/retrieve`), `retrieveSourceChunks` (from `./retrieve-sources`), `embedQuery` (from `../llm/embed`), and the LLM call (via a `vi.fn()` injected through the `_testOverrides` escape hatch — see below).

```ts
// The engine accepts optional _testOverrides for unit testing:
// { llmCall?: (prompt: string) => Promise<string | null> }
// This avoids mocking the anthropicGenerate module directly.

describe('synthesize() — bounded-agentic engine')

it('returns a SynthesisResult with ≥1 citation when corpus is non-empty')
it('returns gapNote=null when hasGap=false')
it('fires gap requery when hasGap=true and passage count < 6')
it('does NOT fire more than one gap requery (bounded-ness)')
it('gracefully degrades when LLM returns null (best-effort, never throws)')
it('gracefully degrades when retrieveMemoryBlock throws')
it('gracefully degrades when retrieveSourceChunks throws')
it('resolves within 12s — hard timeout test (mock a slow LLM)')
it('records two recordModelCall entries when gap requery fires')
it('records one recordModelCall entry on a normal compose (no gap)')
it('returns corpusCounts.memory = number of memory rows retrieved')
it('returns corpusCounts.sources = number of source chunk rows retrieved')
it('VOYAGE_API_KEY absent — embedQuery returns null — engine still returns an answer (FTS path)')
```

Run these first to confirm they all FAIL (red). They will fail on import errors — that is correct before T6b.

```bash
npx vitest run apps/web/lib/synthesis/__tests__/engine.test.ts
```

#### 6b — Implement `engine.ts`

Public interface (must exactly match spec §3.1):

```ts
import 'server-only';

export interface SynthesisResult {
  answer: string;
  citations: Citation[];
  gapNote: string | null;
  corpusCounts: { memory: number; sources: number };
}

export interface Citation {
  label: string;
  kind: 'memory' | 'source';
  sourceId?: string;
  excerpt: string;
  score: number;
}

export interface SynthesisInput {
  accountId: string;
  nibbinId: string;
  question: string;
  userId: string;
}
```

Implementation skeleton (complete all stubs before committing):

```ts
const HARD_TIMEOUT_MS = 12_000;

export async function synthesize(
  input: SynthesisInput,
  _testOverrides?: { llmCall?: (system: string, user: string) => Promise<string | null> },
): Promise<SynthesisResult> {
  try {
    return await Promise.race([
      _synthesizeInner(input, _testOverrides),
      new Promise<SynthesisResult>((resolve) =>
        setTimeout(() => resolve(EMPTY_RESULT('Synthesis timed out.')), HARD_TIMEOUT_MS),
      ),
    ]);
  } catch (err) {
    console.error('[synthesis] engine failed (best-effort)', err instanceof Error ? err.message : err);
    return EMPTY_RESULT();
  }
}
```

`_synthesizeInner` follows the four-step loop from spec §3.2:

1. **RETRIEVE** — parallel `Promise.all([retrieveMemoryBlock(...), retrieveSourceChunks(...)])`. Convert memory block string to passage objects; convert source chunk rows to passage objects. Merge and rank (memory first).
2. **COMPOSE + CITE** — call the LLM (`anthropicGenerate`) with `SYNTHESIS_SYSTEM_PROMPT` (cache: true) + `buildSynthesisInput(question, passages)`. Parse the JSON response. On parse error, return best-effort prose with no citations.
3. **GAP ANALYSIS** — if `hasGap === true && totalPassages < 6`: embed `gapNote`, call `retrieveSourceChunks(gapNote, 4, 0.45)`, merge new chunks, recompose (one more LLM call, max). Set a boolean `didRequery = true` so the loop cannot fire again.
4. **RETURN** — assemble `SynthesisResult` from the compose output. Record both model calls via `recordModelCall({ task: 'synthesis', origin: 'chat' })`.

Key invariants to enforce in code:
- `didRequery` flag: gap requery may fire at most once.
- Each `recordModelCall` call is best-effort (wrapped in try/catch, never throws).
- Citations: `score` is normalised from the passage's retrieval score (memory passages get a synthetic score of 0.85 as they don't have a numeric match score from `match_memory`).
- `EMPTY_RESULT()` helper returns `{ answer: '', citations: [], gapNote: null, corpusCounts: { memory: 0, sources: 0 } }`.

After implementing, re-run engine tests — all should be GREEN:

```bash
npx vitest run apps/web/lib/synthesis/__tests__/engine.test.ts
```

**Commit:** `p5: synthesis engine (engine.ts) with bounded agentic loop + unit tests`

---

### T7 — `keeperChatAction` integration

**File:** `apps/web/app/app/grove/actions.ts`

Modify `keeperChatAction` to inject the synthesis path. Write the integration test first.

#### 7a — Test first

**File:** `apps/web/app/app/grove/__tests__/keeper-chat-synthesis.test.ts`

Mock `synthesize` from `../../../lib/synthesis/engine`, mock `keeperChat` (from `@nibbin/keeper`), mock `groveSession`.

```ts
it('calls synthesize when classification.signals includes knowledge_lookup')
it('returns SynthesisCard message when synthesize succeeds')
it('falls through to normal keeperChat when synthesis throws (graceful fallback)')
it('falls through to normal keeperChat when question is not knowledge_lookup')
it('budget draw (frontier_budget_take via keeperChat) is called exactly once per turn regardless of synthesis path')
it('routing payload is returned correctly for synthesis turn')
```

#### 7b — Implement

In `keeperChatAction`, before dispatching to `keeperChat`, extract the router's classification decision. Since `keeperChat` already calls `deps.route(...)` internally and returns `reply.decision.classification`, the synthesis check must happen AFTER the router call:

```ts
const reply = await keeperChat(...);

// Synthesis-eligible check: reuse the router's classification signal.
// The knowledge_lookup signal was added in T5b. No extra model call.
const isKnowledgeLookup = reply.decision.classification?.signals?.includes('knowledge_lookup') ?? false;

if (isKnowledgeLookup && llm) {
  try {
    const result = await synthesize({ accountId, nibbinId: /* nibbin from grove_state */ '...', question: text, userId: user.id });
    const card: SynthesisCard = {
      kind: 'synthesis',
      summary: result.answer.slice(0, 300),   // engine puts summary as answer[:300] — see T6 note
      fullAnswer: result.answer,
      citations: result.citations,
      gapNote: result.gapNote,
      corpusCounts: result.corpusCounts,
      transcript: result.answer,
    };
    return { message: { id: crypto.randomUUID(), from: 'keeper', card }, expression: 'presenting', routing: ... };
  } catch {
    // Fall through to normal reply below.
  }
}
// ... return normal reply (unchanged)
```

**Note on `nibbinId`:** The `grove_state` row already contains the keeper nibbin's id. The current `keeperChatAction` fetches `keeper_name`; extend the select to also fetch `nibbin_id` (or look it up from `nibbins` where `account_id = accountId AND kind = 'keeper'`).

**Note on `summary`:** The spec says the engine's compose step produces a `summary` field in the JSON output. In T6, the engine should expose `summary` on `SynthesisResult`. Update `SynthesisResult` to include `summary: string` and wire `SynthesisCard.summary` from it.

Run:

```bash
npx vitest run apps/web/app/app/grove/__tests__/keeper-chat-synthesis.test.ts
```

**Commit:** `p5: keeperChatAction synthesis integration (classification gate + SynthesisCard return)`

---

### T8 — UI: `SynthesisCard` branch in `CardView` + `SynthesisModal`

#### 8a — `SynthesisModal.tsx`

**File:** `apps/web/app/app/grove/SynthesisModal.tsx`

A portal modal (renders in `<body>` via `createPortal`). Reuses existing modal patterns from the codebase.

Structure from spec §5.4:

```
[Modal header]  "What I found"
[Full answer block] — cited prose (inline [1],[2]... superscripts)
[Citations list] — for each citation: bullet, label, excerpt, kind badge (memory/doc)
[Gap note block] — omitted when gapNote is null
  "What I couldn't find:  [gapNote]"
[Footer] "From [N] memory entries and [M] sources"
[Close] button
```

Props: `{ card: SynthesisCard; onClose: () => void }`.

No server actions. No writes. Read-only.

Accessibility: `role="dialog"`, `aria-modal="true"`, `aria-label="What I found"`, focus trap on open, restore focus on close, `Escape` key closes.

**CSS:** Add synthesis-modal styles to `grove.module.css` or a new `synthesis-modal.module.css`. Follow existing Nibbin style (no Tailwind — the app uses CSS modules).

#### 8b — `SynthesisCard` branch in `CardView`

**File:** `apps/web/app/app/grove/cards.tsx`

Add before the `default` case:

```tsx
case 'synthesis': {
  const [modalOpen, setModalOpen] = useState(false);
  return (
    <div className={styles.synthesisCard}>
      <p className={styles.cardText}>{card.summary}</p>
      <button
        type="button"
        className={styles.synthesisDetailBtn}
        onClick={() => setModalOpen(true)}
      >
        View details
      </button>
      {modalOpen && (
        <SynthesisModal card={card} onClose={() => setModalOpen(false)} />
      )}
    </div>
  );
}
```

**Note:** `CardView` is currently a pure function. Adding `useState` requires either making it a component (it already renders JSX via a switch, so this is fine — React hooks work in any component function) or extracting a `SynthesisCardView` sub-component that holds the state. Either approach is acceptable; prefer extracting `SynthesisCardView` to keep `CardView` free of state.

#### 8c — Tests

**File:** `apps/web/app/app/grove/__tests__/synthesis-ui.test.tsx`

Use vitest + React Testing Library (`@testing-library/react`). Check existing test setup in the repo first.

```ts
it('SynthesisModal renders summary, full answer, citations list, gap note, corpusCounts footer')
it('SynthesisModal omits gap note block when gapNote is null')
it('SynthesisModal close button calls onClose')
it('Escape key calls onClose')
it('CardView renders synthesis kind as a summary bubble with "View details" button')
it('Clicking "View details" opens SynthesisModal')
```

Run:

```bash
npx vitest run apps/web/app/app/grove/__tests__/synthesis-ui.test.tsx
```

**Commit:** `p5: SynthesisModal + SynthesisCard branch in CardView (UI surface)`

---

### T9 — Keeper system prompt update (discoverability — §6)

**File:** `packages/keeper/src/prompt.ts`

Two prompt-level changes only (no code logic):

1. Add the "I don't know, ask me" affordance to `KEEPER_SYSTEM_PROMPT`: append to the "If you don't know something" bullet:
   > "If you don't know something about their account, say so simply. If they wonder what's in their notes, say: 'If you want me to search what I know, just ask me what you'd like to find.'"

2. No change to `buildKeeperContext` — the synthesis prompt chip ("Ask me what you know about [field]") fires from the proposal-approval flow, not from the Keeper context builder. That wiring is deferred to P6 (spec §6 says "the Keeper proactively surfaces… as a chip suggestion in its next message" — this requires hooking into the proposal-approval notification flow, which is P6 scope).

**Test:** Extend `packages/keeper/src/__tests__/prompt.test.ts` (or create it if absent):

```ts
it('KEEPER_SYSTEM_PROMPT mentions searching notes when user asks')
```

**Commit:** `p5: keeper system prompt — "ask me to search" affordance`

---

### T10 — Quality eval harness (gating task)

**File:** `apps/web/lib/synthesis/eval.ts`

Standalone script — `import 'server-only'` is NOT present (it runs as a tsx script, not in Next.js). This file is NOT imported by any app code.

**Seed helper** (inline in eval.ts or a sibling `eval-seed.ts`):

```ts
/** Insert test source_chunks rows (bypassing P2 ingest pipeline). Service-role only. */
async function insertTestChunks(svc: SupabaseClient, accountId: string, chunks: { text: string; sourceTitle: string }[]): Promise<string> {
  // 1. Insert a source row (kind='document', title=sourceTitle).
  // 2. Insert source_chunks rows with chunk_index and text; embedding=null (FTS path).
  // Returns the source_id.
}
```

**6 test cases** (from spec §7.2):

```ts
const TEST_CASES: EvalCase[] = [
  {
    name: 'Fully answerable from memory',
    corpusMemory: ['Clients pay a 50% deposit upfront on all projects.'],
    corpusSources: [],
    question: 'What deposit do I charge?',
    expectedCitedClaims: ['50% deposit'],
    expectedGap: false,
    forbiddenClaims: ['30%', 'no deposit'],
  },
  {
    name: 'Partially answerable from sources',
    corpusMemory: [],
    corpusSources: [{ text: 'Acme Corp contract: net-30 payment terms, $5000/mo retainer.', sourceTitle: 'Acme Contract' }],
    question: 'What are my payment terms with Acme?',
    expectedCitedClaims: ['net-30', '$5000'],
    expectedGap: false,
    forbiddenClaims: ['net-60', '$3000'],
  },
  {
    name: 'Not answerable — gap',
    corpusMemory: ['Pricing is set annually.'],
    corpusSources: [],
    question: 'What is my cancellation policy for weddings?',
    expectedCitedClaims: [],
    expectedGap: true,
    forbiddenClaims: ['50%', 'non-refundable'],
  },
  {
    name: 'Spans both memory and sources',
    corpusMemory: ['My standard rate is $120/hr.'],
    corpusSources: [{ text: 'Project Alpha quote: 40 hours estimated.', sourceTitle: 'Alpha Quote' }],
    question: 'How much would Project Alpha cost at my rate?',
    expectedCitedClaims: ['$120', '40 hours'],
    expectedGap: false,
    forbiddenClaims: ['$80', 'free'],
  },
  {
    name: 'Adversarial hallucination guard',
    corpusMemory: ['Renewal date is March 15.'],
    corpusSources: [{ text: 'Invoice number 1042: $2500 due April 1.', sourceTitle: 'Invoice 1042' }],
    question: 'What is my standard project rate?',
    expectedCitedClaims: [],
    expectedGap: true,
    forbiddenClaims: ['$2500', 'March 15', '1042'],
  },
  {
    name: 'Gap requery path',
    corpusMemory: [],
    corpusSources: [],  // first retrieval returns 0 hits
    gapRequerySources: [{ text: 'Late payment policy: 1.5% monthly interest after 30 days.', sourceTitle: 'Policy Doc' }],
    question: 'What is my late payment policy?',
    expectedCitedClaims: ['1.5%', '30 days'],
    expectedGap: false,
    forbiddenClaims: ['2%', '60 days'],
  },
];
```

**Metrics** (spec §7.3):

```ts
function citationPrecision(result: SynthesisResult, corpus: string[]): number {
  // fraction of citation.excerpt values that appear near-verbatim (≥0.85 Jaccard)
  // in the provided corpus strings
}
function gapRecall(results: EvalResult[]): number {
  // fraction of expectedGap=true cases where hasGap=true
}
function hallucinationRate(results: EvalResult[]): number {
  // fraction of forbiddenClaims that appear in the answer
}
```

**Pass thresholds (enforced, blocks CI):**

```ts
const THRESHOLDS = {
  citationPrecision: 0.90,
  gapRecall: 0.80,
  hallucinationRate: 0.00,
};
```

**Run command:**

```bash
tsx apps/web/lib/synthesis/eval.ts
```

The script exits 0 on PASS, 1 on FAIL (so CI can gate on it).

**Commit:** `p5: synthesis quality eval harness (6 test cases, citation precision ≥0.90, hallucination 0.00)`

---

### T11 — Full build + typecheck + all tests pass

```bash
cd /c/nib-p5
npm run lint
npm run typecheck
npm run test
```

Fix any errors. Do not proceed to T12 until all three are clean.

**Commit** any fixes: `p5: fix lint/type errors`

---

### T12 — Apply migration to staging + prod

```bash
# staging
supabase db push --db-url "$STAGING_DATABASE_URL"

# prod
supabase db push --db-url "$PROD_DATABASE_URL"
```

Verify `source_chunks` table + `match_sources` function exist on both:

```sql
select count(*) from information_schema.tables where table_name = 'source_chunks';
select proname from pg_proc where proname = 'match_sources';
```

**Commit:** `p5: migration applied to dev/staging/prod (verified)`

---

### T13 — Adversarial gate

Run the 4-reviewer gate (red-team / claims-auditor / logic-skeptic / cost-auditor). Follow `docs/gates/` file naming convention: `docs/gates/2026-06-23-p5-synthesis-think.md`.

Focus areas for the reviewers:
- **Red-team:** Can a user inject instructions via their question that override the synthesis system prompt? Can a malicious `source_chunks.text` row cause the engine to exfiltrate other accounts' data?
- **Claims-auditor:** Does the `SynthesisResult` always attribute to the provided corpus and never confabulate? Is the `forbiddenClaims` eval strong enough?
- **Logic-skeptic:** Is the `didRequery` flag correctly enforced so the loop is bounded at ≤2 LLM calls? Does the 12s timeout actually fire under a slow mocked LLM?
- **Cost-auditor:** Does each synthesis turn draw exactly ONE `chat_total` budget unit? Are both compose calls recorded in `model_calls` with `task: 'synthesis'`?

Gate must PASS before merging.

**Commit:** `p5: adversarial gate report — PASS`

---

### T14 — PR

```bash
git push origin feature/company-brain-synthesis
gh pr create --base main --title "P5: user-facing synthesis (think)" \
  --body "..."
```

PR body must reference:
- Spec: `docs/superpowers/specs/2026-06-23-synthesis-think-design.md`
- Gate report: `docs/gates/2026-06-23-p5-synthesis-think.md`
- Eval pass: `tsx apps/web/lib/synthesis/eval.ts` → EXIT 0
- Migration: `20260623010000_synthesis_source_chunks.sql` applied to dev/staging/prod
- 4 CI checks must pass (lint / typecheck / test / build)

---

## Task order summary

| # | Task | Key file(s) | Gate |
|---|------|------------|------|
| T0 | Orient | — | branch + foundation confirmed |
| T1 | Migration | `20260623010000_synthesis_source_chunks.sql` | applied to dev |
| T2 | RLS tests (RED→GREEN) | `tests/rls/synthesis-source-chunks.test.ts` | vitest green |
| T3 | Retrieve sources | `lib/synthesis/retrieve-sources.ts` + unit tests | vitest green |
| T4 | Synthesis prompt | `packages/keeper/src/synthesis-prompt.ts` + unit tests | vitest green |
| T5 | SynthesisCard type + classifier | `types.ts`, `classifier.ts` + unit tests | vitest green |
| T6 | Engine (RED→GREEN) | `lib/synthesis/engine.ts` + unit tests | vitest green |
| T7 | Keeper action integration | `actions.ts` + integration tests | vitest green |
| T8 | UI: modal + CardView | `SynthesisModal.tsx`, `cards.tsx` + UI tests | vitest green |
| T9 | Keeper prompt update | `prompt.ts` | unit test green |
| T10 | Eval harness (gating) | `lib/synthesis/eval.ts` | tsx eval exits 0 |
| T11 | Full build pass | — | lint + typecheck + test green |
| T12 | Migration staging/prod | — | verified on both DBs |
| T13 | Adversarial gate | `docs/gates/2026-06-23-p5-synthesis-think.md` | PASS |
| T14 | PR | — | 4 CI checks |

---

## Risks and mitigations

| Risk | Likelihood | Mitigation |
|------|-----------|-----------|
| `match_sources` HAVING clause on a computed column may error in older Postgres | Low | Use a subquery `WHERE score >= p_min_score` pattern instead if CI fails. Verify against the Supabase Postgres version first. |
| `synthesize()` nibbinId lookup — `grove_state` doesn't always have a nibbin_id column | Medium | Check the `grove_state` schema. If `nibbin_id` is absent, look up via `nibbins WHERE account_id = accountId AND kind = 'keeper'` in a separate query. |
| SynthesisModal `useState` inside `CardView` switch — React hooks rule violation if `CardView` is not a component | Medium | Extract a `SynthesisCardView` component. Do not put `useState` in a switch case of a non-component function. |
| Eval harness requires a live DB + VOYAGE_API_KEY for the embedding path | Medium | The eval uses the mocked-corpus `insertTestChunks` helper + the no-embedding FTS path. It should not require VOYAGE_API_KEY in CI. Set `p_embedding=null` throughout the eval. |
| `KNOWLEDGE_LOOKUP` regex misses paraphrases (spec risk acknowledged) | Low | The spec accepts this for P5 (Option B was chosen for classifier reuse; keyword miss is acceptable at launch, revisited with real usage data). |
| P2 dependency: `source_chunks` table is empty in production until P2 ships | Acknowledged | The engine degrades gracefully to memory-only when `source_chunks` returns no rows. `corpusCounts.sources = 0` will be normal until P2 ships. Document in PR body. |
