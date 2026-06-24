# P2 — Document Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first external ingestion path into the F2 review loop. A user drops a PDF, DOCX, plain-text file, or image onto the Memory page; Nibbin extracts structured facts via redaction-gated LLM extraction; each extracted field surfaces as a `proposals` row the user reviews and approves. Also close the two deferred Foundation Minors (non-empty guard on `proposed_value`, append-overflow guard in `decide_memory_proposal`) in the P2 migration. No silent curated writes, ever.

**Architecture overview:**
- One migration `20260622150000_company_brain_p2_doc_ingest.sql`: creates the `brain-sources` Storage bucket (service-role bootstrap call in the migration script), adds a `source_extraction_jobs` queue table (avoids Vercel 60s timeout for long extractions), adds the `proposals_value_nonempty` CHECK, replaces `decide_memory_proposal` with the append-overflow guard, and patches `propose_memory_change` with the blank-value guard.
- Two new API routes: `POST /api/brain/documents/upload` (multipart, returns 202 + `sourceId`) and `GET /api/brain/sources/[sourceId]/status` (poll for processing state).
- A server-side extraction worker (`apps/web/lib/brain/doc-extract.ts`) called by an Edge Function cron trigger or Next.js route handler after the job row is enqueued; updates `sources.redaction_status` through `'processing'` → `'clean'`/`'redacted'`/`'quarantined'`.
- Text-native path: `pdf-parse` (PDF), `mammoth` (DOCX), raw read (TXT). Scanned-PDF / image path: vision model call via `groveRouter.route({ task: 'doc_vision_extract' })`.
- Redaction gate: `applyBattery` + `HeuristicNer` on all `rawText` before any write; re-check per proposed value. Pattern follows `apps/web/lib/memory/extract.ts` `isClean()`.
- LLM extraction: same `groveRouter.route()` + `recordModelCall` pattern as `derive.ts` `runPass1`, task `'doc_extract'`.
- Upload UI: drag-and-drop zone card on the Memory page (`/app/memory`), inline validation, progress states, 2-second poll on status route for up to 90 seconds.

**Confirmed decisions (baked in, not re-opened):**
- `source_extraction_jobs` queue table (avoids Vercel 60s timeout). Job row created in upload route; worker updates it on completion/error.
- All uploads default `source_tier=60` (no doc-kind picker at upload time).
- Scanned-PDF cap = 10 pages; log `{truncated_pages: true}` in `sources.origin` when doc exceeds 10.
- `.docx` only; reject `.doc` with a "Please save as .docx and try again" user-facing nudge.
- Foundation Minors: `char_length(trim(proposed_value)) > 0` CHECK + guard in `propose_memory_change`; append-overflow rejection (> 6000 chars) in `decide_memory_proposal` — both in the P2 migration.

**Tech stack:** Next.js App Router route handlers, Supabase service-role client, `@nibbin/redaction` (`applyBattery`, `HeuristicNer`), `pdf-parse`, `mammoth`, `groveRouter`, `recordModelCall`, `anthropicGenerate`, vitest + `tests/rls/harness.ts` (`RlsHarness`).

---

## Global Constraints

- **Migration file:** `supabase/migrations/20260622150000_company_brain_p2_doc_ingest.sql`. Latest existing is `20260622140000_company_brain_foundation.sql`.
- **Storage bucket name:** `brain-sources`. Private (not public). Per-account path convention: `{account_id}/{source_id}/{sanitized-filename}`. Created by the migration script via the Supabase JS admin client; documented in the migration file header.
- **No path traversal:** `sanitized-filename` strips `/`, `\`, and null bytes. `sourceId` (UUID) is the isolation unit.
- **Accepted types at upload:** `application/pdf`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document` (`.docx`), `text/plain`, `image/jpeg`, `image/png`, `image/webp`, `image/heic`. Reject `application/msword` (`.doc`) with a nudge message. Size cap: 20 MB enforced before Storage PUT.
- **Redaction mandatory:** `applyBattery` + `HeuristicNer` on ALL extracted text before any row is written. Quarantined docs produce zero proposals and update `sources.redaction_status='quarantined'`. Per-proposed-value re-check is defense-in-depth (drop, don't surface to user).
- **No silent curated writes.** Every extracted fact enters as a `proposals` row via `propose_memory_change(origin='doc_extract')`. Only the F2 `decide_memory_proposal` RPC writes to `grove_memory`.
- **Model calls recorded:** every `anthropicGenerate` call goes through `groveRouter.route()` and its result (including error path) is ledgered via `recordModelCall`.
- **`source_tier=60`** for all uploads (no picker).
- **Scanned PDF detection:** `pdf-parse` returns < 100 chars of selectable text across the first 3 pages → treat as scanned, rasterize first 10 pages.
- **`.doc` rejection:** return 422 with `{error: "doc_not_supported", message: "Please save the file as .docx and try again."}`.
- **rawText cap:** 50 000 chars (truncate before LLM call, note in prompt).
- **Proposed-value clamp:** 4 000 chars per field (leave headroom up to the 6 000 column limit).
- **`rationale` cap:** 200 chars. Format: `"From {filename} — {one-sentence reason}"`.
- **Reference catch-all:** rawText > 500 chars AND (no fields extracted OR rawText > 5 000 chars with < 3 field keys extracted) → one additional `notes` append proposal with a short summary (≤ 800 chars, separate small LLM call).
- **RLS on `source_extraction_jobs`:** member-read, no direct client writes.
- **Test DB:** `RLS_DATABASE_URL` (default `postgres://postgres:postgres@localhost:54329/postgres`). Run a single file: `npx vitest run tests/rls/company-brain-p2.test.ts`. Vitest unit files: `npx vitest run apps/web/lib/brain/doc-extract.test.ts`.
- Apply migration to **dev, staging, and prod** at the end (Task 9).
- Adversarial gate required (Task 10): new data path + curated-write producer.

---

## Task 1: Migration — Foundation Minors + queue table + bucket bootstrap

**Files:**
- Create: `supabase/migrations/20260622150000_company_brain_p2_doc_ingest.sql`
- Create (bucket bootstrap script): `scripts/bootstrap-brain-sources-bucket.ts`

**Purpose:** Close the two deferred Foundation Minors in-DB, add the `source_extraction_jobs` queue table, and document the `brain-sources` bucket creation.

- [ ] **Step 1: Write the failing RLS tests** for the new migration outcomes — `tests/rls/company-brain-p2.test.ts`.

  Tests to write:
  1. `proposals_value_nonempty` CHECK — service role attempts `insert into public.proposals (..., proposed_value='  ')` → fails with constraint violation.
  2. `propose_memory_change` RPC blank guard — `select public.propose_memory_change($1,'pricing','replace','',null,null,'manual')` → raises exception containing `'blank'`.
  3. Append-overflow guard — seed `grove_memory.sections['policies']` with 5 900 chars, then `decide_memory_proposal('approved')` on an `append` proposal of 200 chars → raises exception containing `'exceed'`; curated value unchanged.
  4. Normal replace still works post-migration (regression): propose → approve replace → curated value written.
  5. `source_extraction_jobs` RLS: member reads only their own rows; anon reads nothing; client cannot insert directly (raises permission denied).

  ```ts
  // tests/rls/company-brain-p2.test.ts
  import { describe, it, expect, beforeAll, afterAll } from 'vitest';
  import { RlsHarness } from './harness';

  const dbAvailable = await RlsHarness.probe();

  const UID = 'a9999999-0000-4000-8000-000000000001';
  describe.skipIf(!dbAvailable)('P2 migration — Foundation Minors + queue table', () => {
    const h = new RlsHarness();
    let acct = '';
    const asU = { kind: 'authenticated', uid: UID } as const;
    const service = { kind: 'service_role' } as const;

    beforeAll(async () => {
      await h.reset();
      await h.sql(`insert into auth.users (id,email) values ($1,'p2@ex.test')`, [UID]);
      await h.as(asU, async (c) => {
        await c.query(`insert into public.users (id,email) values ($1,$2)`, [UID, `${UID}@ex.test`]);
      });
      acct = await h.as(asU, async (c) =>
        (await c.query(`select public.create_account_with_owner('P2test') as id`)).rows[0].id);
    });
    afterAll(async () => { await h.close(); });

    it('proposals_value_nonempty CHECK rejects blank/whitespace', async () => {
      await expect(
        h.as(service, (c) => c.query(
          `insert into public.proposals (account_id,field_key,op,proposed_value,origin) values ($1,'pricing','replace','  ','manual')`,
          [acct]
        ))
      ).rejects.toThrow(/nonempty|value_nonempty|check/i);
    });

    it('propose_memory_change RPC rejects blank proposed_value', async () => {
      await expect(
        h.as(service, (c) => c.query(
          `select public.propose_memory_change($1,'pricing','replace','',null,null,'manual')`, [acct]
        ))
      ).rejects.toThrow(/blank/i);
    });

    it('decide_memory_proposal: append overflow raises; curated value unchanged', async () => {
      // Seed a 5900-char policies value
      const longVal = 'x'.repeat(5900);
      const pid1 = await h.as(service, async (c) =>
        (await c.query(`select public.propose_memory_change($1,'policies','replace',$2,null,null,'manual') as id`, [acct, longVal])).rows[0].id);
      await h.as(asU, async (c) => { await c.query(`select public.decide_memory_proposal($1,'approved')`, [pid1]); });

      // Now append a 200-char value (5900+1+200=6101 > 6000)
      const appendVal = 'y'.repeat(200);
      const pid2 = await h.as(service, async (c) =>
        (await c.query(`select public.propose_memory_change($1,'policies','append',$2,null,null,'manual') as id`, [acct, appendVal])).rows[0].id);
      await expect(
        h.as(asU, (c) => c.query(`select public.decide_memory_proposal($1,'approved')`, [pid2]))
      ).rejects.toThrow(/exceed/i);

      const v = await h.as(asU, async (c) =>
        (await c.query(`select sections->>'policies' as v from public.grove_memory where account_id=$1`, [acct])).rows[0].v);
      expect(v).toBe(longVal);
    });

    it('replace still works after the overflow guard is added', async () => {
      const pid = await h.as(service, async (c) =>
        (await c.query(`select public.propose_memory_change($1,'faq','replace','Q: How long? A: 2 weeks.',null,null,'manual') as id`, [acct])).rows[0].id);
      await h.as(asU, async (c) => { await c.query(`select public.decide_memory_proposal($1,'approved')`, [pid]); });
      const v = await h.as(asU, async (c) =>
        (await c.query(`select sections->>'faq' as v from public.grove_memory where account_id=$1`, [acct])).rows[0].v);
      expect(v).toBe('Q: How long? A: 2 weeks.');
    });

    it('source_extraction_jobs RLS: member reads own rows; anon cannot; client cannot insert', async () => {
      // service inserts a job row
      const srcId = await h.as(service, async (c) =>
        (await c.query(`insert into public.sources (account_id,kind,title) values ($1,'document','test') returning id`, [acct])).rows[0].id);
      await h.as(service, async (c) => {
        await c.query(`insert into public.source_extraction_jobs (account_id, source_id, status) values ($1,$2,'pending')`, [acct, srcId]);
      });
      const rows = await h.as(asU, async (c) =>
        (await c.query(`select status from public.source_extraction_jobs where account_id=$1`, [acct])).rows);
      expect(rows).toEqual([{ status: 'pending' }]);

      await expect(
        h.as({ kind: 'anon' }, (c) => c.query(`select * from public.source_extraction_jobs`))
      ).rejects.toThrow(/permission denied|row-level security/i);

      await expect(
        h.as(asU, (c) => c.query(
          `insert into public.source_extraction_jobs (account_id,source_id,status) values ($1,$2,'pending')`, [acct, srcId]
        ))
      ).rejects.toThrow(/permission denied|row-level security/i);
    });
  });
  ```

  Run: `npx vitest run tests/rls/company-brain-p2.test.ts` — expect failures (migration not yet written).

- [ ] **Step 2: Write the migration** — `supabase/migrations/20260622150000_company_brain_p2_doc_ingest.sql`

  Contents in order:
  1. **`proposals_value_nonempty` CHECK** on `public.proposals`:
     ```sql
     alter table public.proposals
       add constraint proposals_value_nonempty
       check (char_length(trim(proposed_value)) > 0);
     ```
  2. **Blank guard in `propose_memory_change`**: `create or replace function` with a new first guard:
     ```sql
     if trim(p_value) = '' then
       raise exception 'proposed_value must not be blank';
     end if;
     ```
     (Add this *above* the quarantined-source check; rest of body is identical to the F1 version.)
  3. **`source_extraction_jobs` queue table**:
     ```sql
     create table public.source_extraction_jobs (
       id uuid primary key default gen_random_uuid(),
       account_id uuid not null references public.accounts(id) on delete cascade,
       source_id uuid not null references public.sources(id) on delete cascade,
       status text not null default 'pending'
         check (status in ('pending','processing','done','error')),
       error_message text check (error_message is null or char_length(error_message) <= 2000),
       enqueued_at timestamptz not null default now(),
       started_at timestamptz,
       completed_at timestamptz
     );
     create index sej_account_status_idx on public.source_extraction_jobs (account_id, status, enqueued_at);
     create index sej_source_idx on public.source_extraction_jobs (source_id);
     ```
     RLS: same pattern as other brain tables — member-read, revoke writes from authenticated/anon.
  4. **Append-overflow guard in `decide_memory_proposal`**: `create or replace function` — in the `append` branch for each field type, add before the concatenation:
     ```sql
     if p.op = 'append' then
       new_val := coalesce(old_val, '') || E'\n' || p.proposed_value;
       if char_length(new_val) > 6000 then
         raise exception 'append would exceed field size limit (% chars); reject or replace instead',
           char_length(new_val);
       end if;
     else
       new_val := p.proposed_value;
     end if;
     ```
     The `notes` and `hard_rules` branches get the same overflow guard. The `replace` path is unchanged. Preserve all existing permissions/grants (authenticated only).
  5. **Header comment** noting that the `brain-sources` Storage bucket must be created separately via `scripts/bootstrap-brain-sources-bucket.ts` (documented below the `create table` block, since Postgres DDL cannot call the Supabase Storage API directly).

- [ ] **Step 3: Write `scripts/bootstrap-brain-sources-bucket.ts`** — runs once per environment to create the private `brain-sources` bucket using the Supabase admin JS client. The script:
  - Reads `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` from env.
  - Calls `supabase.storage.createBucket('brain-sources', { public: false, fileSizeLimit: 20971520 })` (20 MB cap).
  - Idempotent: swallows "bucket already exists" error.
  - Outputs success/skip/error to stdout.
  - Document in the migration file header: "Run `npx tsx scripts/bootstrap-brain-sources-bucket.ts` against each environment before the upload route goes live."

- [ ] **Step 4: Run tests** — `npx vitest run tests/rls/company-brain-p2.test.ts`. All 5 tests should pass. Also run the full foundation suite to check no regressions: `npx vitest run tests/rls/company-brain-foundation.test.ts`.

- [ ] **Commit:** `feat(brain): P2 migration — queue table, Foundation Minors, bucket bootstrap`

---

## Task 2: Extraction library — text parsing, redaction gate, LLM extraction

**Files:**
- Create: `apps/web/lib/brain/doc-extract.ts`
- Create: `apps/web/lib/brain/doc-extract.test.ts`

**Purpose:** The extraction worker that the upload route enqueues and the job runner executes. Contains all extraction logic: text parsing, redaction, LLM field extraction, `propose_memory_change` calls. No UI, no route — pure extraction.

Interfaces produced:
```ts
// apps/web/lib/brain/doc-extract.ts
export async function extractDocument(sourceId: string, accountId: string): Promise<void>
// Updates sources.redaction_status + source_extraction_jobs.status throughout.
// Calls propose_memory_change for each surviving field. Best-effort throughout.
```

Internal steps (matching spec §5):
1. Mark job `'processing'`, `sources.redaction_status` stays `'pending'` until redaction gate clears.
2. Download file from `brain-sources/{accountId}/{sourceId}/` via service-role Storage client.
3. **Type dispatch:**
   - `.pdf`: try `pdf-parse`; if selectable chars from first 3 pages < 100 → scanned path.
   - `.docx`: `mammoth` HTML→plain text strip.
   - `.txt`: `Buffer.toString('utf8')`.
   - image (`image/*`): vision path directly.
4. **Text-native path:** produce `rawText: string`, cap at 50 000 chars.
5. **Scanned/vision path:** rasterize first 10 pages (or pass image directly); pass image content blocks to Claude via `groveRouter.route({ task: 'doc_vision_extract' })`.
6. **Redaction gate:**
   - `applyBattery(rawText)` + `await new HeuristicNer().redact(rawText)`.
   - Zero rules hit → `redaction_status='clean'`.
   - Rules hit + scrubbable → replace spans with `[REDACTED]`, `redaction_status='redacted'`.
   - Quarantine-class rule → `redaction_status='quarantined'`; mark job `'error'`; no proposals; return early.
7. **LLM extraction:** `groveRouter.route({ task: 'doc_extract' })` → system prompt (cached, matches spec §5.5) → tolerant JSON parse → `extractJson()` (same pattern as `derive.ts`).
8. **Per-field loop:**
   - Skip if value empty after trim.
   - Clamp to 4 000 chars.
   - Re-check with `applyBattery` + `HeuristicNer` (defense-in-depth; drop if fails, log, don't surface).
   - Build `rationale` (≤ 200 chars).
   - Call service-role `propose_memory_change(accountId, fieldKey, 'replace', value, rationale, sourceId, 'doc_extract')`.
9. **Reference catch-all** (§5.6): if rawText > 500 chars AND (fieldCount < 1 OR (rawText > 5 000 chars AND fieldCount < 3)) → small second LLM call for a ≤ 800 char summary → propose `notes` field with `op='append'`.
10. Mark `source_extraction_jobs.status='done'`; mark `sources.redaction_status` to final value.
11. Any unhandled error: mark job `'error'`, `error_message` = error.message.

- [ ] **Step 1: Write failing tests** — `apps/web/lib/brain/doc-extract.test.ts`

  Mock strategy: mock `@nibbin/redaction`, `groveRouter`, `recordModelCall`, `anthropicGenerate`, Supabase service-role client, `pdf-parse`, `mammoth`. Tests call `extractDocument()` directly and assert on mock calls + (faked) DB state via the mock Supabase client.

  Tests:
  1. **Text-native PDF, clean**: mock `pdf-parse` returning 500 chars, `applyBattery` returning `{rulesHit:[]}`, `HeuristicNer.redact` returning `{rulesHit:[]}`, LLM returning `{"pricing":"$200","facts":"Photography studio"}`. Assert: `propose_memory_change` called twice (pricing + facts); `recordModelCall` called once with `task='doc_extract'`; job status updated to `'done'`; `redaction_status='clean'`.
  2. **Scanned PDF detection**: mock `pdf-parse` returning 30 chars (< 100 threshold); assert vision path taken (groveRouter called with `task='doc_vision_extract'`; text parse path NOT called for LLM extraction).
  3. **Redaction scrub**: `applyBattery` returns `{rulesHit:['phone']}` with a span to scrub; assert `redaction_status='redacted'`; proposed value contains `[REDACTED]` not raw phone.
  4. **Quarantine**: `applyBattery` returns a quarantine-class rule; assert `redaction_status='quarantined'`; `propose_memory_change` never called; job status `'error'`.
  5. **Per-field defense-in-depth re-check**: LLM returns a field value that itself trips `applyBattery` on the per-field re-check; assert that field is dropped (not proposed) while other clean fields ARE proposed.
  6. **Empty/whitespace field dropped**: LLM returns `{"pricing":"  "}` → no proposal for pricing.
  7. **Reference catch-all triggers**: rawText = 6 000 chars, LLM returns only 1 field key; assert a second LLM call is made (summary) and a `notes` append proposal is created.
  8. **Reference catch-all does NOT trigger for short docs**: rawText = 300 chars, 0 fields → no second LLM call (rawText ≤ 500 threshold).
  9. **10-page scanned cap**: mock a PDF with 15 pages → only first 10 rasterized; `sources.origin` set with `truncated_pages: true`.
  10. **.docx parsed via mammoth**: mock mammoth to return `{value:'Hello World'}` → `rawText='Hello World'`.
  11. **rawText capped at 50 000 chars**: mock parser returning 60 000 chars → LLM receives ≤ 50 000 chars.
  12. **Error handling**: LLM throws → job marked `'error'`; `recordModelCall` called with `outcome='error'`; no proposals; no crash.

  Run: `npx vitest run apps/web/lib/brain/doc-extract.test.ts` — expect failures.

- [ ] **Step 2: Install dependencies** — `pdf-parse`, `mammoth` (check `package.json` first; add only if missing):
  ```bash
  cd /c/nib-p2 && npm install --workspace=apps/web pdf-parse mammoth
  ```
  Also verify `@types/pdf-parse` or equivalent. Use `import pdfParse from 'pdf-parse'` (CJS default).

- [ ] **Step 3: Write `apps/web/lib/brain/doc-extract.ts`** implementing `extractDocument()` per the spec above. Key details:
  - `import 'server-only';` at top.
  - Use `serviceClient()` from `../supabase/service` for all DB + Storage calls.
  - `const ner = new HeuristicNer();` (one instance, stateless).
  - `extractJson()` copied from `derive.ts` (or import if exported).
  - `buildRationale(filename: string, reason: string): string` — `"From {filename} — {reason}".slice(0, 200)`.
  - Vision call: use `anthropicGenerate()` with image content blocks matching the spec §5.2 prompt. Record via `recordModelCall` with `task='doc_vision_extract'`.
  - LLM extraction call: use `anthropicGenerate()` with the §5.5 system prompt (cached). Record via `recordModelCall` with `task='doc_extract'`.
  - `propose_memory_change` is called via the Supabase service-role RPC: `serviceClient().rpc('propose_memory_change', {...})`.
  - Update `sources.redaction_status` via `serviceClient().from('sources').update({redaction_status: ...}).eq('id', sourceId)`.
  - Update job status via `serviceClient().from('source_extraction_jobs').update({status: ..., completed_at: new Date().toISOString()}).eq('source_id', sourceId).eq('account_id', accountId)`.

- [ ] **Step 4: Run tests** — `npx vitest run apps/web/lib/brain/doc-extract.test.ts`. All 12 tests green.

- [ ] **Commit:** `feat(brain): doc extraction worker — text/vision paths, redaction gate, LLM field mapping`

---

## Task 3: Upload route + status poll route

**Files:**
- Create: `apps/web/app/api/brain/documents/upload/route.ts`
- Create: `apps/web/app/api/brain/sources/[sourceId]/status/route.ts`
- Create: `apps/web/lib/brain/upload.test.ts`

**Purpose:** The two API surface routes. Upload returns 202 + `{sourceId}` immediately after Storage PUT + job enqueue. Status poll returns `{status, proposalCount}`.

- [ ] **Step 1: Write failing tests** — `apps/web/lib/brain/upload.test.ts`

  Use `vitest` + mock `appSession`, `serviceClient`, `extractDocument`. Test the upload route handler by importing the `POST` handler directly and constructing a `NextRequest`.

  Tests:
  1. **Valid PDF upload → 202 + sourceId**: construct a mock `Request` with a multipart body (`application/pdf`, ≤ 20 MB); assert response is 202, body has `sourceId` (UUID), Storage PUT called with correct path `{accountId}/{sourceId}/{sanitized_filename}`, `sources` insert called with `kind='document'`, `source_tier=60`, `redaction_status='pending'`, `source_extraction_jobs` insert called.
  2. **Invalid MIME type → 422**: `.doc` file → `{error: 'doc_not_supported', message: 'Please save the file as .docx and try again.'}`.
  3. **Non-`.doc` invalid type (e.g. `.xlsx`) → 422**: `{error: 'unsupported_type', message: 'Nibbin can read PDFs, Word docs (.docx), plain text, and images. Try a different file.'}`.
  4. **Oversize file → 422**: `{error: 'file_too_large', message: 'That file is X MB — the limit is 20 MB. Try a smaller file or export a portion.'}`.
  5. **Unauthenticated → 401**: `appSession` throws → handler returns 401.
  6. **Status poll — processing state**: mock `sources.redaction_status='processing'`, `proposals count=0` → `{status: 'processing', proposalCount: 0}`.
  7. **Status poll — done state**: `redaction_status='clean'`, `proposals count=3` → `{status: 'done', proposalCount: 3}`.
  8. **Status poll — source not found or wrong account → 404**.
  9. **Status poll — quarantined → `{status: 'error', proposalCount: 0}`**.
  10. **Filename sanitization**: a filename with `../` or null bytes → sanitized path contains no directory separators; Storage PUT still called with a clean path.

  Run: `npx vitest run apps/web/lib/brain/upload.test.ts` — expect failures.

- [ ] **Step 2: Write `apps/web/app/api/brain/documents/upload/route.ts`**

  ```ts
  import 'server-only';
  export const dynamic = 'force-dynamic';
  export const runtime = 'nodejs'; // required for multipart + pdf-parse

  export async function POST(req: Request): Promise<Response>
  ```

  Logic:
  1. `const { accountId } = await appSession()` — catches → 401.
  2. Parse multipart body; extract `file: File`.
  3. Validate MIME (check against allowlist; `.doc` → 422 with `doc_not_supported`; other wrong types → 422 with `unsupported_type`).
  4. Validate size (file.size > 20 * 1024 * 1024 → 422 with `file_too_large`, include MB count).
  5. `const sourceId = crypto.randomUUID()`.
  6. `const sanitizedFilename = file.name.replace(/[/\\.\x00]/g, '_')` (strip `/`, `\`, null bytes, leading dots).
  7. Storage PUT: `serviceClient().storage.from('brain-sources').upload('{accountId}/{sourceId}/{sanitizedFilename}', buffer)`.
  8. Insert `sources` row: `kind='document'`, `title=file.name.slice(0,300)`, `storage_path=...`, `origin={filename: file.name, mime: file.type, size_bytes: file.size}`, `source_tier=60`, `redaction_status='pending'`.
  9. Insert `source_extraction_jobs` row: `account_id=accountId`, `source_id=sourceId`, `status='pending'`.
  10. Fire and NOT await: `void extractDocument(sourceId, accountId)` — the job row tracks status; Vercel will not kill the in-process call until the function response is sent, but the extraction continues in the background event loop. (If Vercel's behavior proves problematic in practice, this is where a proper job queue or Edge Function trigger replaces the fire-and-forget.)
  11. Return `Response.json({ sourceId }, { status: 202 })`.

- [ ] **Step 3: Write `apps/web/app/api/brain/sources/[sourceId]/status/route.ts`**

  ```ts
  export async function GET(req: Request, { params }: { params: { sourceId: string } }): Promise<Response>
  ```

  Logic:
  1. `appSession()` → accountId.
  2. Fetch `sources` row scoped to `accountId` and `params.sourceId`.
  3. If not found → 404.
  4. Map `redaction_status`: `'pending'|'processing'` → `status='processing'`; `'clean'|'redacted'` → `status='done'`; `'quarantined'` → `status='error'`.
  5. Count `proposals` where `source_id=sourceId` and `origin='doc_extract'`.
  6. Return `{ status, proposalCount }`.

- [ ] **Step 4: Run tests** — `npx vitest run apps/web/lib/brain/upload.test.ts`. All 10 green. Also run typecheck: `npm run typecheck --workspace=apps/web`.

- [ ] **Commit:** `feat(brain): upload route (POST /api/brain/documents/upload) + status poll`

---

## Task 4: Upload UI — drag-and-drop card on the Memory page

**Files:**
- Create: `apps/web/components/brain/DocUploadCard.tsx`
- Modify: `apps/web/app/app/memory/page.tsx`
- Create: `apps/web/components/brain/DocUploadCard.test.tsx`

**Purpose:** The upload entry point and progress UI. A drag-and-drop zone card rendered inside the Memory page (initial position: below the existing form, until P1 introduces the Sources tab structure). Handles client-side inline validation, upload progress, status polling, and completion/error states.

- [ ] **Step 1: Write failing tests** — `apps/web/components/brain/DocUploadCard.test.tsx`

  Use `@testing-library/react` + `vitest`. Mock `fetch` for the upload route and status poll.

  Tests:
  1. **Renders drop zone and "Choose file" button** in idle state.
  2. **Invalid type rejected inline**: simulate dropping a `.doc` file → error message "Please save the file as .docx and try again." displayed; no fetch call made.
  3. **Invalid type (non-doc) rejected inline**: `.xlsx` file → error "Nibbin can read PDFs, Word docs (.docx), plain text, and images."
  4. **Oversize file rejected inline**: 25 MB mock file → error message including "20 MB".
  5. **Valid file triggers upload**: mock `POST /api/brain/documents/upload` returns `{sourceId: 'abc'}` (202); assert fetch called with correct URL and file; progress state "Uploading…" shown during call.
  6. **Status poll fires after upload**: mock `GET /api/brain/sources/abc/status` → first call returns `{status:'processing', proposalCount:0}` → "Reading your doc…" displayed; second call returns `{status:'done', proposalCount:2}` → "Found 2 things to check" toast/message shown.
  7. **Timeout after 90s**: mock status always returns `'processing'`; after 45 polls (simulate with vi.useFakeTimers) → "This is taking longer than expected" message.
  8. **Upload error → inline error state**: mock `POST` returns 422 → friendly error shown, card not stuck in uploading state.
  9. **`.docx` accepted**: simulate `.docx` drop → no inline rejection; upload fetch called.
  10. **Accessibility**: drop zone has `role="region"` or `aria-label`; file input has a label.

  Run: `npx vitest run apps/web/components/brain/DocUploadCard.test.tsx` — expect failures.

- [ ] **Step 2: Write `apps/web/components/brain/DocUploadCard.tsx`**

  A `'use client'` component. State machine: `idle | uploading | processing | done | error | timedout`. Key behaviors:
  - `onDrop` / `onChange` handler: inline validation first (type allowlist, 20 MB cap, `.doc` special case) → if invalid, set `error` state with appropriate message, no fetch.
  - Upload: `fetch('/api/brain/documents/upload', { method: 'POST', body: formData })` → on 202, start polling.
  - Polling: `setInterval` every 2 000 ms; clear after `done`/`error`/45 polls (90 s). On `done`: show `"Found {N} things to check — review below."`.
  - Progress copy: `uploading` → "Uploading…"; `processing` + redaction phase → "Reading your doc…"; LLM phase → "Finding things to remember…" (approximated by time, not real signal from the worker).
  - Uses Tailwind + existing Nibbin component conventions (no new primitives; match existing card/button styles from the UI kit).

- [ ] **Step 3: Wire into Memory page** — `apps/web/app/app/memory/page.tsx`

  Add `<DocUploadCard />` below the `<form>` and above the footer (or below the empty-state block). Wrap in a `<Suspense>` if needed (it's a client component in a server page — just import and render; client boundary is in the component itself). No structural page changes needed beyond adding the import and the JSX element.

- [ ] **Step 4: Run tests** — `npx vitest run apps/web/components/brain/DocUploadCard.test.tsx`. All 10 green. Then `npm run lint --workspace=apps/web` and `npm run typecheck --workspace=apps/web`.

- [ ] **Commit:** `feat(brain): DocUploadCard — drag-and-drop upload entry point on Memory page`

---

## Task 5: RLS tests — Storage bucket scoping + cross-account isolation

**Files:**
- Extend: `tests/rls/company-brain-p2.test.ts`

**Purpose:** Verify the Storage-path scoping invariants that cannot be unit-tested (they require the real DB + the real RLS eval path). Since the `brain-sources` Storage bucket is a Supabase-managed resource (not pure Postgres), these tests verify the Postgres-layer invariants: `sources` row isolation across accounts, `source_extraction_jobs` isolation, and `propose_memory_change` blocking proposals from quarantined sources.

- [ ] **Step 1: Add tests to `tests/rls/company-brain-p2.test.ts`**

  Add a new `describe` block: `'P2 — cross-account isolation + quarantine gate'`

  Tests:
  1. **Cross-account `sources` isolation**: service inserts a `sources` row for account A; account B cannot see it.
  2. **Cross-account `proposals` isolation**: service inserts a `proposals` row for account A via `propose_memory_change`; account B cannot see it.
  3. **`propose_memory_change` blocks quarantined source**: service inserts a `sources` row with `redaction_status='quarantined'`; then `propose_memory_change` with that `source_id` → raises `'quarantined source'`.
  4. **`source_extraction_jobs` cross-account**: service inserts a job for account A; account B sees 0 rows.
  5. **Anon cannot read `sources`**: direct `select` → permission denied.
  6. **Anon cannot read `source_extraction_jobs`**: direct `select` → permission denied.

- [ ] **Step 2: Run** — `npx vitest run tests/rls/company-brain-p2.test.ts`. All tests (from Task 1 + Task 5) green.

- [ ] **Commit:** `test(brain): P2 cross-account isolation + quarantine gate RLS tests`

---

## Task 6: Integration test — end-to-end propose → approve

**Files:**
- Extend: `tests/rls/company-brain-p2.test.ts`

**Purpose:** Verify the full doc-extract → proposal → decide → grove_memory write path using the RLS harness (no mocks; real DB). This proves the seam end-to-end in the same style as the F2 `decide_memory_proposal` tests.

- [ ] **Step 1: Add a `describe` block** — `'P2 — end-to-end doc_extract proposal → approve'`

  Tests:
  1. **doc_extract proposal → approve → curated value written + field_evidence linked + audit logged**: service inserts a `sources` row (`kind='document'`, `redaction_status='clean'`), calls `propose_memory_change($acct, 'pricing', 'replace', '$250/hr', 'From rate.pdf — contains your pricing', $srcId, 'doc_extract')`, then `decide_memory_proposal($pid, 'approved')` as the member → `grove_memory.sections->>'pricing'` = `'$250/hr'`; `field_evidence` row exists with `relationship='supports'`; `audit_log` has `action='memory.ratified'`; proposal `status='approved'`.
  2. **doc_extract proposal → reject → curated unchanged**: same setup, reject → `grove_memory` has no `pricing` section; proposal `status='rejected'`.
  3. **Multiple field proposals from one source**: service makes 3 proposals for `facts`, `pricing`, `policies` backed by the same `source_id`; approve all three → `grove_memory` has all 3 fields; `field_evidence` has 3 rows for the same source.
  4. **Regression: existing F1/F2 `manual` origin proposals still work**: service proposes with `origin='manual'` (no source_id) → approve → curated written; no error from the P2 migration changes.

- [ ] **Step 2: Run** — `npx vitest run tests/rls/company-brain-p2.test.ts`. All tests green. Then: `npx vitest run tests/rls/company-brain-foundation.test.ts` (regression).

- [ ] **Commit:** `test(brain): P2 end-to-end integration tests (doc_extract → approve → grove_memory)`

---

## Task 7: Typecheck, lint, and build validation

**Files:** none (validation only).

- [ ] `npm run typecheck --workspace=apps/web` — must be clean.
- [ ] `npm run lint --workspace=apps/web` — must be clean.
- [ ] `npm run build --workspace=apps/web` — must succeed with no new errors. (Confirm `pdf-parse` and `mammoth` are in `transpilePackages` in `next.config.ts` if they are CJS-only; add them if the build fails with "require is not defined" or similar.)
- [ ] Run full vitest suite: `npx vitest run` — no regressions.
- [ ] **Commit:** `chore: typecheck + lint + build green (P2 doc ingest)`

---

## Task 8: Smoke test (manual / local verification)

**Purpose:** Verify the end-to-end flow works in the local dev environment before migration is applied to staging/prod. This is an exploratory check, not an automated test.

- [ ] Start the dev server: `npm run dev --workspace=apps/web`.
- [ ] Run the bucket bootstrap script against the local Supabase: `npx tsx scripts/bootstrap-brain-sources-bucket.ts` (with `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` pointing at local).
- [ ] Apply the P2 migration locally: `supabase db reset` (or `supabase migration up` if reset is too destructive given the existing F1/F2 data).
- [ ] Navigate to `/app/memory`, drop a small PDF rate sheet.
- [ ] Observe: upload completes, status poll cycles through "Uploading…" → "Reading your doc…" → "Found N things to check".
- [ ] Inspect Supabase Studio: `sources` row exists with `redaction_status='clean'` (or `'redacted'`); `proposals` rows exist with `origin='doc_extract'`; `source_extraction_jobs` row has `status='done'`.
- [ ] Try approving one proposal (using direct RPC in Studio if P1 review UI isn't yet merged): verify `grove_memory` updated, `grove_memory_history` row appended, `audit_log` row written.
- [ ] Try dropping a `.doc` file → see "Please save the file as .docx and try again." inline error.
- [ ] Try dropping a file > 20 MB → see oversize error.

---

## Task 9: Apply migration to dev, staging, and prod

- [ ] **Dev:** `supabase db push` (or `supabase migration up`) targeting the dev project. Verify `source_extraction_jobs` table exists; `proposals_value_nonempty` CHECK exists; `decide_memory_proposal` function updated.
- [ ] **Run bucket bootstrap against dev:** `SUPABASE_URL=<dev-url> SUPABASE_SERVICE_ROLE_KEY=<dev-key> npx tsx scripts/bootstrap-brain-sources-bucket.ts`. Verify `brain-sources` bucket appears in Supabase Studio → Storage.
- [ ] **Staging:** same two steps.
- [ ] **Prod:** same two steps. Confirm in Studio.
- [ ] Log migration in the project migration tracker (per convention from prior migrations).
- [ ] **Commit:** `chore: P2 migration applied to dev/staging/prod + bucket bootstrapped`

---

## Task 10: Adversarial gate

**Purpose:** P2 introduces a new data path (document upload → Storage → LLM extraction → proposals) and a new curated-write producer (`doc_extract` origin). The gate reviews security invariants before the PR is opened.

Gate applies the standard 4-reviewer model (red-team, claims-auditor, logic-skeptic, cost-auditor) per `docs/gates/` convention. Write the gate report to `docs/gates/2026-06-23-document-ingestion-gate.md`.

**Mandatory review surface for each reviewer:**

**Red-team (security / adversarial):**
- Storage path traversal: can a malicious filename escape `{accountId}/{sourceId}/` prefix? Verify `sanitizedFilename` strips all dangerous chars.
- Cross-account Storage read: can account B construct a URL to account A's file? (Private bucket + RLS; no public URLs generated.)
- MIME spoofing: can a malicious PDF that claims to be `text/plain` reach the wrong extraction path? (Server reads magic bytes via `pdf-parse` result, not only client MIME.)
- Injection via document content: can a crafted PDF inject instructions into the LLM extraction system prompt? (Prompt instructs model that content is data; review the prompt.)
- `propose_memory_change` called with attacker-controlled `accountId`? (Route resolves `accountId` from session, never from request body.)
- Can a quarantined source back a proposal? (Both the RPC guard and the app-layer check prevent this; RLS test covers it.)
- Storage PUT with service-role: is `accountId` always derived from the session (not a client-supplied parameter)?

**Claims-auditor:**
- Verify `extractDocument` actually calls `applyBattery` + `HeuristicNer` on `rawText` before any proposal, not only before the LLM call.
- Verify the per-field re-check (`applyBattery` + `HeuristicNer`) is in the code, not only in the spec.
- Verify `recordModelCall` is called on both the `doc_extract` and `doc_vision_extract` paths, including the error path.
- Verify `redaction_status='quarantined'` results in zero proposals (code path, not just spec claim).
- Verify `.doc` files are rejected before the Storage PUT (not after).

**Logic-skeptic:**
- Fire-and-forget extraction: what happens if the Next.js serverless function is killed before `extractDocument` completes? The `source_extraction_jobs` row remains `'pending'`; the status poll returns `'processing'` indefinitely. Is the user told what to try? (Should be: the 90-second poll timeout shows "This is taking longer than expected — check back in a moment.")
- Scanned PDF detection threshold (< 100 chars from first 3 pages): can a legitimate text PDF with very little text on the first 3 pages (e.g., a cover page with only a logo and title) be misclassified as scanned? Review threshold and consider logging the raw char count to `sources.origin` for debugging.
- `rationale` truncated to 200 chars: is the truncation applied before calling `propose_memory_change`, or does the RPC reject at 2 000 chars? (The plan truncates at 200 app-side; the column allows 2 000. Both are fine; just verify the app-side truncation is in the code.)
- Append overflow guard: is the guard applied to all three field branches (`sections[key]`, `hard_rules`, `notes`) or only `sections`? (Must be all three — verify each branch in `decide_memory_proposal`.)

**Cost-auditor:**
- Vision model cost: is the vision path gated ONLY on scanned PDFs (< 100 selectable chars) and image files? Or could a text PDF accidentally trigger vision?
- Second LLM call (reference catch-all summary): is it behind the rawText > 500 char AND field-count < threshold guard? Or could it fire for every document?
- `recordModelCall` tokens: are both the extraction call and the summary call logged separately? (Each has its own `recordModelCall`.)
- 10-page scanned cap: is the cap enforced before rasterization (i.e., does the code stop rasterizing after page 10, or does it rasterize all pages and then slice)?

- [ ] Write the gate report at `docs/gates/2026-06-23-document-ingestion-gate.md` following the standard format: P0/P1/P2/P3 findings, resolution status, PASS/FAIL verdict.
- [ ] Resolve any P0 or P1 findings before opening the PR.
- [ ] **Commit:** `docs: adversarial gate report — P2 document ingestion`

---

## Task 11: PR

- [ ] `npm run typecheck --workspace=apps/web` — clean.
- [ ] `npm run lint --workspace=apps/web` — clean.
- [ ] `npm run build --workspace=apps/web` — succeeds.
- [ ] `npx vitest run` — no regressions (full suite).
- [ ] Open PR: `gh pr create --base main --title "feat(brain): P2 document ingestion"` with body listing:
  - Migration `20260622150000_company_brain_p2_doc_ingest.sql` applied to dev/staging/prod.
  - `brain-sources` Storage bucket bootstrapped on all 3 environments.
  - Two Foundation Minors closed (`proposals_value_nonempty` CHECK + append-overflow guard).
  - Upload route + status poll route.
  - Extraction worker: text-native (PDF/DOCX/TXT) + vision (scanned PDF/image) paths.
  - Redaction gate mandatory on all extracted text.
  - DocUploadCard on Memory page.
  - 4-reviewer adversarial gate PASS (link to gate report).
  - Test counts: RLS suite + vitest unit suite.

---

## Risk register

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Vercel function killed before `extractDocument` completes (fire-and-forget) | Medium | `source_extraction_jobs` table tracks status; 90s poll timeout shows user a "check back" message. If it proves problematic, replace void call with a Supabase Edge Function webhook trigger (job row insert → trigger → Edge Function → worker). The queue table is already in place for this upgrade. |
| `pdf-parse` / `mammoth` CJS compatibility in Next.js App Router (Edge runtime) | Medium | Route is explicitly set to `runtime = 'nodejs'`. Add to `transpilePackages` in `next.config.ts` if needed. Verify in Task 7 build step. |
| Vision model cost spike if scanned-PDF detection threshold miscalibrated | Low-Medium | Threshold is < 100 chars from first 3 pages (conservative). Log raw char count to `sources.origin` for observability. Gate cost-auditor reviews this. |
| Scanned PDF rasterization library not available in serverless context | Low | Use `pdf-to-img` (pure JS/WASM) or `pdfjs-dist` for rasterization; avoid native binaries. Verify import works in a Next.js `nodejs` runtime function. If unavailable, fall back to extracting text-only from all pages and noting "Unable to read images in this scan." |
| `.doc` files are common for some user segments | Low | Rejected with a "save as .docx" nudge. Revisit after launch if user feedback indicates this is a frequent blocker. |

## Forks resolved (design decision log)

- **Queue table vs fire-and-forget**: chose `source_extraction_jobs` queue table (deferred in spec §5.4 as a "fork"). This avoids a race condition where the function times out with `redaction_status` stuck at `'pending'`.
- **`source_tier=60` default**: all uploads default to 60 (option a from spec §12.2); user can override later via P1 source-labelling UI.
- **10-page scanned cap**: kept at 10 pages; log `truncated_pages: true` in `sources.origin` (option a from spec §12.3). The rationale string will say "First 10 pages read."
- **`.docx` only**: `.doc` rejected with a "save as .docx" nudge (option a from spec §12.4). No LibreOffice dependency.
