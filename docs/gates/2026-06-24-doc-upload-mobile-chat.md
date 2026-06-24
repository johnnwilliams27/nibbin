# Adversarial Gate — Doc-upload persistence + Mobile-chat close/Send overlap

- **Date:** 2026-06-24
- **Branch:** `fix/mobile-chat-close-overlap`
- **PR:** #258
- **Head commit:** `e899bdb1`
- **Surface:** `POST /api/brain/documents/upload` (untrusted file upload + Supabase Storage writes + `sources` insert + extraction worker kickoff) — **sensitive**. Secondary: Grove KeeperDock/KeeperPanel mobile CSS/markup; `sourcesLibrary.reducer.ts`.
- **Method:** Read the full PR diff (`.gate-258-diff.txt`), then traced the redaction/extraction lifecycle in `lib/brain/doc-extract.ts`, the `propose_memory_change` RPC (`supabase/migrations/20260622150000_*.sql`), the `sources` schema (`supabase/migrations/20260622140000_*.sql`), all `redaction_status` consumers, the storage-path sanitizer, and `mapRowToSourceListItem`. Did not run the full suite (CI owns it).

## Verdict: **PASS**

The crux holds. Removing `redaction_status` from the insert does **not** open a privacy/redaction bypass, and `clean` does not mean "safe to synthesize/propose from" prematurely. No Critical or Important findings. Two Minor robustness notes below; neither blocks merge.

---

## Crux analysis — does `redaction_status` default `'clean'` create a bypass? (NO)

**The fix is correct and the previous behavior was the real bug.**

1. **Schema (`20260622140000_company_brain_foundation.sql:17`):**
   `redaction_status text not null default 'clean' check (redaction_status in ('clean','redacted','quarantined'))`.
   `'pending'` is **not** an allowed value. The old insert wrote `redaction_status: 'pending'`, so **every** insert hit a CHECK violation → the `if (sourceError)` cleanup `remove()`d the just-uploaded object → 0 sources rows AND 0 storage objects in prod. The diagnosis in the PR description and the route comment (`route.ts:147-154`) is accurate.

2. **`clean` is NOT a "skip redaction" signal.** The proposal/extraction path is gated by the worker's **own in-process redaction battery**, not by the source row's stored status:
   - `extractDocument` (`doc-extract.ts:786`) calls `runRedactionGate(rawText)` on the extracted raw text **before any `propose_memory_change` call**. Quarantine → early return, zero proposals, row set to `'quarantined'` and `extraction_state='failed'` (`doc-extract.ts:788-794`).
   - Every proposed field passes a second `perFieldRedactionCheck` (`doc-extract.ts:824-828`) — defense-in-depth, drop-not-surface.
   - The terminal `redaction_status` (`clean`/`redacted`/`quarantined`) is written by the worker **after** the gate runs (`doc-extract.ts:881`, and the vision/PDF branches at `:642`, `:771`).
   So the freshly-inserted `clean` default is just the at-rest default for a row whose content has not yet been read; nothing acts on raw content based on that default before the worker runs.

3. **The DB-side guard is a NEGATIVE check, not a positive one.** `propose_memory_change` (`20260622150000_*.sql:35-39`) rejects a proposal only when the backing source is **`quarantined`**:
   ```sql
   if p_source_id is not null and exists (
     select 1 from public.sources s where s.id = p_source_id and s.redaction_status = 'quarantined'
   ) then raise exception 'cannot propose from a quarantined source';
   ```
   It never requires `redaction_status = 'clean'` to *allow* a proposal. Therefore the choice of `clean` vs `pending` at insert time changes nothing about whether a proposal is permitted — only quarantine blocks, and quarantine is set by the worker after redaction. (Note: the old `'pending'` value would have been *rejected* by the CHECK anyway, so it never functioned as a guard.)

4. **No other consumer treats `clean` as "safe to synthesize from raw content."** Exhaustive sweep of `redaction_status` and raw-`sources` readers:
   - `apps/web/app/api/brain/sources/[sourceId]/status/route.ts` — maps status for the **UI poll** only (`clean|redacted`→done, `quarantined`→error, `pending`→processing). Display only; no content read, no model call.
   - `apps/web/app/api/brain/sources/route.ts` + `app/app/memory/page.tsx` — list/metadata views; never read file bytes.
   - `apps/web/lib/brain/doc-extract.ts` — the **only** path that downloads `brain-sources` bytes, and it runs the redaction gate itself.
   - Synthesis/Keeper consume `grove_memory` (owner-approved proposals), not raw `sources`. There is no RAG/retrieval path that selects `sources WHERE redaction_status='clean'` and feeds raw content to an LLM.

   The default's only added exposure vs `pending`: while the worker is mid-flight, the row briefly reads `clean` instead of `processing`. The sole effect is the **status poll** showing "done" instead of "processing" for a few seconds. That is cosmetic — and the worker writes `extraction_state='extracting'` immediately (`doc-extract.ts:565`), which is the field the library UI keys off for the spinner. See Minor M2.

**Conclusion:** the redaction invariant ("nothing reaches the model or a proposal before passing the in-worker battery") is preserved end-to-end. The fix removes an always-failing write; it grants no new trust to unredacted content.

## Error / cleanup paths (PASS)

- **Upload awaited + checked:** `await svc.storage...upload(...)`; on `uploadError` returns 502 and never reaches the insert (`route.ts:135-143`).
- **Insert awaited + checked, now also null-guarded:** `if (sourceError || !insertedSource)` (`route.ts:178`). On failure → best-effort `remove([storagePath])` of the orphan + 502. No false success: 502 is returned, no job enqueued, no worker kicked.
- **No success/failure mismatch:** 202 is returned only after a non-null `insertedSource`. The job insert error is intentionally non-fatal (`route.ts:193-196`) — acceptable: the row + file persist and a separate runner can re-trigger; the worker is still kicked. This is unchanged prior behavior.
- **Worker kickoff is fire-and-forget** (`void extractDocument(...)`) — unchanged and by design (documented timeout/poll fallback).

## Auth / tenancy / injection (PASS — unchanged by PR)

- `accountId` is taken from `appSession()` (`route.ts:67-69`), never from client input. Insert sets `account_id: accountId`.
- Storage key is `buildStoragePath(accountId, sourceId, file.name)` with `sanitizeFilename` stripping `/`, `\`, null bytes, and leading dots (`storage-path.ts:24-28`). `accountId`/`sourceId` are server-side UUIDs. No path traversal / object-key injection.
- MIME `.doc` nudge (422), 20 MB cap enforced before the Storage PUT (`route.ts:88-123`) — all still present.
- **No client-forgeable `item` / cross-account id:** `item` is built server-side from `insertedSource` (the row just persisted with `id: sourceId`, a server UUID). The client cannot inject an id; the reducer prepends what the server returned. The de-dup `filter((i) => i.id !== action.item.id)` is keyed on that server id.

## Test review — `route.test.ts` (substantive, not hollow)

- Happy path asserts **202 + both `sourceId` and `item.id`**, and that upload/insert/job/worker spies each fired once.
- `redaction_status` test inspects the actual insert payload and asserts `!== 'pending'` — directly pins the root-cause regression.
- Storage-failure test asserts non-2xx **and** that the `sources` insert was never attempted.
- Insert-failure test asserts non-2xx, `removeSpy` called once (orphan cleanup), and `extractDocument` **not** called.
- Unauthenticated test asserts 401 with nothing touched.
- The "awaited" guarantee is pinned indirectly but soundly: the failure-path assertions (502 + `removeSpy`) only hold if the insert result is awaited and error-checked, so a non-awaited regression would fail these tests.

## Secondary — reducer + mobile chat (PASS)

- `sourcesLibrary.reducer.ts`: `UPLOAD_DONE` now de-dups by id and preserves the item's own `extractionState` (correct — `unsupported` must not be force-flipped to `pending`); `UPLOAD_FAILED` surfaces an error and adds no phantom row; `UPLOAD_START` clears prior error. Tests updated to match (the old "forces pending" assertions are correctly inverted). Filter-survival rationale is sound: a real persisted id survives a server refetch; the old `upload-${Date.now()}` placeholder did not.
- Client (`SourcesLibrary.tsx`): now requires `data.item && data.item.id` before `UPLOAD_DONE`; a 2xx without a usable item is treated as failure (no fabricated row). Server error message surfaced via `role="alert"`. Good.
- Mobile chat: FAB hidden while open (`.fabHidden { display:none }`); close moved to the sheet header (`.closeBtn`, mobile-only via `@media (max-width:880px)`); `onClose` optional so the panel renders standalone. Desktop unchanged (close rail still hidden→collapse rail handles dismissal). aria-label simplified to "Open Keeper" (the FAB is now open-only). No overlap regression; correct.

## Findings

### Critical
None.

### Important
None.

### Minor
- **M1 (cosmetic, no impact):** The insert `.select('id, title, mime_type, byte_size, captured_at, extraction_state')` omits `storage_path`, so `mapRowToSourceListItem` falls back to `title` when deriving `mimeGroup` from the filename extension (`sourcesQuery.ts:204,210`). Harmless — `title` is the filename, so the extension is identical; the group is correct. No change required.
- **M2 (pre-existing, surfaced by this change):** Because `redaction_status` now defaults to `'clean'` at insert, the status-poll route (`sources/[sourceId]/status/route.ts`) will briefly report the source as `done` (via the `clean`→done mapping) during the window before the worker stamps the terminal status — instead of `processing`. Job-status precedence mitigates this once the `source_extraction_jobs` row is read (job is `pending`/`processing`), and the library UI keys its spinner off `extraction_state` (set to `extracting` immediately by the worker), so user-visible impact is negligible. Not a regression introduced by removing the (always-CHECK-failing) `'pending'` write — the old code never persisted a row at all. No action required; noted for awareness.

## Bottom line
Ship. The fix repairs a total-data-loss bug (every doc upload was failing + self-deleting in prod) without weakening the redaction gate: extraction and proposal remain gated by the worker's in-process battery and the quarantine RPC guard, neither of which depends on the insert-time `redaction_status`. Tenancy, filename sanitization, size/MIME validation, and orphan cleanup are intact. Tests genuinely cover the regression.
