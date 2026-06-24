# Adversarial Gate — Extraction Gaps P2 (pptx/xlsx/svg + reaper + append-only + live test)

**Branch:** `feature/company-brain-docs-ingest`
**Worktree:** C:\nib-p2
**Date:** 2026-06-23
**Reviewer:** whole-branch adversarial (final gate)

**Verdict: CHANGES-REQUIRED**
**Counts:** Critical 1 · Important 2 · Minor 4

---

## 1. Red-team / security (UNTRUSTED FILE PARSING)

### [CRITICAL] No decompression bound on `unzipSync` — zip-bomb DoS
**File:** `apps/web/lib/brain/office-extract.ts:44` (pptx), `:203` (xlsx)

`extractPptxText`/`extractXlsxText` call `unzipSync(new Uint8Array(buffer))`, which eagerly inflates **every** entry of an attacker-controlled archive into memory at once. fflate's `unzipSync` has no `maxOutputSize`/entry-count option — it returns a map of all fully-inflated `Uint8Array`s.

The only guard upstream is the **20 MB cap on the _compressed_ upload** (`apps/web/app/api/brain/documents/upload/route.ts:23`, `MAX_SIZE_BYTES = 20*1024*1024`). DEFLATE routinely achieves 1000:1+ on crafted input, so a ~1–20 MB `.pptx`/`.xlsx` (a valid zip) can decompress to multiple gigabytes. `extractDocument` runs fire-and-forget on the Node serverless runtime; this OOM-kills the function (and any co-located work) — a real, trivially-reachable DoS, and the headline risk for this exact feature (users upload arbitrary office files).

**Why real:** No bound exists anywhere between "20 MB compressed accepted" and "inflate everything into RAM." The RAW_TEXT_CAP (50k) is applied only *after* full inflation, so it does not help.
**Fix:** Before/with unzip, bound decompressed output. Options, cheapest first: (a) cap total inflated bytes and entry count — iterate entries and abort once a running sum exceeds e.g. 200 MB or N entries; fflate exposes per-entry sizes via the streaming `Unzip`/`unzip` API (or check `data.length` per entry and short-circuit the slide/sheet loops, throwing → fail-closed). (b) Use `fflate`'s streaming `Unzip` with a per-chunk accumulator and abort. Throw on breach so the existing outer catch writes `extraction_state='failed'`, zero proposals. Add a unit test with a high-ratio zip fixture asserting it fails closed rather than allocating.

### [OK] No XXE / billion-laughs / entity-expansion exposure
All office/svg parsing is **regex/string-based** (`extractAtTextRuns`, `parseSharedStrings`, `extractSheetText`, `extractSvgText`) — there is no real XML parser, no DOCTYPE/ENTITY resolution. `&lt;`-style entities are left literal (not expanded), so the billion-laughs/XXE class does not apply. Good.

### [OK] SVG `<script>` / markup does not leak into proposals
`extractSvgText` only captures `<text|title|desc>` element bodies and strips nested tags via `replace(/<[^>]*>/g, ' ')` (office-extract.ts:271,278). A `<script>` outside those three elements is never captured; one nested inside is tag-stripped. Extracted text then flows through the same `runRedactionGate` + `perFieldRedactionCheck` battery and only into the append-only proposal queue — never a direct write. Derived-not-raw preserved.

### [OK] Fail-closed on parser error confirmed
Every office/svg extractor throws on corrupt input; `extractDocument`'s outer `try/catch` (doc-extract.ts:907-913) writes `extraction_state='failed'` + job `error`, zero proposals. Empty/no-text → `unsupported` (store-never-drop), not a throw. Verified by tests T5-2c, T2-3, T3-2/T3-4.

---

## 2. Claims-auditor

### [OK] All propose sites are `p_op:'append'` with exact arg names
- Text/docx/pdf-textnative/pptx/xlsx/svg all funnel through the single per-field loop — `const op = 'append'` (doc-extract.ts:861), 7 args (`p_account, p_field_key, p_op, p_value, p_rationale, p_source_id, p_origin`).
- Catch-all summary: `p_op:'append'` (doc-extract.ts:893).
- Vision per-field: `const op = 'append'` (vision-extract.ts:328).
Arg names match the migration signature; locked by `doc-extract.argnames.test.ts`. No `'replace'` remains in production paths.

### [OK] Migration idempotent + grants mirror `reap_stale_plan_runs`
`20260623140000`: `add column if not exists` for both `sources.extraction_state` (def + CHECK matching the values the worker writes) and `source_extraction_jobs.attempts`; `create or replace function`; revoke public/anon/authenticated + grant service_role — identical posture to `reap_stale_plan_runs` (20260619230000). Idempotent.

### [OK] Cron route enforces auth; RPC is service-role-only
Route returns 401 unless `isAuthorizedCronRequest` passes (route.ts:467); helper is constant-time and fail-closed when `CRON_SECRET` unset (cron-auth.ts). RPC grant is service_role only. Tests assert 401 (no header / wrong secret / unset secret) and anon/authenticated `permission denied`. Real, non-tautological tests.

### [Minor] `attempts` read-then-write increment is racy in principle, fine in practice
**File:** `apps/web/lib/brain/doc-extract.ts:271-289`
The increment does `select attempts` then `update attempts = jobRow.attempts + 1` (PostgREST has no server-side `attempts + 1`). The "service_role is sole writer, unique per (source_id, account_id)" claim holds *today*, but two concurrent `extractDocument` calls for the same source (e.g. an upload racing a future re-driver) would lose an increment. Not exploitable now. Prefer a DB-side `claim_extraction_job` RPC doing `update ... set attempts = attempts + 1 ... returning` to make the counter authoritative. Minor given current single-caller reality.

---

## 3. Logic-skeptic

### [IMPORTANT] Reaper re-enqueue is a dead-end — `pending` jobs are never re-driven; the `failed` give-up path is unreachable
**Files:** `apps/web/lib/brain/doc-extract.ts:192` (only caller: `void extractDocument` from the upload route), `supabase/migrations/20260623140000_extraction_reaper.sql:56-72`

`extractDocument` is invoked **only** fire-and-forget from the upload route. There is no poller/cron that claims `status='pending'` jobs. So when the reaper resets a stuck job to `status='pending', started_at=null` (attempts < max), **nothing ever calls `extractDocument` again** for it. On the next reaper cycle the job is `pending`, which the `where status='processing'` filter skips — so it is never re-claimed, `attempts` never re-increments, and the `attempts >= max → status='error' + extraction_state='failed'` give-up branch is **never reached**. Net effect: the reaper moves a stuck job from `processing` limbo to `pending` limbo and the source never reaches a terminal `failed` state. The Task 5 report and migration header advertise crash-recovery + eventual give-up that the architecture cannot deliver.

**Why real:** The advertised recovery ("re-enqueue → re-claim → eventually fail") has no re-claim step. Users with a crashed extraction see `extraction_state` stuck at `extracting`/job `pending` indefinitely.
**Fix (pick one):** (a) Add a `pending`-job re-driver — a small cron (or extend this reaper route) that selects `pending` jobs and calls `extractDocument`, so re-enqueue actually re-runs and attempts climbs to the give-up threshold; or (b) if re-driving is out of scope for P2, change the reaper to terminally fail stale `processing` jobs immediately (status='error' + extraction_state='failed') instead of bouncing to `pending`, and drop the misleading attempts/re-enqueue machinery from the report. Either way, align the claims with behavior.

### [OK] No infinite ping-pong
Even hypothetically (if a re-driver existed), `attempts` is the bound: each claim increments it, and at `>= p_max_attempts` the reaper terminally errors the job. No forever-loop.

### [OK] xlsx shared-string resolution correct
Shared strings are 0-indexed in OOXML; `extractSheetText` uses `sharedStrings[idx]` directly with bounds/`isNaN` guards (office-extract.ts:161-164). `t="s"` (shared), `t="inlineStr"` (inline `<is><t>`), and other/numeric (`<v>`) all handled. No off-by-one.

### [OK] pptx multi-slide ordering / empty / corrupt
Slides collected by regex, sorted numerically (`slide2` before `slide10`), joined in order; no slides / no text → `''` → `unsupported`; corrupt zip throws → `failed`. Covered by office-extract tests.

### [OK] svg no-text and corrupt handling
No text-bearing elements → `''` → `unsupported` (T3-2), not a crash. Empty/garbage buffer decodes to a string and yields `''`.

### [Minor] 10-min staleness window vs a legitimately slow office parse
**File:** migration default `p_stale_minutes=10`; route calls `reap_stale_extractions('{}')` using defaults. The serverless `maxDuration` is 60s and the LLM call dominates, so 10 min >> any healthy run — reasonable. Just note: if the zip-bomb guard (Critical) is added and a large-but-legit file legitimately takes >10 min (it shouldn't on this runtime), the reaper could reset an in-flight job. Acceptable as-is; flagging for awareness.

---

## 4. Cost

### [OK] No new per-file model calls
Office/svg parsing is fully local (fflate + regex). pptx/xlsx/svg reuse the **existing** single `callDocExtractLlm` (+ optional catch-all) path — same model spend as docx/textnative. No added calls.

### [OK] Live-smoke is opt-in and cannot bill in CI
`scripts/live-vision-smoke.ts:22` hard-guards on `RUN_LIVE_VISION==='1'` AND `ANTHROPIC_API_KEY`, else prints "skipped" and `exit 0` (zero network). The vitest wrapper `describe.skipIf(!RUN_LIVE)` skips the suite in CI. Two haiku calls × `maxTokens:8` only on explicit manual opt-in. Confirmed safe.

### [Minor] `scripts/**` now in vitest include (vitest.config.ts)
Adding `scripts/**/*.test.ts` to the include set is correct for the smoke wrapper, but widens the default test glob to anything future under `scripts/`. Harmless now; worth a scoped pattern if `scripts/` grows.

---

## Must-fix list (Critical/Important)

1. **[CRITICAL]** Bound decompressed size/entry-count before/while `unzipSync` in `office-extract.ts` (pptx + xlsx). The 20 MB compressed cap does **not** prevent a multi-GB OOM from a crafted zip. Throw → fail-closed; add a high-ratio fixture test.
2. **[IMPORTANT]** Reaper re-enqueues to `pending` but nothing re-drives `pending` jobs, so recovery never completes and the `failed` give-up path is unreachable. Either add a pending-job re-driver, or terminally fail stale `processing` jobs directly — and align the report's claims with actual behavior.

Minor items (racy increment, 10-min window, vitest include width, scripts glob) are non-blocking.
