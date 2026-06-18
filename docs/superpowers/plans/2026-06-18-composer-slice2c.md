# Composer Slice 2c (digest/summarize shape) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkbox steps. Spec: `docs/superpowers/specs/2026-06-18-composer-slice2c-design.md`. Builds on 2a (#139) + 2b (#141).

**Goal:** Add the summarize/digest shape — parity-extract `sweep`→`digest.inbox-cleanup` and `brief`→`digest.morning` (3-connector) as presentation primitives. After 2c, all 6 templates have primitive equivalents.

**Load-bearing safety:** presentation drafts are read-only (no send — runner gates them as `draft` always, never executes). LLM picks primitive id + scalar params only; connector derivation server-side from `effectiveTools` (2b machinery, already N-connector); validator fail-closed; polite-pause checks ALL connectors inside the generator; parity guarded by a differential CI test.

**GATED:** `packages/runtime` + composer path → `docs/gates/` report + 4-reviewer adversarial gate. **NO migration.**

## File structure
- **Create** `packages/runtime/src/primitives/digest-inbox-cleanup.ts` — from `sweepProgram`.
- **Create** `packages/runtime/src/primitives/digest-morning.ts` — from `briefProgram` (3-connector).
- **Modify** `packages/runtime/src/primitives/shared.ts` — export any helper the digests need that isn't yet shared (the `gmailListPath`/`header`/`readMailbox` are already there from 2b; add nothing unless `briefProgram` uses a helper not yet extracted — check the gcal events path used by brief is `calendarEventsPath`, already shared; brief's fresh-mail count uses `gmailListPath('in:inbox', …)`, already shared).
- **Modify** `packages/runtime/src/capabilities.ts` — register the 2 primitives (descriptors + impls).
- **Modify** `apps/web/lib/runtime/programs.ts` — `sweepProgram`/`briefProgram` delegate to the shared impls.
- **Modify** `apps/web/lib/composer/compose.ts` — extend the menu + `mapWorkflowToPrimitive` + `summarize` for the 2 digests.
- **Modify** `apps/web/lib/runtime/programs.parity.test.ts` — extend to all 6 templates (add sweep + brief).
- **Create/extend** tests in `packages/runtime/test/composer-slice2c.test.ts` + `apps/web/lib/composer/compose.test.ts`.

---

### Task 1: `digest.inbox-cleanup` (from sweep)
**Files:** `packages/runtime/src/primitives/digest-inbox-cleanup.ts` (new); `capabilities.ts`; `programs.ts`

- [ ] **Step 1** — `digestInboxCleanup({ topSenders = 5 }, connMap, nowMs): ProgramFn`. Pull `connMap.gmail` (throw polite pause INSIDE the generator if missing). `readMailbox`; `noise = inbox.filter(m => header(m,'List-Unsubscribe'))`; count per sender (the `From` parsed the same way as sweep: `.replace(/.*<|>.*/g,'')`); `top = [...].sort(desc).slice(0, topSenders)`; yield ONE presentation draft: `{kind:'draft', capability:'email.read', connectionId:gmail, patternKey:'sweep:keep-or-clear', presentation:true, title:'This morning’s sweep', draft: <the exact sweep body for top.length===0 vs the list>, effectArgs:{senders: top.map(([s])=>s)}}`. Byte-identical to `sweepProgram` when `topSenders=5`.
- [ ] **Step 2** — register: `{id:'digest.inbox-cleanup', resource:'email', verb:'digest', sideEffect:'read', requiredConnector:'gmail', patternKeyPrefix:'sweep', kind:'primitive', inputSchema:{topSenders:{type:'number',default:5,min:1,max:20}}, effectiveTools:['email.read']}` + `PRIMITIVE_IMPLS['digest.inbox-cleanup']`.
- [ ] **Step 3** — `sweepProgram` delegates: `return digestInboxCleanup({ topSenders: 5 }, connections, nowMs);`.
- [ ] **Step 4** — `npx tsc --noEmit -p packages/runtime` → 0. Commit: `feat(runtime): digest.inbox-cleanup primitive (from sweep, presentation, parity)`.

---

### Task 2: `digest.morning` (from brief, 3-connector)
**Files:** `packages/runtime/src/primitives/digest-morning.ts` (new); `capabilities.ts`; `programs.ts`

- [ ] **Step 1** — `digestMorning({}, connMap, nowMs): ProgramFn`. Pull `connMap['google-calendar']`, `connMap.stripe`, `connMap.gmail` (throw polite pause INSIDE the generator if ANY missing — check all three up front). Yield, in brief's order: the `calendar.read` step (events window now−1d…now+2d, on the gcal conn) → parse events; the `payments.read` step (stripe invoices 90-day window, on the stripe conn) → parse + overdue filter + `$` sum; the `email.read` step (`gmailListPath('in:inbox', nowMs-2*DAY)`, on the gmail conn) → fresh-mail count. Then yield ONE presentation draft: `{kind:'draft', capability:'email.read', connectionId:gmail, patternKey:'brief:morning-digest', presentation:true, title:'Your morning, the short version', draft:<the exact 3-part brief body>, effectArgs:{events:events.length, freshMail, overdue:overdue.length}}`. Byte-identical to `briefProgram`. (Use the shared `calendarEventsPath`? NOTE: brief's event window is now−1d…now+2d with maxResults 250 — confirm `calendarEventsPath` produces exactly brief's query; if `calendarEventsPath`'s signature/params differ from brief's inline query, either extend the shared builder to match or inline brief's exact query in the primitive. Parity is the gate — match brief byte-for-byte.)
- [ ] **Step 2** — register: `{id:'digest.morning', resource:'calendar', verb:'digest', sideEffect:'read', requiredConnector:'google-calendar', patternKeyPrefix:'brief', kind:'primitive', inputSchema:{}, effectiveTools:['calendar.read','payments.read','email.read']}` + impl.
- [ ] **Step 3** — `briefProgram` delegates: `return digestMorning({}, connections, nowMs);`.
- [ ] **Step 4** — `npx tsc --noEmit -p packages/runtime` → 0. Commit: `feat(runtime): digest.morning primitive (from brief, 3-connector, presentation, parity)`.

---

### Task 3: Composer menu + fallback + summaries
**Files:** `apps/web/lib/composer/compose.ts`

- [ ] **Step 1** — the menu derivation already includes any registry primitive whose connectors are all granted (2b's `availablePrimitives` + `connectorsFor` — no change needed; `digest.morning`'s 3 connectors flow through the union automatically). Confirm by inspection.
- [ ] **Step 2** — extend `mapWorkflowToPrimitive`: inbox-overwhelm / triage / unsubscribe / newsletter / "too much email" → `digest.inbox-cleanup`; morning-planning / daily-overview / "stay on top" / "start my day" → `digest.morning`. Only return an available primitive (existing guard).
- [ ] **Step 3** — extend `summarize` (and `PRIMITIVE_DESCRIPTION` if that's the menu-description map) with the two digest sentences (spec §4), emphasizing read-only/nothing-sent.
- [ ] **Step 4** — `npx tsc --noEmit -p apps/web` → 0. Commit: `feat(web): Composer menu + fallback + summaries for the digest shape`.

---

### Task 4: Tests
**Files:** `packages/runtime/test/composer-slice2c.test.ts` (new); `apps/web/lib/runtime/programs.parity.test.ts` (extend); `apps/web/lib/composer/compose.test.ts` (extend)

- [ ] **Differential parity (extend to all 6):** add `sweep` and `brief` cases to `programs.parity.test.ts` — drive the real template via `buildProgram(templateSpec('sweep'|'brief'), connMap, NOW)` AND the primitive on the same fixtures, assert deep-equal yielded steps (incl. the presentation draft's `presentation:true`, `patternKey`, `effectArgs`). For `brief`, the fixture must feed all 3 reads. Keep the anti-vacuous "a draft was yielded" guard.
- [ ] **topSenders behavioral:** `digest.inbox-cleanup` with `topSenders=2` on a fixture with 4 distinct unsubscribe senders → the digest lists exactly 2 (and `effectArgs.senders` has length 2). Proves the param.
- [ ] **Validator (3-connector):** a `digest.morning` composed spec validates when gcal+stripe+gmail all granted; rejected when EACH one is individually missing (3 assertions, naming the missing connector). A `digest.inbox-cleanup` spec validates with gmail, rejected without.
- [ ] **e2e:** a `digest.inbox-cleanup` steps-spec runs `interpretSpec`→`executeRun` with a path-aware mailbox reader stub (≥1 unsubscribe sender) → `awaiting_approval` with `presentation:true` draft + `effectArgs.senders`. A `digest.morning` steps-spec with all-3-source reader stubs → `awaiting_approval` presentation digest with `effectArgs:{events,freshMail,overdue}`. Assert `h.executed` length 0 (presentation never executes).
- [ ] **Composer fallback:** a triage-category workflow (no key) → `digest.inbox-cleanup`; a daily-overview workflow → `digest.morning`; both pass `validateComposedSpec`. A digest.morning workflow with only gmail granted falls back to an available primitive or `{error}` (never invalid).
- [ ] `cd /c/Nibbin && npx tsc --noEmit -p packages/runtime && npx tsc --noEmit -p apps/web && npx vitest run packages/runtime/test apps/web/` → green. `npx eslint packages/runtime/src apps/web/lib/composer apps/web/lib/runtime apps/web/app/app/diagnosis` → clean. `npm run build -w @nibbin/web` → Compiled successfully (grep the log; don't trust the trailing echo). Commit: `test: digest-shape parity (all 6 templates) + topSenders + 3-connector validator + e2e`.

---

### Task 5: Verify
- [ ] tsc (runtime + web) 0; vitest green (the 6-template differential parity test runs + passes); eslint clean; next build ✓.
- [ ] Confirm: sweep/brief still byte-for-byte identical (parity); digests are presentation-only (never executed); `digest.morning` rejected when any of its 3 connectors is missing; menu hides it unless all 3 granted; LLM constrained to id + scalar params; no migration.

## Self-review
- 2c adds the second shape (presentation digests) + the last 2 templates, reusing 2b's N-connector derivation (brief = 3 connectors) and the differential parity harness (now all 6 templates). Lower-stakes than the nudge family (read-only, no send). With 2c, the synthesis loop fully mirrors the template library. Multi-primitive composition / spec editing / Planner / Crystallization deferred.
