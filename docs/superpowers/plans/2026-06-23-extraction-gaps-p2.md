# Extraction Gaps: pptx/xlsx/svg + reaper + append-only + live test (P2) — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Close the remaining extraction gaps — parse pptx/xlsx/svg, make extraction proposals non-destructive (append-only), add stuck-job recovery, and make the vision path verifiable against the real API.

**Architecture:** Office files are zip-of-XML; unzip with `fflate` (tiny, zero-dep) and pull text from the relevant XML parts. Extraction-derived proposals become append-only so an upload can never propose wiping a curated field. A cron reaper (mirroring `cron/plan-run-reaper`) re-drives jobs stuck in `processing`. An opt-in live smoke test proves the real Anthropic API accepts both image and document blocks.

**Tech Stack:** Next.js 15 (Node runtime), TypeScript, `fflate`, `@nibbin/router`, vitest (mocked).

## Global Constraints
- **fflate only** for unzip (no SheetJS/jszip). Extract TEXT only — never raw bytes into proposals (derived-not-raw preserved).
- **Fail-closed**: any extractor throw → `extraction_state='failed'`, zero proposals.
- **Store-never-drop** stays: a file we still can't read → `unsupported`, retained.
- **Extraction proposals are append-only** (`p_op='append'`), for BOTH the text path and the vision path — never `replace`.
- `propose_memory_change` arg names unchanged (7-arg this branch; P6 merge adds `p_stakes`).
- The reaper route is service-role + `isAuthorizedCronRequest` only (mirror `plan-run-reaper`).
- Tests mock Supabase + fflate inputs + the Anthropic client; the live smoke test is opt-in (env-gated) and skipped in CI.

---

### Task 1: pptx text extractor
**Files:** add `fflate` to `apps/web/package.json`; Create `apps/web/lib/brain/office-extract.ts`; Modify `apps/web/lib/brain/doc-extract.ts` (`classifyExtractor` + dispatch); Test: `office-extract.test.ts`, extend `doc-extract.test.ts`.
**Interfaces:** `extractPptxText(buffer: Buffer): Promise<string>` — unzip, read every `ppt/slides/slide*.xml`, concatenate the text inside `<a:t>…</a:t>` runs (in slide order), cap total length (reuse the existing text cap constant from doc-extract). `classifyExtractor` returns `'pptx'` for the pptx mime/`.pptx`.
- [ ] Step 1: failing tests — a crafted minimal pptx (zip with one slide XML containing `<a:t>Hello</a:t><a:t>World</a:t>`) extracts `"Hello World"`; a pptx with no slides → `''`; `classifyExtractor('application/vnd.openxmlformats-officedocument.presentationml.presentation','d.pptx')==='pptx'`.
- [ ] Step 2: FAIL. Step 3: implement with `unzipSync`/`strFromU8` from fflate; in `doc-extract`, route `pptx` → extract → (if non-empty) redaction battery → append-only proposals → `extracted`, else `unsupported`. Step 4: PASS. Step 5: commit.

### Task 2: xlsx text extractor
**Files:** Modify `office-extract.ts`, `doc-extract.ts`; Test: same.
**Interfaces:** `extractXlsxText(buffer: Buffer): Promise<string>` — unzip; build the shared-strings array from `xl/sharedStrings.xml` (`<t>` values, in order); for each `xl/worksheets/sheet*.xml`, resolve cell values (inline `<is><t>` and shared-string refs `<c t="s"><v>idx</v>`) into tab/newline-joined text; cap length. `classifyExtractor` returns `'xlsx'` for the xlsx mime/`.xlsx`.
- [ ] Failing tests — a crafted xlsx (sharedStrings `["Price","100"]`, a sheet referencing them) extracts text containing `Price` and `100`; empty workbook → `''`; classify maps correctly. → FAIL → implement + wire dispatch (append-only proposals) → PASS → commit.

### Task 3: svg text extractor
**Files:** Modify `office-extract.ts` (or a small `svg-extract.ts`), `doc-extract.ts`; Test: same.
**Interfaces:** `extractSvgText(buffer: Buffer): string` — parse text inside `<text>`, `<title>`, `<desc>` elements from the SVG XML; if none found → `''` (caller marks `unsupported`). `classifyExtractor` returns `'svg'` for `image/svg+xml`/`.svg` (NO longer `phase2`).
- [ ] Failing tests — an svg with `<title>Acme</title><text>Logo</text>` → contains `Acme` + `Logo`; a text-less svg → `''` → `unsupported`; classify maps `image/svg+xml`→`'svg'`. → FAIL → implement → PASS → commit.

### Task 4: extraction proposals are append-only
**Files:** Modify `doc-extract.ts` (text path) + `vision-extract.ts` (vision path); Test: extend both test files.
- [ ] Failing tests — assert the `propose_memory_change` call from BOTH the text extractor and the vision extractor passes `p_op: 'append'` (not `'replace'`) for every field. → FAIL → change the op to `'append'` at every extractor propose site (keep the `notes` field as append too) → PASS → commit. (Rationale comment: extraction is additive; the owner approves and can prune — an upload never proposes destroying curated content.)

### Task 5: stuck-extraction reaper
**Files:** Create migration `supabase/migrations/20260623140000_extraction_reaper.sql`; Modify `doc-extract.ts` (worker stamps `started_at`/`attempts` when it claims a job); Create `apps/web/app/api/cron/source-extraction-reaper/route.ts`; register the cron (find the existing cron registration — root `vercel.json` or wherever `plan-run-reaper` is scheduled — and add an entry; if you cannot locate it, leave a clear `// OPS:` note + document in the report). Test: `tests/rls/extraction-reaper.rpc.test.ts`, route test.
**Interfaces:**
```sql
alter table public.source_extraction_jobs
  add column started_at timestamptz,
  add column attempts   integer not null default 0;
-- reap_stale_extractions(p_stale_minutes int default 10, p_max_attempts int default 3) returns integer
-- service-role only; resets jobs status='processing' AND started_at < now()-interval:
--   attempts < max → status='pending' (re-enqueue); else → status='error' + sources.extraction_state='failed'.
-- returns count reaped.
```
- [ ] Step 1: failing RLS tests (follow `tests/rls/section-meta.rpc.test.ts` harness style) — a job `processing` with `started_at` 20 min ago + attempts 1 → reset to `pending`; same but attempts ≥3 → `error` + its source `extraction_state='failed'`; a fresh `processing` job (started_at now) is untouched; a `done` job untouched. Step 2: FAIL. Step 3: write the migration RPC (`security definer`, `set search_path=''`, service-role grant per the other reaper RPCs — check `reap_stale_plan_runs` grants and mirror), and make the worker set `started_at=now(), attempts=attempts+1` on claim. Step 4: PASS. Step 5: commit.
- [ ] Step 6: route — mirror `apps/web/app/api/cron/plan-run-reaper/route.ts` exactly (GET, `isAuthorizedCronRequest`, `serviceClient().rpc('reap_stale_extractions', {})`, log count). Route test asserts 401 without cron auth, calls the RPC with auth. Commit.

### Task 6: opt-in live vision smoke test
**Files:** Create `scripts/live-vision-smoke.ts`; doc note in the report.
**Interfaces:** a standalone script that, ONLY when `process.env.RUN_LIVE_VISION==='1'` and an API key is present, sends (a) a tiny 1×1 PNG as an `image` block and (b) a tiny one-page PDF as a `document` block to the real router `generate`, and asserts neither returns a 400/AnthropicApiError (proving both block types are accepted). Prints PASS/FAIL. It is NOT part of the vitest suite (no CI run; documented manual command). 
- [ ] Create the script + a `// usage:` header (`RUN_LIVE_VISION=1 ANTHROPIC_API_KEY=… npx tsx scripts/live-vision-smoke.ts`). Add a vitest file `scripts/live-vision-smoke.test.ts` that `describe.skipIf(process.env.RUN_LIVE_VISION!=='1')` so CI skips it. Commit.

### Task 7: full-suite green
- [ ] `npm run lint`, `npm run typecheck`, router + brain suites green (except the 2 known stale `.next/types` route errors). Confirm text-only router back-compat still holds and no `console.error(\`…${x}\`, y)` patterns (semgrep). Verify each "pre-existing" red against `git diff origin/main...HEAD`. Commit `chore: green (extraction gaps)`.

## Merge notes
- New migration `20260623140000` → 3 DBs at merge. Cron `source-extraction-reaper` needs schedule registration + the cron secret (ops).
- Append-only op change is behavioral — note in the PR.
