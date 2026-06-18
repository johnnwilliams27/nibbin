# Agent Memory (RAG, full semantic) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkbox steps. Spec: `docs/superpowers/specs/2026-06-18-agent-memory-rag-design.md`.

**Goal:** Per-Nibbin (agent) + per-account user memory of *derived, redacted* facts/preferences/entities: **write** (model-extraction after a decision, redaction-rechecked, embedded via Voyage `voyage-3`) → **retrieve-at-run** (hybrid semantic + full-text + recency, injected at draft time) → **forget** (C3 deletion via FK cascade; TTL expiry deferred). Carries the §12A invariants: derived-not-raw, per-account RLS never crosses accounts (within an account, members share user-scoped memory — per-user isolation deferred), provenance+confidence, best-effort isolation from the run path.

**Tech:** pgvector (1024-dim, HNSW cosine) in Supabase; Voyage `voyage-3` embedding client in `packages/router` (mirrors the Anthropic client; null when `VOYAGE_API_KEY` absent → FTS/recency-only fallback); model-extraction reuses `anthropicGenerate`. **GATED** (migration + `packages/router` + write hook) → `docs/gates/` report + adversarial gate + dev/staging/prod apply.

**Honest no-key fallback (mirror of `anthropicGenerate`):** if `VOYAGE_API_KEY` is unset, embedding is skipped — entries still store + retrieve via FTS/recency. The build must work with and without the key (CI has no key).

## File structure
- **Create** `supabase/migrations/20260618030000_agent_memory.sql` — extension, `memory_entries`, indexes, RLS, `match_memory` RPC.
- **Modify** `packages/router/src/voyage.ts` (new) + `packages/router/src/index.ts` — Voyage embedder.
- **Create** `apps/web/lib/llm/embed.ts` — cached `voyageEmbed()` + `embedTexts()`.
- **Create** `apps/web/lib/memory/extract.ts` — `writeMemoryFromDecision(...)` (extract → applyBattery → embed → upsert).
- **Create** `apps/web/lib/memory/retrieve.ts` — `retrieveMemoryBlock(accountId, nibbinId, intent)`.
- **Modify** `apps/web/lib/runtime/decide.ts` — hook the writer (best-effort, after the decision).
- **Modify** `apps/web/lib/llm/drafting.ts` — inject the retrieved block after Grove Memory.
- **Modify** `reference/subprocessors.html` — add the Voyage row.
- **Create** tests: `tests/rls/memory.test.ts`; `apps/web` unit tests for extract/retrieve formatting.

---

### Task 1: Migration — pgvector + `memory_entries` + RLS + match RPC

**Files:** Create `supabase/migrations/20260618030000_agent_memory.sql`

- [ ] **Step 1** — write it:
```sql
-- Agent + user memory (§12A): derived-not-raw facts/preferences/entities,
-- embedded (Voyage voyage-3, 1024-dim) for semantic retrieval. RLS per-account
-- (never crosses accounts); within an account, user-scoped rows are shared among
-- members (per-user isolation deferred to the account/team tier). Writes
-- service-role only. C3 deletion via the FK cascades below; TTL expiry deferred.
create extension if not exists vector;

create table public.memory_entries (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  scope text not null check (scope in ('agent', 'user')),
  nibbin_id uuid references public.nibbins (id) on delete cascade,
  user_id uuid references public.users (id) on delete cascade,
  kind text not null check (kind in ('fact', 'preference', 'entity')),
  text text not null check (btrim(text) <> '' and char_length(text) <= 400),
  provenance text not null check (provenance in ('observed', 'user-stated', 'inferred')),
  confidence numeric not null default 0.5 check (confidence >= 0 and confidence <= 1),
  source_run_id uuid references public.runs (id) on delete set null,
  fts tsvector generated always as (to_tsvector('english', text)) stored,
  embedding vector(1024),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz,
  -- scope integrity: agent rows carry a nibbin, user rows carry a user.
  constraint memory_scope_owner check (
    (scope = 'agent' and nibbin_id is not null) or
    (scope = 'user'  and user_id is not null)
  )
);

-- Dedupe anchor: one entry per (account, scope, owner, kind, normalized text).
create unique index memory_entries_dedupe on public.memory_entries
  (account_id, scope, coalesce(nibbin_id, '00000000-0000-0000-0000-000000000000'::uuid),
   coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid), kind, lower(text));
create index memory_entries_account_idx on public.memory_entries (account_id, scope);
create index memory_entries_fts_idx on public.memory_entries using gin (fts);
create index memory_entries_embedding_idx on public.memory_entries
  using hnsw (embedding vector_cosine_ops);

alter table public.memory_entries enable row level security;
create policy memory_member_read on public.memory_entries
  for select to authenticated using ((select private.is_account_member(account_id)));
revoke insert, update, delete, truncate, references, trigger
  on public.memory_entries from authenticated;
revoke all on public.memory_entries from anon;

-- Hybrid retrieval (semantic + full-text + recency), service-role only. Scoped
-- to ONE account; returns agent memory for p_nibbin ∪ the account's user memory.
-- p_embedding may be null (no Voyage key) → ranks on FTS + recency alone.
create function public.match_memory(
  p_account uuid,
  p_nibbin uuid,
  p_embedding vector(1024),
  p_query text,
  p_limit integer default 8,
  p_min_confidence numeric default 0.3
) returns table (id uuid, scope text, kind text, text text, provenance text, confidence numeric, score numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, m.scope, m.kind, m.text, m.provenance, m.confidence,
         ( 0.60 * case when p_embedding is not null and m.embedding is not null
                       then 1 - (m.embedding <=> p_embedding) else 0 end
         + 0.25 * case when btrim(coalesce(p_query, '')) <> ''
                       then least(ts_rank(m.fts, plainto_tsquery('english', p_query)), 1.0) else 0 end
         + 0.15 * exp(- extract(epoch from now() - m.last_seen_at) / (30 * 86400.0))
         )::numeric as score
    from public.memory_entries m
   where m.account_id = p_account
     and (m.scope = 'user' or (m.scope = 'agent' and m.nibbin_id = p_nibbin))
     and m.confidence >= p_min_confidence
     and (m.expires_at is null or m.expires_at > now())
   order by score desc
   limit greatest(coalesce(p_limit, 8), 1);
$$;
revoke execute on function public.match_memory(uuid, uuid, vector, text, integer, numeric) from public, anon, authenticated;
grant execute on function public.match_memory(uuid, uuid, vector, text, integer, numeric) to service_role;
```

- [ ] **Step 2** — do NOT apply (controller applies dev/staging/prod). Commit: `feat(db): agent/user memory_entries + pgvector hybrid match (RAG)`.

---

### Task 2: Voyage embedder in the router

**Files:** Create `packages/router/src/voyage.ts`; modify `packages/router/src/index.ts`

- [ ] **Step 1 — `voyage.ts`** — mirror the Anthropic client shape (a factory returning a fn; fetch-based; typed):
```ts
export interface VoyageOptions { apiKey: string; model?: string; timeoutMs?: number }
export type Embed = (texts: string[]) => Promise<number[][]>;

/** Voyage embeddings client (voyage-3, 1024-dim). Returns one vector per input,
 *  order-preserved. Throws on non-2xx — callers treat embedding as best-effort. */
export function createVoyageEmbedder(opts: VoyageOptions): Embed {
  const model = opts.model ?? 'voyage-3';
  const timeoutMs = opts.timeoutMs ?? 15_000;
  return async (texts) => {
    if (texts.length === 0) return [];
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch('https://api.voyageai.com/v1/embeddings', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${opts.apiKey}` },
        body: JSON.stringify({ model, input: texts, input_type: 'document' }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`voyage ${res.status}: ${await res.text()}`);
      const json = (await res.json()) as { data: Array<{ index: number; embedding: number[] }> };
      // Re-order defensively by `index` so output aligns to input order.
      const out: number[][] = new Array(texts.length);
      for (const d of json.data) out[d.index] = d.embedding;
      return out;
    } finally {
      clearTimeout(t);
    }
  };
}
```
(For a query embedding use `input_type: 'query'` — expose a 2nd arg or a sibling fn `embedQuery`. Keep it simple: add an optional 2nd param `inputType: 'document' | 'query' = 'document'`.)

- [ ] **Step 2 — `index.ts`** — export `createVoyageEmbedder`, `type Embed`, `type VoyageOptions`.
- [ ] **Step 3** — `cd /c/Nibbin && npx tsc --noEmit -p packages/router` → exit 0. Commit: `feat(router): Voyage voyage-3 embedding client`.

---

### Task 3: Web embed wrapper

**Files:** Create `apps/web/lib/llm/embed.ts`

- [ ] **Step 1** — mirror `anthropicGenerate`'s cached/null pattern:
```ts
import 'server-only';
import { createVoyageEmbedder, type Embed } from '@nibbin/router';

const g = globalThis as typeof globalThis & { __nibbinEmbed?: Embed | null };
export function voyageEmbed(): Embed | null {
  if (g.__nibbinEmbed !== undefined) return g.__nibbinEmbed;
  const key = process.env.VOYAGE_API_KEY;
  g.__nibbinEmbed = key && key.trim() !== '' ? createVoyageEmbedder({ apiKey: key }) : null;
  return g.__nibbinEmbed;
}

/** Best-effort: returns vectors aligned to `texts`, or null if no key / failure. */
export async function embedTexts(texts: string[]): Promise<number[][] | null> {
  const e = voyageEmbed();
  if (!e || texts.length === 0) return null;
  try { return await e(texts); } catch (err) {
    console.error('[memory] voyage embed failed', err instanceof Error ? err.message : err);
    return null;
  }
}
```

- [ ] **Step 2** — `cd /c/Nibbin && npx tsc --noEmit -p apps/web` → exit 0. Commit: `feat(web): voyage embed wrapper (null-safe)`.

---

### Task 4: Writer — extract → redact-check → embed → upsert

**Files:** Create `apps/web/lib/memory/extract.ts`

- [ ] **Step 1** — `writeMemoryFromDecision`. Read the existing `learned-note.ts` for the model-call + grounded patterns; reuse `anthropicGenerate()`/`recordModelCall` and `applyBattery` from `@nibbin/redaction`. Pseudocode-complete:
```ts
import 'server-only';
import { applyBattery } from '@nibbin/redaction';
import { serviceClient } from '../supabase/service';
import { anthropicGenerate, recordModelCall } from '../llm/client';
import { embedTexts } from '../llm/embed';
import { groveRouter } from '../grove/router';
// ... types: { kind: 'fact'|'preference'|'entity'; text: string; provenance: 'observed'|'user-stated'|'inferred'; confidence: number; scope: 'agent'|'user' }

export async function writeMemoryFromDecision(args: {
  accountId: string; userId: string; runId: string; nibbinId: string;
  decision: 'approved' | 'edited' | 'rejected';
}): Promise<void> {
  try {
    const svc = serviceClient();
    // Source = the run's already-sanitized draft step(s) + decision outcome.
    const { data: steps } = await svc.from('run_steps')
      .select('kind, payload').eq('run_id', args.runId).eq('kind', 'draft');
    const draftText = /* concat draft payloads' text, capped */;
    if (!draftText) return; // nothing to learn from
    const llm = anthropicGenerate();
    if (!llm) return; // no model → no extraction (FTS-only memory still works for user-stated entries later)
    // Strict-JSON extraction prompt: "From this {decision} draft + context, extract 0-3 DURABLE,
    // account-specific facts/preferences/entities worth remembering for future drafts. Omit anything
    // ephemeral or PII. Output JSON array [{scope:'agent'|'user',kind,text,provenance,confidence}]."
    const decisionR = await groveRouter.route({ userId: `account:${args.accountId}`, task: 'memory_extract', origin: 'pipeline' });
    const result = await llm({ model: decisionR.model, system: [{ text: EXTRACT_PROMPT, cache: true }],
      messages: [{ role: 'user', content: `Decision: ${args.decision}\n\nDraft:\n${draftText}` }], maxTokens: 400, temperature: 0.2 });
    await recordModelCall({ accountId: args.accountId, userId: args.userId, runId: args.runId, tier: decisionR.tier, task: 'memory_extract', model: result.model, usage: result.usage });
    const entries = parseEntries(result.text); // tolerant JSON parse; [] on failure
    // derived-not-raw GUARD: drop any entry whose text still trips a redaction rule.
    const clean = entries.filter((e) => e.text && applyBattery(e.text).hits.length === 0).slice(0, 3);
    if (clean.length === 0) return;
    const vectors = await embedTexts(clean.map((e) => e.text)); // null if no key → store without embedding
    for (let i = 0; i < clean.length; i++) {
      const e = clean[i];
      await svc.from('memory_entries').upsert({
        account_id: args.accountId, scope: e.scope,
        nibbin_id: e.scope === 'agent' ? args.nibbinId : null,
        user_id: e.scope === 'user' ? args.userId : null,
        kind: e.kind, text: e.text, provenance: e.provenance,
        confidence: Math.min(Math.max(e.confidence ?? 0.5, 0), 1),
        source_run_id: args.runId, last_seen_at: new Date().toISOString(),
        embedding: vectors?.[i] ?? null,
      }, { onConflict: 'account_id,scope,...', ignoreDuplicates: false }); // match the dedupe index; on conflict bump last_seen_at
    }
  } catch (err) {
    console.error('[memory] write failed (best-effort)', err instanceof Error ? err.message : err);
  }
}
```
Implementer: finalize the `onConflict` to the dedupe index columns (or do a select-then-update for "bump last_seen_at / raise confidence" on duplicate). Confirm `applyBattery`'s return shape (`.hits`/`.matched` — read `packages/redaction/src/battery.ts`). The `EXTRACT_PROMPT` is a new stable prompt in this file. `recordModelCall` cost: `costMicroUsd` must know the extract model (it routes like specialist work; reuse the same model tier).

- [ ] **Step 2** — `cd /c/Nibbin && npx tsc --noEmit -p apps/web` → exit 0. Commit: `feat(web): memory writer — extract, redact-check, embed, upsert`.

---

### Task 5: Retriever + draft injection

**Files:** Create `apps/web/lib/memory/retrieve.ts`; modify `apps/web/lib/llm/drafting.ts`

- [ ] **Step 1 — `retrieve.ts`**:
```ts
import 'server-only';
import { serviceClient } from '../supabase/service';
import { embedTexts } from '../llm/embed';

/** Returns a formatted memory system-block for this nibbin+account, or null. */
export async function retrieveMemoryBlock(accountId: string, nibbinId: string, query: string): Promise<string | null> {
  try {
    const svc = serviceClient();
    const vecs = await embedTexts([query]); // null if no key
    const { data } = await svc.rpc('match_memory', {
      p_account: accountId, p_nibbin: nibbinId,
      p_embedding: vecs?.[0] ?? null, p_query: query, p_limit: 8, p_min_confidence: 0.3,
    });
    const rows = (data ?? []) as Array<{ kind: string; text: string; provenance: string }>;
    if (rows.length === 0) return null;
    const lines = rows.map((r) => `- (${r.provenance}) ${r.text}`).join('\n');
    return `What you've learned about this account (use as context; treat "inferred" items as tentative):\n${lines}`;
  } catch (err) {
    console.error('[memory] retrieve failed (best-effort)', err instanceof Error ? err.message : err);
    return null;
  }
}
```
(Passing `p_embedding` as a JS number[] to a `vector` param via PostgREST: confirm the supabase-js rpc serializes it; if pgvector needs a string literal, format as `'[' + vec.join(',') + ']'` — the implementer verifies against the dev DB. Fallback: a `text` param cast to vector inside the RPC.)

- [ ] **Step 2 — `drafting.ts`** — the `draft` seam only gets `runId`; resolve `nibbin_id` from it, then add a second cached block. After `const memory = await groveBlock();`:
```ts
        // Agent/user memory (§12A): retrieved per draft (semantic+FTS+recency),
        // injected as a third system block. Best-effort — never blocks a draft.
        const mem = await memoryBlockFor(runId); // resolves nibbin_id via svc, calls retrieveMemoryBlock; cached per run is N/A (per-runId)
        const system = [
          { text: DRAFTING_SYSTEM_PROMPT, cache: true },
          ...(memory ? [{ text: memory, cache: true }] : []),
          ...(mem ? [{ text: mem, cache: false }] : []), // per-run, not cacheable
        ];
```
Add a small helper in `drafting.ts` (or `retrieve.ts`) `memoryBlockFor(runId)` that does `svc.from('runs').select('nibbin_id, account_id').eq('id', runId).single()` then `retrieveMemoryBlock(account_id, nibbin_id, intent)`. (The drafter already has `accountId` from the closure; you still need `nibbin_id` from the run — one cheap PK read.) Memory retrieval is NOT cached (it varies by intent). Keep the existing token-accounting + fallback intact.

- [ ] **Step 3** — `cd /c/Nibbin && npx tsc --noEmit -p apps/web` → exit 0. Commit: `feat(web): retrieve agent/user memory + inject at draft time`.

---

### Task 6: Hook the writer into the decision path

**Files:** Modify `apps/web/lib/runtime/decide.ts`

- [ ] **Step 1** — after the existing `maybeDriftNudge` call (or alongside it), fire the writer best-effort:
```ts
  // §12A: learn durable memory from this decision (best-effort, never blocks).
  await writeMemoryFromDecision({
    accountId, userId, runId, nibbinId: run.nibbin_id as string, decision,
  });
```
Import `writeMemoryFromDecision`. Confirm `decision` is the `'approved'|'edited'|'rejected'` value in scope. Best-effort (the fn swallows its own errors).

- [ ] **Step 2** — `cd /c/Nibbin && npx tsc --noEmit -p apps/web` → exit 0. Commit: `feat(web): learn memory after each decision`.

---

### Task 7: Voyage subprocessor row

**Files:** Modify `reference/subprocessors.html`

- [ ] **Step 1** — add a Voyage AI row matching the existing table's columns/markup: **Subprocessor** Voyage AI; **Purpose** "Text embeddings for agent-memory semantic retrieval"; **Data** "Already-redacted derived memory text (facts/preferences/entities) — never raw email/content"; **Location** US (verify). Keep it in the same DRAFT/unrouted page (publication is #46-gated). Commit: `docs(legal): add Voyage AI subprocessor (agent-memory embeddings)`.

---

### Task 8: Tests
- [ ] **RLS** `tests/rls/memory.test.ts` (mirror `tests/rls/drip.test.ts` / `system-notification.test.ts`): (a) `authenticated`/`anon` cannot INSERT into `memory_entries`; (b) `authenticated` member can SELECT only their account's rows, non-member cannot; (c) `match_memory` is service-role-only (authenticated execute rejected). Run against the CI postgres container; skip-guard like the siblings.
- [ ] **Unit** (apps/web): `retrieveMemoryBlock` formats the block + returns null on empty; the extractor's `parseEntries` tolerates bad JSON → `[]`; the `applyBattery` filter drops a sentinel-bearing entry.
- [ ] `cd /c/Nibbin && npx tsc --noEmit -p apps/web && npx tsc --noEmit -p packages/router` → exit 0; `npx vitest run apps/web/ tests/rls/ packages/router/` → green.

---

### Task 9: Verify
- [ ] tsc (apps/web + packages/router) exit 0; full vitest green (incl. no-VOYAGE_API_KEY path — CI has no key, so embedding is skipped and everything still passes).
- [ ] **Derived-not-raw:** confirm `applyBattery` + the deterministic NER name check run on every entry BEFORE embed/store, and the redaction-corpus suite still passes.
- [ ] **RLS:** memory never crosses **accounts** (the RLS test proves it); within an account, members share user-scoped memory (per-user isolation deferred); writes service-role-only.
- [ ] **Best-effort isolation:** both the writer (`decide.ts`) and retriever (`drafting.ts`) swallow errors — a memory failure never breaks a decision or a draft.
- [ ] Note for the controller: set `VOYAGE_API_KEY` in Vercel (prod/preview) + local `.env` AFTER merge; until set, memory runs FTS/recency-only (no embeddings) — correct by design.

## Self-review
- Derived-not-raw enforced in depth (extract from already-sanitized draft text + `applyBattery` regex guard + a deterministic NER name check before embed/store). Per-account RLS, never crosses accounts (within an account, members share user-scoped memory — per-user isolation deferred to the account/team tier); writes service-role-only; `match_memory` service-role-only. Voyage receives only redacted derived text; null-key fallback keeps CI + key-less envs working. Best-effort everywhere — never on the run/decision critical path. Reuses the existing model-call + Grove-Memory-injection patterns; account/team tier, Style-Profile unification, editing UI, and Tier-2 remain deferred.
