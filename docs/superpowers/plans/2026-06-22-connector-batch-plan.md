# Connector Batch Implementation Plan — finish the 5 + a calendar-write primitive

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development to execute task-by-task. This is a SCOPED plan: each task lists exact files, the gap it closes, concrete steps, and acceptance/tests. Per-task TDD micro-steps + final code are expanded in the task brief at execution time (several tasks depend on provider-API specifics that must be validated first — see Risks).

**Goal:** Make Nibbins able to *act* on connectors beyond Gmail — light up Google Calendar (write), Stripe, HoneyBook, Instagram-DM (write), and Pixieset (read-only) — entirely in-house, under the existing primitive + action-level safety model.

**Architecture:** Build verbs into the vetted **primitive vocabulary** (the only thing the Composer/Planner may compose) and thin **executor branches** (the only place a write touches a connector client). The owner-set **action level (Observe/Draft/Send)** remains the sole execution gate. No aggregator (see ADR `docs/decisions/2026-06-22-connector-strategy-diy-vs-aggregator.md`).

**Tech Stack:** Next.js 15 (`apps/web`), `packages/runtime` (interpreter, capabilities, primitives), `packages/connectors` (clients, oauth, registry), `packages/scan`, Supabase (Vault + Postgres + RLS), Vitest.

## Global Constraints

- **Action level is the sole execution gate.** No task may reintroduce a stage/grade check into `dispatchStep`. Reads are always allowed; writes gate on `action_level` (`observe`→deny, `draft`→draft, `send`→execute behind idempotency/velocity/resource-claim/quarantine walls).
- **The primitive is the composition boundary.** `validateComposedSpec` rejects any composed step whose capability is not `kind:'primitive'` or a pure read. Every new write capability must be reachable ONLY through a primitive that builds its `effectArgs` in trusted code — never as a raw composed write.
- **derived-not-raw.** Connector reads feed derived memory/findings; raw bodies are never persisted. New scan output must `sanitizeProse`/derive, not store raw.
- **Tokens are vault-only.** No token in app tables/logs/redirects. Reuse `SupabaseTokenVault` + `getOAuthConfigFor` + `callback-core` (`handleConnectionCallback`) + refresh-on-401 in the connector base — do not hand-roll auth.
- **Liveness model differs by connector.** Event-driven connectors (Gmail, Calendar, HoneyBook messages, Instagram DMs) use the cron `connector-poll` route (delta/webhook). Periodic-check connectors (Stripe overdue invoices, Pixieset delivery latency) run on the `nibbin-schedule` tick and need NO poll-route handling.
- **Migrations applied to all 3 DBs** (dev `oqnqzytctwlptfdvyagl`, staging `swbbydp…`, prod `oaymttu…`) and `tester_allowlist` seeded per new `(email, provider)` like Gmail/Calendar.
- **SDD process:** per-task implementer + spec/quality review; **the 4-reviewer adversarial gate runs on the write-path tasks** (sensitive surfaces) → `docs/gates/`. Straight quotes only in TS/TSX. Run `npm run lint` + `npm run typecheck` + tests locally; CI is the typecheck/build arbiter (worktree `@nibbin/*` tsc errors are stale-symlink false-positives).
- **Verification is an external, per-provider dependency** (Google CASA, Meta app review, HoneyBook/Stripe/Pixieset developer-app approval). Code can land behind the tester-allowlist gate before verification clears; GA per connector waits on its provider review.

## Key design decisions (resolve in-task, recorded here)

1. **`dm.reply` is a cross-connector capability** used by both HoneyBook and Instagram-DM. Keep it as ONE capability; the executor resolves the concrete client from the step's connection `provider` (HoneyBook→`sendMessage`, Instagram→`sendReply`) rather than a single `requiredConnector`. This is the intent-shaped-primitive pattern (one verb, many connectors, connector-specific args builder).
2. **The calendar primitive is a thin, parameterized event-proposer**, not a hardcoded use case. It emits `calendar.event-create` from inputs (title/start/end/attendees) derived from context. The Planner/field-study decides *when* to wire it and with what trigger — we add the verb, not the policy.
3. **`invoice.nudge` executes a Stripe-native reminder.** Stripe's client is currently read-only; the write is a dedicated reminder method (e.g. `POST /v1/invoices/{id}/send_invoice` or the equivalent reminder endpoint — validate exact endpoint in Risk R1).

## File Structure (what each task touches)

- `packages/runtime/src/capabilities.ts` — capability descriptors + `PRIMITIVE_IMPLS` registrations.
- `packages/runtime/src/primitives/*.ts` — the vetted verbs (new: calendar event-create; dm.reply for honeybook + instagram).
- `apps/web/lib/runtime/engine.ts` — executor branches (`invoice.nudge`, `dm.reply` with provider resolution).
- `packages/connectors/src/connectors/{stripe,honeybook,instagram}.ts` — write methods where missing.
- `apps/web/lib/connections/providers.ts` (`CONNECTABLE_PROVIDERS`) — wire flags.
- `apps/web/app/api/cron/connector-poll/route.ts` — liveness for HoneyBook + Instagram only.
- `supabase/migrations/*` — IG per-Nibbin grant row (Task 8); `tester_allowlist` seeds.
- Tests alongside each.

---

## Phase 0 — Shared foundations (unblocks all connectors)

### Task 1: Register missing runtime capability descriptors
**Files:** Modify `packages/runtime/src/capabilities.ts`; tests `packages/runtime/test/capabilities*.test.ts`.
**Gap closed:** `crm.read`, `gallery.read`, `dm.read`, `dm.reply` are declared in `registry.ts` but have NO `CAPABILITY_REGISTRY` descriptor → any spec referencing them fails validation; Composer can't compose them.
**Steps:** Add descriptors — `crm.read`/`gallery.read`/`dm.read` as `sideEffect:'read'`; `dm.reply` as `sideEffect:'write'` with `patternKeyPrefix:'dm.reply'` and (per decision 1) NO single hard `requiredConnector` (or a sentinel allowing honeybook+instagram — match how the validator maps capability→connector; if a single field is required, introduce a `connectors: ['honeybook','instagram-dm']` set and update `uniqueConnectorsFor`/`registryCapabilities`). Reads map to their home connector.
**Acceptance:** `validateSpec`/`validateComposedSpec` accept a spec using each new capability; a unit test asserts each descriptor resolves and `dm.reply` is recognized for both connectors.

### Task 2: Connector-write executor branches with provider resolution
> **RECLASSIFIED during execution (2026-06-22):** these two executor branches were folded into their connector phases rather than built up-front in Phase 0. Rationale discovered on reading the executor: `invoice.nudge`'s branch calls a Stripe write method that does not exist yet (the client is read-only — that method is **Task 4**), and `dm.reply`'s branch must avoid the velocity double-consume `email.send` solved (needs "direct send" variants on the HoneyBook/Instagram clients — **Tasks 6–9**). Both branches are inert until their connector phases and add write-surface ahead of need. `invoice.nudge` executor → build in **Task 4** with the Stripe write method; `dm.reply` executor → build in **Task 6/8** with the HoneyBook/Instagram primitives. Until then the `default: throw "no executor"` keeps them fail-closed (red-team confirmed). Task 1's capability registrations were the true cross-cutting Phase-0 foundation.

**Files:** Modify `apps/web/lib/runtime/engine.ts` (effects executor switch, ~lines 253–406); tests `apps/web/test/effects-executor.test.ts` + `apps/web/lib/runtime/engine-telemetry.test.ts`.
**Gap closed:** executor only handles `email.send` + `calendar.event-create`; `invoice.nudge` and `dm.reply` fall through to "no executor" → throws at Send.
**Steps:**
1. Add `case 'invoice.nudge':` → resolve the Stripe client for the connection, call the reminder write (Task 4 adds the client method), with the same velocity/idempotency wall pattern as `email.send`.
2. Add `case 'dm.reply':` → resolve the connection's `provider`; dispatch HoneyBook→`sendMessage(projectId, body)` or Instagram→`sendReply(threadId, body)`; throw a clear error for any other provider. Apply velocity consume-before-send (reuse `PgSendRecordStore`) and emit `connector_blocked` on `ConnectorRequestError`.
**Acceptance:** test-injected `invoice.nudge` and `dm.reply` (each provider) steps at Send level call the right client method exactly once, consume velocity first, and surface `connector_blocked` on auth failure; an unknown provider for `dm.reply` throws a descriptive error.

---

## Phase 1 — Calendar write primitive (the end-to-end proof)

### Task 3: `calendar.event-create` composable primitive
**Files:** Create `packages/runtime/src/primitives/schedule-event.ts`; register in `packages/runtime/src/capabilities.ts` (`PRIMITIVE_IMPLS` + a primitive descriptor whose `effectiveTools` include `calendar.read` and `calendar.event-create`); tests `packages/runtime/test/runner-invariants.test.ts` (+ a primitive unit test).
**Gap closed:** everything else for Calendar is built (client `createEvent`, executor branch, poll, wired, scope) — but no primitive emits `calendar.event-create`, so synthesis can never produce a calendar action.
**Steps:** Implement a thin, parameterized primitive that reads context (calendar/email per `effectiveTools`) and emits a `calendar.event-create` step with safely-built `effectArgs` (`{calendarId?, event:{summary,start,end,attendees}}`), `presentation:false`, a `patternKey`, and NO reserved native-draft keys. Keep the trigger/use-case binding out of the primitive (Planner decides).
**Acceptance:** action-level matrix test through real `executeRun` — at **observe**→no output; **draft**→records a Nibbin draft (no native draft, `nativeDraft:false`); **send**→calls `createEvent` once behind idempotency. A composed spec that wires this primitive passes `validateComposedSpec`. **This task is the proof that synthesis→action works for a second connector.**

---

## Phase 2 — Stripe (invoice.nudge)

### Task 4: Stripe reminder write method + wire executor
**Files:** Modify `packages/connectors/src/connectors/stripe.ts` (add a write method, with scope/grant guard); ensure Task 2's `invoice.nudge` branch calls it; tests in connectors + effects-executor.
**Gap closed:** Stripe client is read-only; `invoice.nudge` has no underlying write.
**Steps:** Validate the exact Stripe reminder endpoint (Risk R1), add `sendInvoiceReminder(invoiceId)` (or send_invoice) with a defense-in-depth scope/grant check mirroring `gmail`/`honeybook`; idempotent at the Stripe layer where possible. The existing `nudge-overdue-invoice` primitive already emits `invoice.nudge` — no primitive work.
**Acceptance:** executor test drives `nudge.overdue-invoice` end-to-end at Send → exactly one reminder call; velocity consumed first; read-only methods unchanged.

### Task 5: Wire Stripe connectable + creds (no poll — scheduled)
**Files:** Modify `apps/web/lib/connections/providers.ts` (`CONNECTABLE_PROVIDERS`: add `stripe wired:true`); Vercel env `STRIPE_OAUTH_CLIENT_ID/_SECRET`; `tester_allowlist` seed.
**Gap closed:** Stripe is `wired:false` → "coming soon"; not connectable.
**Steps:** Flip wired; confirm the generic `[provider]` callback handles Stripe Connect OAuth2 (it should via `getOAuthConfigFor`); seed `tester_allowlist (email, 'stripe')` on 3 DBs. **No `connector-poll` change** — Stripe Nibbins run on the schedule tick scanning overdue invoices.
**Acceptance:** a tester can connect Stripe end-to-end (live OAuth round-trip) on staging; an overdue-invoice Nibbin scheduled-run produces a draft (Draft level) / sends a reminder (Send level).

---

## Phase 3 — HoneyBook (dm.reply via sendMessage)

### Task 6: HoneyBook reply primitive
**Files:** Create `packages/runtime/src/primitives/reply-honeybook-inquiry.ts` (or generalize the existing `reply.new-inquiry` pattern); register in `PRIMITIVE_IMPLS` with `effectiveTools:['crm.read','dm.reply']`; tests.
**Gap closed:** no primitive emits `dm.reply` for HoneyBook; client `sendMessage` exists but is unreachable by synthesis.
**Steps:** Thin primitive: reads recent projects/messages (`crm.read`), emits a `dm.reply` step with `{projectId, body}` safely built. Reuse Task 1's `dm.reply` capability + Task 2's executor (HoneyBook branch).
**Acceptance:** action-level matrix test; composed spec validates; draft/send behave correctly.

### Task 7: Wire HoneyBook connectable + liveness + creds
**Files:** `providers.ts` (`honeybook wired:true`); `apps/web/app/api/cron/connector-poll/route.ts` (add a HoneyBook branch — poll messages for new inquiries, derive, dispatch); Vercel env; `tester_allowlist` seed.
**Gap closed:** unwired + not polled.
**Steps:** Validate HoneyBook message-list/delta API (Risk R2). Add poll handling (cursor on last-seen message) mirroring the gmail/calendar delta pattern; seed allowlist on 3 DBs.
**Acceptance:** tester connects on staging; a new HoneyBook inquiry triggers a run that drafts/sends a reply per action level.

---

## Phase 4 — Instagram-DM (dm.reply via sendReply)

### Task 8: Move IG reply grant to a per-Nibbin row (M4 residual) + reply primitive
**Files:** Create `supabase/migrations/<ts>_ig_reply_grant_row.sql` (per-Nibbin `dm.reply` grant, RLS service-role); modify `packages/connectors/src/connectors/instagram.ts` (read grant from the row, not mutable `connection.scopes` lines 6–18); create `packages/runtime/src/primitives/reply-instagram-dm.ts`; tests.
**Gap closed:** KNOWN RESIDUAL — the IG write grant lives in mutable `connection.scopes` (`'nibbin:grant:dm.reply'`) instead of a structural per-Nibbin row; and no primitive emits `dm.reply` for Instagram.
**Steps:** Add the grant row + migration (3 DBs); switch `sendReply`'s guard to the row; build the reply primitive (`effectiveTools:['dm.read','dm.reply']`).
**Acceptance:** IG write blocked unless the per-Nibbin grant row exists; action-level matrix test passes; migration applied to 3 DBs.

### Task 9: Wire Instagram connectable + Meta webhooks + creds (verification-gated)
**Files:** `providers.ts` (`instagram-dm wired:true`); `connector-poll`/webhook route (Meta messaging webhook or poll); Vercel env `INSTAGRAM_DM_OAUTH_CLIENT_ID/_SECRET` + Meta webhook secret; `tester_allowlist` seed.
**Gap closed:** unwired + not event-handled; `META_PENDING`.
**Steps:** Wire connectable + Meta DM webhook (preferred) or poll; seed allowlist. **External blocker: Meta app review** — land behind allowlist; GA waits on review (Risk R3).
**Acceptance:** tester (added as Meta test user) connects; a new IG DM triggers draft/send per action level.

---

## Phase 5 — Pixieset (read-only diagnosis)

### Task 10: Register `gallery.read` + wire Pixieset connectable (read-only)
**Files:** `capabilities.ts` (Task 1 adds `gallery.read`); `providers.ts` (`pixieset wired:true`); Vercel env; `tester_allowlist` seed. No executor, no primitive (read-only).
**Gap closed:** `gallery.read` orphaned from runtime; unwired.
**Steps:** Confirm Pixieset offers a usable OAuth API (Risk R4 — may be partner-gated). Wire connectable; ensure `crm.delivery-latency` scan feeds diagnosis. Runs on schedule (no poll).
**Acceptance:** tester connects; Pixieset findings appear in diagnosis. Read-only — it informs Nibbins, never acts.

---

## Phase 6 — Closeout

### Task 11: Allowlist seeding, env, and the adversarial gate
**Steps:** Seed `tester_allowlist` for all new `(email, provider)` pairs on dev/staging/prod; set all provider OAuth creds + webhook secrets in Vercel; run the **4-reviewer adversarial gate** on the combined write paths (invoice.nudge, dm.reply ×2, calendar.event-create) → `docs/gates/2026-06-22-connector-batch.md`; fix P0/P1; update memory.
**Acceptance:** gate PASS; all migrations verified on 3 DBs; each connector's verification status recorded.

---

## Risks / unknowns to validate BEFORE building the dependent task

- **R1 (Task 4):** exact Stripe reminder/send-invoice endpoint + whether Stripe Connect OAuth scope permits it. If not, `invoice.nudge` may need to nudge via email instead of Stripe-native.
- **R2 (Task 7):** HoneyBook public API availability + a message-list/delta endpoint for liveness, and whether HoneyBook grants third-party API access (may be partner-gated).
- **R3 (Task 9):** Meta app-review timeline + Instagram messaging-webhook eligibility (business-account requirements). Likely the slowest item — sequence last.
- **R4 (Task 10):** Pixieset OAuth/API availability (may be partner-only). If no public API, drop Pixieset from scope.
- **General:** each connector's OAuth app + verification is owner/ops work, parallel to code; code lands behind the tester-allowlist gate regardless.

## Suggested sequencing

Phase 0 → **Phase 1 (calendar proof)** → Phase 2 (Stripe) → Phase 3 (HoneyBook) → Phase 5 (Pixieset, cheap) → Phase 4 (Instagram, verification-gated, last) → Phase 6. Validate R1–R4 before starting each dependent phase; drop any connector whose provider API turns out to be inaccessible.
