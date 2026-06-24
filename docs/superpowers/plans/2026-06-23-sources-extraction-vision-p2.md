# Sources Extraction: Accept-All + OCR/Vision (P2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Accept and store every uploaded file type (never drop), and extend the extractor + router so images and scanned PDFs are read via multimodal vision and flow into the proposal queue.

**Architecture:** The router (`@nibbin/router`) gains a backward-compatible content-block union so a message can carry image blocks alongside text; `doc-extract.ts` dispatches by file type to per-kind extractors (text-native / docx / pdf-text / **image vision** / **scanned-PDF vision OCR**), with pptx/xlsx stored as `unsupported` for now. Vision output is derived-not-raw and only ever becomes a proposal — never a direct write.

**Tech Stack:** Next.js 15 (Node runtime route), TypeScript, `@nibbin/router` (fetch-based Anthropic client), pdf-parse, mammoth, vitest (Supabase + Anthropic fetch fully mocked).

## Global Constraints

- **20 MB upload cap** enforced before Storage PUT (unchanged).
- **Accept all types; store, never drop.** A type we cannot extract is stored with `extraction_state='unsupported'` (retained + searchable by name), NOT rejected.
- **Derived-not-raw → proposal queue only.** Extracted/vision text becomes `propose_memory_change` proposals; the model reply is never a direct capability or write (C10 stays structural).
- **Fail-closed.** On any extractor/vision error → `extraction_state='failed'`, zero hallucinated proposals.
- **Router string-content back-compat is mandatory.** Existing text-only callers (P2/P3/P5) must produce a byte-identical request body. `content` accepts `string` OR `ContentBlock[]`.
- **The `sources` ALTER (mime_type, byte_size, extraction_state) is owned by the P1 branch migration.** Do NOT add a `sources` ALTER here. This worker/route simply writes those columns; tests mock Supabase, so there is no live-DB dependency.
- **PostgREST resolves RPC args by NAME** — the extractor's `propose_memory_change` call keeps the exact param names the branch's RPC defines; a regression test asserts them (the `p_account_id` vs `p_account` class bug already hit this file once).
- **Phase 1 only:** text-native + docx + pdf-text + images + scanned-PDF vision. **Phase 2 (NOT now):** pptx/xlsx parsing — stored as `unsupported`.

---

### Task 1: Router content-block union (types, back-compat)

**Files:**
- Modify: `packages/router/src/anthropic.ts` (`ChatTurn.content` type)
- Test: `packages/router/src/anthropic.test.ts` (add cases)

**Interfaces:**
- Produces: `type ContentBlock = { type: 'text'; text: string } | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }`; `ChatTurn.content: string | ContentBlock[]`.

- [ ] **Step 1: Failing test** — a request with `content: string` serializes to `messages:[{role,content:'<string>'}]` exactly as today (assert deep-equal against the prior body); a request with `content: ContentBlock[]` serializes the array through unchanged.
- [ ] **Step 2: Run, FAIL** (type/array not threaded). `npx vitest run packages/router/src/anthropic.test.ts`
- [ ] **Step 3: Implement** — widen `ChatTurn.content`; at the `messages.map` site (currently `content: m.content`) pass `m.content` through directly (Anthropic accepts both string and block array). No other change.
- [ ] **Step 4: PASS. Step 5: Commit** `feat(router): content-block union for multimodal messages (back-compat)`.

---

### Task 2: Anthropic client passes image blocks (request-shape test)

**Files:** Modify `packages/router/src/anthropic.ts` (verify the block mapping); Test: `anthropic.test.ts`.

- [ ] **Step 1: Failing test** — build a `GenerateRequest` whose single user message has `content:[{type:'image',source:{type:'base64',media_type:'image/png',data:'AAAA'}},{type:'text',text:'Read this'}]`; assert the captured fetch body's `messages[0].content` is that exact array, and that `system` blocks + `max_tokens` are still present. Add a second test asserting a text-only request body is byte-identical to the pre-change snapshot (back-compat guard).
- [ ] **Step 2: FAIL. Step 3: Implement** any remaining plumbing (likely none beyond Task 1). **Step 4: PASS. Step 5: Commit.**

---

### Task 3: Budget/usage accounting unaffected by image blocks

**Files:** Modify `packages/router/src/router.ts` / `budget.ts` only if needed; Test: `router.test.ts` / `budget.test.ts`.

- [ ] **Step 1: Failing test** — a generate call carrying image blocks still records `usage` (input/output/cache tokens) into the COGS path exactly as a text call (mock the client to return a fixed usage; assert the ledger/record hook receives it). If accounting is already content-agnostic, write the test to PROVE it and mark the task a verification (still commit the test).
- [ ] **Step 2: Run.** If PASS immediately (already agnostic), note it; if FAIL, **Step 3: Implement.** **Step 4: PASS. Step 5: Commit.**

---

### Task 4: Upload route — accept all types, store-never-drop, write new columns

**Files:**
- Modify: `apps/web/app/api/brain/documents/upload/route.ts`
- Test: `apps/web/lib/brain/upload.test.ts` (mocked Supabase + Storage)

**Interfaces:** Consumes `buildStoragePath`. Produces a `sources` insert that now sets `mime_type`, `byte_size`, and seeds `extraction_state` (`'pending'` for extractable types incl. images/pdf; `'unsupported'` for pptx/xlsx/other-non-extractable; the worker flips it).

- [ ] **Step 1: Failing tests** — (a) an `image/png` upload is ACCEPTED (no 422), stores the original, creates a `sources` row with `mime_type='image/png'`, `byte_size=<n>`, `extraction_state='pending'`, and enqueues a job; (b) an `application/vnd…presentationml.presentation` (pptx) upload is ACCEPTED but seeded `extraction_state='unsupported'` and does NOT enqueue (or enqueues a no-op that the worker resolves to unsupported — pick one and test it); (c) a file over 20 MB still 413/422s; (d) the row insert includes the exact column names.
- [ ] **Step 2: FAIL** (image currently 422'd). 
- [ ] **Step 3: Implement** — delete the `ACCEPTED_MIMES` allowlist + image-rejection block; gate only on size. Classify the mime into `extractable` (txt/md/csv/html, pdf, docx, image/*) vs `phase2_unsupported` (pptx/xlsx) vs `other`; set `extraction_state` accordingly; always store + create the source row; enqueue extraction for `extractable`.
- [ ] **Step 4: PASS. Step 5: Commit** `feat(brain): accept all file types on upload, store-never-drop`.

---

### Task 5: `doc-extract` type-router dispatch + state transitions

**Files:** Modify `apps/web/lib/brain/doc-extract.ts`; Test: `doc-extract.test.ts`.

**Interfaces:** Consumes source meta (`mime`, `filename`, buffer). Produces: `extractDocument` sets `extraction_state` `extracting`→(`extracted`|`unsupported`|`failed`) and routes by type. Add an internal `classifyExtractor(mime, filename): 'textnative'|'docx'|'pdf'|'image'|'phase2'|'unknown'`.

- [ ] **Step 1: Failing tests** — `classifyExtractor` maps each type correctly; `extractDocument` sets `extraction_state='extracting'` at start and `'extracted'` on success; a `phase2` (pptx) source resolves to `'unsupported'` with zero proposals; an extractor throw sets `'failed'` with zero proposals.
- [ ] **Step 2: FAIL. Step 3: Implement** — replace the `else throw 'Unsupported MIME type'` (lines ~490-520) with the classifier + per-branch dispatch; add a `text-native` branch (decode utf-8 + strip) for txt/md/csv/html; write `extraction_state` via the service client at each transition.
- [ ] **Step 4: PASS. Step 5: Commit.**

---

### Task 6: Image vision extractor → proposal queue (fail-closed)

**Files:** Create `apps/web/lib/brain/vision-extract.ts`; Modify `doc-extract.ts` (wire the `image` branch); Test: `vision-extract.test.ts`.

**Interfaces:** Consumes the router `Generate` + a base64 image buffer. Produces `extractFromImage(buffer, mime, ctx): Promise<ProposalDraft[]>` — builds a `GenerateRequest` whose user message `content` is `[{type:'image',source:{type:'base64',media_type:mime,data:base64}}, {type:'text',text:<extraction instruction>}]`, parses the structured reply into proposal drafts, and (in `doc-extract`) submits each via `propose_memory_change`.

- [ ] **Step 1: Failing tests** (mock the router client) — a stubbed model reply yields N proposal drafts, each submitted via `propose_memory_change` with the EXACT branch param names (assert keys); a model error → throws so the worker marks `failed`; a reply with no usable content → zero proposals (not a crash); svg input is rasterized OR routed to `unsupported` (pick: rasterization needs a dep — if none available, treat svg as `phase2/unsupported` and test THAT, documenting it).
- [ ] **Step 2: FAIL. Step 3: Implement** — derived-not-raw: only structured fields become proposals, never the raw image bytes or a verbatim dump. Reuse the existing redaction battery before proposing (same as the text path). **Step 4: PASS. Step 5: Commit** `feat(brain): image vision extraction → proposal queue (fail-closed)`.

---

### Task 7: Scanned-PDF vision OCR fallback

**Files:** Modify `doc-extract.ts` (pdf branch); Test: `doc-extract.test.ts`.

**Interfaces:** When `extractPdfText` returns empty/below a text-density threshold (a scanned PDF with no text layer), fall back to the vision path: render/pass the PDF pages to `extractFromImage`-style vision. If page rasterization requires a dependency not present, pass the PDF bytes as an image block only when the model accepts PDF blocks; otherwise mark `unsupported` with a logged reason (no silent drop).

- [ ] **Step 1: Failing tests** — a text-layer PDF uses the existing fast path (no vision call); a no-text PDF triggers exactly one vision fallback; vision failure → `failed`. Assert via a mocked router spy (called 0 times for text PDFs, 1 for scanned).
- [ ] **Step 2: FAIL. Step 3: Implement** the density threshold + fallback. **Step 4: PASS. Step 5: Commit.**

---

### Task 8: `propose_memory_change` arg-name regression guard (extractor path)

**Files:** Test only: `apps/web/lib/brain/doc-extract.argnames.test.ts`.

- [ ] **Step 1:** Write a test that drives the extractor's propose path (text + image) and asserts the rpc spy received `propose_memory_change` with `Object.keys(args).sort()` equal to the branch's actual param list (read the current RPC signature in the migration; this branch's is the 7-arg form `p_account, p_field_key, p_op, p_value, p_rationale, p_source_id, p_origin` — assert exactly that, and add a comment noting the P6 merge adds `p_stakes`). **Step 2: Run** (PASS if the impl is correct; this is a guard). **Step 3: Commit.**

---

### Task 9: Full-suite green

- [ ] Run `npm run lint`, `npm run typecheck`, the router suite, and the brain suite; fix breakage. Verify a text-only generate request body is unchanged (back-compat). Commit `chore: typecheck + lint + suite green (accept-all + vision extraction)`.

---

## Merge-reconciliation notes (carry to the wave checklist)
- This branch calls `propose_memory_change` in its **7-arg** form; P6 introduces an **8-arg** form with `p_stakes`. At merge, the extractor call must add `p_stakes` (default `'normal'`) — already a tracked P2+P6 reconciliation.
- The `sources` columns this branch writes are created by the **P1** migration; P1 + P2 must land together (Foundation #240 first).
- Router multimodal change is additive/back-compat; P3/P5 router callers are unaffected.

## Self-review notes
- Spec coverage: B.1 (Task 4), router multimodal (Tasks 1-3), per-type dispatch (Task 5), image vision (Task 6), scanned-PDF OCR (Task 7), Phase-2 stored-unsupported (Tasks 4-5), fail-closed + derived-not-raw (Tasks 5-7), arg-name guard (Task 8). ✓
- No live API calls in tests — Anthropic fetch + Supabase fully mocked. ✓
- svg/pptx/xlsx handled as `unsupported` with explicit tests, never dropped. ✓
