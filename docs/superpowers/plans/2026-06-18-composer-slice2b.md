# Composer Slice 2b (detect-and-nudge family) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkbox steps. Spec: `docs/superpowers/specs/2026-06-18-composer-slice2b-design.md`. Builds on Slice 2a (#139).

**Goal:** Parity-extract 3 more detect-and-nudge templates (`tally`/`hopper`/`scribe`) into composable primitives + derive multi-connector requiredConnectors/allowlist + expand the Composer menu, so a diagnosis can synthesize nudges over payments and calendar (incl. cross-resource).

**Load-bearing safety (unchanged from 2a):** LLM picks a primitive id + schema-validated scalar params only; trusted primitive code builds all paths/effectArgs; multi-connector derivation is server-side from the registry; validator fail-closed; each primitive's polite-pause throws INSIDE its generator.

**GATED:** `packages/runtime` + composer/adopt path → `docs/gates/` report + 4-reviewer adversarial gate. **NO migration** (adopt_nibbin v2 already live).

## File structure
- **Create** `packages/runtime/src/primitives/nudge-overdue-invoice.ts` — from `tallyProgram`.
- **Create** `packages/runtime/src/primitives/nudge-unconfirmed-event.ts` — from `hopperProgram` (cross-resource gcal→gmail).
- **Create** `packages/runtime/src/primitives/reply-new-inquiry.ts` — from `scribeProgram`.
- **Modify** `packages/runtime/src/primitives/nudge-overdue-email.ts` — export the shared gmail/quarantine helpers the new email primitives reuse (`readMailbox`, `header`, `safeAddress`, `safeHeaderValue`, `parseQuarantinedJson`, `unwrap`, `modelDraftOr`, `GmailMeta`, `MailScan`, `DAY`) OR move them to a sibling `primitives/shared.ts` and re-export. Pick the cleaner: a new `primitives/shared.ts` for cross-primitive helpers (gmail + new calendar/stripe path builders), with `nudge-overdue-email.ts` importing from it.
- **Modify** `packages/runtime/src/capabilities.ts` — register the 3 primitives (descriptors + impls).
- **Modify** `apps/web/lib/runtime/programs.ts` — `tallyProgram`/`hopperProgram`/`scribeProgram` delegate to the shared impls (parity).
- **Modify** `apps/web/lib/composer/compose.ts` — derive requiredConnectors/allowlist from `effectiveTools`; expand the primitive menu + the no-key category→primitive mapping; per-primitive summaries.
- **Modify** `apps/web/app/app/diagnosis/BuildNibbinButton.tsx` (and/or the review surface) — per-primitive human summary.
- **Create/extend** tests in `packages/runtime/test/` + `apps/web/lib/composer/`.

---

### Task 1: Shared primitive helpers
**Files:** `packages/runtime/src/primitives/shared.ts` (new); `packages/runtime/src/primitives/nudge-overdue-email.ts` (modify)

- [ ] **Step 1** — create `primitives/shared.ts` and move the reusable helpers currently private/exported in `nudge-overdue-email.ts` into it: `DAY`, `MAIL_SAMPLE`, `MODEL_DRAFT_MAX_CHARS`, `unwrap`, `parseQuarantinedJson`, `modelDraftOr`, `gmailListPath`, `gmailMetaPath`, `GmailMeta`, `header`, `safeHeaderValue`, `safeAddress`, `MailScan`, `readMailbox`, `overdueInbound`. Add NEW helpers for the other connectors:
  - `calendarEventsPath(timeMinMs, timeMaxMs): string` — the gcal events query (singleEvents, orderBy startTime, maxResults 250), matching `hopperProgram`/`briefProgram`.
  - `stripeInvoicesPath(sinceMs): string` — `/v1/invoices?created[gte]=…&limit=100`, matching `tallyProgram`.
  - keep all logic byte-identical to programs.ts.
- [ ] **Step 2** — `nudge-overdue-email.ts` imports its helpers from `./shared` (no behavior change; the export surface from `@nibbin/runtime` index stays the same — re-export what was exported before).
- [ ] **Step 3** — `cd /c/Nibbin && npx tsc --noEmit -p packages/runtime && npx vitest run packages/runtime/test` → green (2a parity + e2e tests still pass). Commit: `refactor(runtime): extract shared primitive helpers (gmail + calendar + stripe path builders)`.

---

### Task 2: `nudge.overdue-invoice` (from tally)
**Files:** `packages/runtime/src/primitives/nudge-overdue-invoice.ts` (new); `capabilities.ts`; `apps/web/lib/runtime/programs.ts`

- [ ] **Step 1** — `nudgeOverdueInvoice({ minDaysLate = 0 }, connMap, nowMs): ProgramFn`. Pull `connMap.stripe` (throw polite pause inside the generator if missing). Yield the `payments.read` step (`stripeInvoicesPath(nowMs - 90*DAY)`); parse; filter `status==='open' && due_date*1000 < nowMs - minDaysLate*DAY`; sort worst-first by due_date; if none → `yield {kind:'compose', payload:{note:'no overdue invoices'}}` and return; else yield the `invoice.nudge` draft for the worst (deterministic body, `effectArgs:{invoiceId, amountCents}`, `patternKey:'invoice.nudge:overdue'`, title with $ + days late). Byte-identical to `tallyProgram` when `minDaysLate=0`.
- [ ] **Step 2** — register in `capabilities.ts`: descriptor `{id:'nudge.overdue-invoice', resource:'invoice', verb:'nudge', sideEffect:'draft', requiredConnector:'stripe', patternKeyPrefix:'invoice.nudge', kind:'primitive', inputSchema:{minDaysLate:{type:'number',default:0,min:0,max:120}}, effectiveTools:['payments.read','invoice.nudge']}` + `PRIMITIVE_IMPLS['nudge.overdue-invoice']`.
- [ ] **Step 3** — `tallyProgram` delegates: `return nudgeOverdueInvoice({ minDaysLate: 0 }, connections, nowMs);`.
- [ ] **Step 4** — `npx tsc --noEmit -p packages/runtime` → 0. Commit: `feat(runtime): nudge.overdue-invoice primitive (from tally, parity)`.

---

### Task 3: `nudge.unconfirmed-event` (from hopper, cross-resource)
**Files:** `packages/runtime/src/primitives/nudge-unconfirmed-event.ts` (new); `capabilities.ts`; `programs.ts`

- [ ] **Step 1** — `nudgeUnconfirmedEvent({ withinDays = 7 }, connMap, nowMs): ProgramFn`. Pull BOTH `connMap['google-calendar']` and `connMap.gmail` (throw polite pause inside the generator if EITHER missing). Yield the `calendar.read` step (`calendarEventsPath(nowMs, nowMs + withinDays*DAY)`, connectionId = the gcal id); parse events; filter not-cancelled with an unconfirmed external attendee; if none → no-op compose + return; else take the first, compute `when`, `safeAddress(guest email)`, yield the `email.draft` step (connectionId = the GMAIL id, `patternKey:'email.draft:session-confirmation'`, deterministic body, `effectArgs:{eventId, to:guestEmail}`). Byte-identical to `hopperProgram`.
- [ ] **Step 2** — register: `{id:'nudge.unconfirmed-event', resource:'calendar', verb:'nudge', sideEffect:'draft', requiredConnector:'google-calendar', patternKeyPrefix:'email.draft', kind:'primitive', inputSchema:{withinDays:{type:'number',default:7,min:1,max:60}}, effectiveTools:['calendar.read','email.draft']}` + impl.
- [ ] **Step 3** — `hopperProgram` delegates: `return nudgeUnconfirmedEvent({ withinDays: 7 }, connections, nowMs);`.
- [ ] **Step 4** — `npx tsc --noEmit -p packages/runtime` → 0. Commit: `feat(runtime): nudge.unconfirmed-event primitive (from hopper, cross-resource gcal→gmail, parity)`.

---

### Task 4: `reply.new-inquiry` (from scribe)
**Files:** `packages/runtime/src/primitives/reply-new-inquiry.ts` (new); `capabilities.ts`; `programs.ts`

- [ ] **Step 1** — `replyNewInquiry({}, connMap, nowMs): ProgramFn`. Pull `connMap.gmail` (throw inside generator). `readMailbox`; `answered = new Set(sent.threadId)`; inquiries = inbox filtered `!In-Reply-To && !List-Unsubscribe && !answered`, sorted newest-first; if none → no-op compose + return; else newest → compose prompt (the inquiry-reply intent) → `email.draft` (`patternKey:'email.draft:inquiry-reply'`, fallback body, `effectArgs:{threadId, subject:'Re: …'}`). Byte-identical to `scribeProgram`.
- [ ] **Step 2** — register: `{id:'reply.new-inquiry', resource:'email', verb:'draft', sideEffect:'draft', requiredConnector:'gmail', patternKeyPrefix:'email.draft', kind:'primitive', inputSchema:{}, effectiveTools:['email.read','email.draft']}` + impl. (Empty inputSchema is valid — `resolvePrimitiveInputs` with `{}` accepts no keys.)
- [ ] **Step 3** — `scribeProgram` delegates.
- [ ] **Step 4** — `npx tsc --noEmit -p packages/runtime` → 0. Commit: `feat(runtime): reply.new-inquiry primitive (from scribe, parity)`.

---

### Task 5: Composer — multi-connector derivation + expanded menu
**Files:** `apps/web/lib/composer/compose.ts`

- [ ] **Step 1 — connector derivation:** replace the Slice-2a `requiredConnectors: [cap.requiredConnector]` with a helper `connectorsFor(cap)` = unique `capability(t).requiredConnector` over `cap.effectiveTools` (fall back to `[cap.requiredConnector]` if effectiveTools absent). The assembled spec's `requiredConnectors = connectorsFor(cap)`, `toolsAllowlist = cap.effectiveTools ?? [cap.id]`.
- [ ] **Step 2 — menu filter:** `availablePrimitives` = registry primitives where EVERY `connectorsFor(p)` ∈ accountConnections. (So `nudge.unconfirmed-event` only appears when gcal AND gmail are connected.)
- [ ] **Step 3 — prompt:** list each available primitive with a one-line description + its inputSchema; ask the LLM to pick the best fit + params. Keep the strict-JSON contract.
- [ ] **Step 4 — no-key fallback mapping:** map the workflow's `category` to a primitive id — payments/invoice/billing→`nudge.overdue-invoice`; calendar/scheduling/meeting→`nudge.unconfirmed-event`; an "inquiry/lead/first-contact" signal→`reply.new-inquiry`; else→`nudge.overdue-email`. Only pick a primitive that's in `availablePrimitives`; if the mapped one isn't available, fall back to the first available (or `{error}` if none). Always `validateComposedSpec` before returning.
- [ ] **Step 5 — summaries:** a `summarize(cap, spec)` keyed by primitive id producing the human sentence (one per primitive).
- [ ] **Step 6** — `npx tsc --noEmit -p apps/web` → 0. Commit: `feat(web): Composer menu + multi-connector derivation for the nudge family`.

---

### Task 6: Review UX summaries
**Files:** `apps/web/app/app/diagnosis/BuildNibbinButton.tsx` (+ the review surface if separate)

- [ ] **Step 1** — render the per-primitive human summary returned by the Composer (the review card already shows a summary; ensure it reads naturally for all 4 primitives — invoice, calendar-confirm, inquiry-reply, overdue-email). Tokens-only styling, no coral. No new affordance needed beyond what 2a built.
- [ ] **Step 2** — `npx tsc --noEmit -p apps/web` → 0. Commit: `feat(web): per-primitive review summaries for synthesized nudges`.

---

### Task 7: Tests
**Files:** `packages/runtime/test/composer-slice2b.test.ts` (new); extend `apps/web/lib/composer/compose.test.ts`

- [ ] Parity (per primitive): drive the template program AND the primitive on the same fixture; assert identical yielded steps + effectArgs (mirror the 2a parity test). For the cross-resource one, assert the read step carries the gcal connectionId and the draft step carries the gmail connectionId.
- [ ] Validator: a composed spec for each primitive validates when its connector(s) are granted; rejected when a required connector is missing — INCLUDING the cross-resource case (grant only gcal for `nudge.unconfirmed-event` → rejected for the missing gmail).
- [ ] e2e: a steps-spec for each primitive runs through `interpretSpec`→`executeRun` with a path-aware reader stub returning one matching item → `awaiting_approval` with the expected effectArgs/patternKey.
- [ ] Composer: the no-key fallback maps a payments-category workflow → `nudge.overdue-invoice`, a calendar-category workflow → `nudge.unconfirmed-event`, and each result passes `validateComposedSpec`; a workflow whose primitive's connectors aren't granted falls back to an available primitive or `{error}`.
- [ ] `cd /c/Nibbin && npx tsc --noEmit -p packages/runtime && npx tsc --noEmit -p apps/web && npx vitest run packages/runtime/test apps/web/` → green. `npx eslint packages/runtime/src apps/web/lib/composer apps/web/lib/runtime apps/web/app/app/diagnosis` → clean. `npm run build -w @nibbin/web` → Compiled successfully (grep the log; don't trust the trailing echo). Commit: `test: nudge-family parity + validator + synthesis e2e`.

---

### Task 8: Verify
- [ ] tsc (runtime + web) 0; vitest green; eslint clean; next build ✓.
- [ ] Confirm: each template still byte-for-byte identical (parity tests); the cross-resource primitive reads gcal + drafts gmail and is rejected when either connector is ungranted; the menu hides primitives whose connectors aren't all granted; LLM still constrained to primitive id + scalar params; no migration.

## Self-review
- 2b populates the 2a mechanism with 3 parity-extracted primitives + the multi-connector derivation the cross-resource case needs. No new safety surface, no migration. Digest shape (sweep/brief), multi-primitive composition, spec editing, Planner, Crystallization deferred. Each primitive is bound to its template by a parity test, the same guarantee that made `nudge.overdue-email` safe.
