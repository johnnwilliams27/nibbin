# Composer Slice 2b — the detect-and-nudge family (generalize across resources) — Design Spec

**Date:** 2026-06-18
**Status:** Approved-path (Slice 2b of the synthesis-core arc; continues the "keep going" greenlight on the arc). Builds on Slice 2a (#139). Design: `2026-06-17-agent-synthesis-design.md` §4; primitive mechanism: `2026-06-18-composer-slice2a-design.md`.
**Goal:** Prove the primitive mechanism **generalizes** by parity-extracting the three remaining **detect-and-nudge** templates into composable primitives, so a diagnosis can synthesize nudges over **payments** and **calendar** (incl. the **cross-resource** read-calendar→draft-email case), not just overdue email.

## 1. What 2b adds (and why it's low-risk)
Slice 2a built the whole mechanism — the primitive descriptor (`kind:'primitive'` + `inputSchema` + `effectiveTools` + `implement`), interpreter dispatch, the fail-closed `validateComposedSpec`, custom adoption, and the review-before-adopt UX. **2b only populates the registry** with three more primitives, each lifted from an existing reviewed template the same way `nudge.overdue-email` was lifted from `echo` (the template program delegates to the shared impl → byte-for-byte parity). No new safety surface; the LLM's freedom is still "pick a primitive id + schema-validated scalar params."

The 6 templates embody two shapes: **detect-and-nudge** (`echo`✓ `tally` `hopper` `scribe`) and **summarize/digest** (`sweep` `brief`). 2b finishes detect-and-nudge. The digest shape is 2c (different shape: presentation drafts, `brief` is multi-connector).

## 2. The three new primitives (all `kind:'primitive'`)
Each lives in `packages/runtime/src/primitives/`, exports a parameterized `ProgramFn` factory, is registered in `CAPABILITY_REGISTRY` + `PRIMITIVE_IMPLS`, and is delegated-to by its template program in `apps/web/lib/runtime/programs.ts`.

### 2.1 `nudge.overdue-invoice` (from `tally`)
- **Shape:** `payments.read` → detect overdue open invoices (oldest first) → draft `invoice.nudge` for the worst one.
- **Connector:** stripe (single). **effectiveTools:** `['payments.read','invoice.nudge']`.
- **inputSchema:** `{ minDaysLate: { type:'number', default:0, min:0, max:120 } }` (tally today nudges any past-due; the param lets synthesis set a grace window). Default 0 = tally's exact behavior.
- **Impl:** the `tallyProgram` internals (stripe invoice list path, overdue filter, worst-first sort, the deterministic nudge body, `effectArgs:{invoiceId, amountCents}`), parameterized by `minDaysLate`.

### 2.2 `nudge.unconfirmed-event` (from `hopper`) — the cross-resource case
- **Shape:** `calendar.read` (gcal) → detect upcoming events with an unconfirmed external guest → draft `email.draft` (gmail) to the guest.
- **Connectors:** google-calendar **and** gmail. **effectiveTools:** `['calendar.read','email.draft']`.
- **inputSchema:** `{ withinDays: { type:'number', default:7, min:1, max:60 } }` (hopper's 7-day horizon).
- **Impl:** the `hopperProgram` internals (gcal events path, unconfirmed-attendee filter, `safeAddress` on the guest email, the confirmation body, `effectArgs:{eventId, to}`), parameterized by `withinDays`. The factory reads `connMap['google-calendar']` and drafts on `connMap.gmail`; if either is missing it throws the polite pause **inside** the generator (the Slice-2a P1 lesson).

### 2.3 `reply.new-inquiry` (from `scribe`)
- **Shape:** `email.read` → detect a NEW unanswered first-contact inquiry (no `In-Reply-To`, not bulk, no sent reply on the thread), newest first → draft a warm first reply (model draft, deterministic fallback).
- **Connector:** gmail (single). **effectiveTools:** `['email.read','email.draft']`.
- **inputSchema:** `{}` (no scalar knob — first-contact detection isn't day-parameterized; an empty schema is valid and already supported).
- **Impl:** the `scribeProgram` internals (reuse the shared `readMailbox`/`header`; the first-inquiry filter; the inquiry-reply prompt + fallback; `patternKey:'email.draft:inquiry-reply'`; `effectArgs:{threadId, subject:'Re: …'}`).

## 3. The one generalization 2b forces: multi-connector requiredConnectors/allowlist
`nudge.unconfirmed-event` needs **two** connectors, but `CapabilityDescriptor.requiredConnector` is a single string. So:
- The Composer (`compose.ts`) must build a composed spec's `requiredConnectors` and `toolsAllowlist` from the chosen primitive's **`effectiveTools`** — for each effective tool, look up its atomic descriptor's `requiredConnector`; the spec's `requiredConnectors` = the unique set, `toolsAllowlist` = the effectiveTools. (Slice 2a hard-coded `[requiredConnector]` + `effectiveTools`; this replaces the connector derivation with the union over effectiveTools.)
- The available-primitive menu shown to the LLM is filtered to primitives whose **every** derived connector ∈ the account's active connections (a cross-resource primitive only appears if BOTH connectors are connected).
- `validateComposedSpec` already checks `requiredConnectors ⊆ accountConnections` and `toolsAllowlist ⊇` the yielded tools — both hold for the multi-connector case once the spec is assembled correctly. No validator change needed beyond confirming it.

This keeps the descriptor pure (single `requiredConnector` stays as the primitive's "home" resource for display); connectors that matter for gating are derived from `effectiveTools`, the same field the runner gates on.

## 4. Composer prompt + review UX
- The Composer prompt lists ALL available primitives (now up to 4) with a one-line description + their `inputSchema`, and asks the LLM to choose the one that best fits the workflow's category/friction. The deterministic no-key fallback picks the primitive whose resource matches the workflow's category (email→nudge.overdue-email or reply.new-inquiry; payments/invoice→nudge.overdue-invoice; calendar/scheduling→nudge.unconfirmed-event), defaulting to `nudge.overdue-email` if ambiguous. Still validator-gated; an off-menu/invalid pick → deterministic fallback.
- The review-before-adopt card (`BuildNibbinButton`) renders a per-primitive human summary ("watch your Stripe invoices for ones more than N days past due → draft a gentle payment nudge for your approval"; "watch your calendar for unconfirmed guests in the next N days → draft a confirmation email"). One summary function keyed by primitive id.

## 5. Scope / boundaries
- **In (2b):** the 3 detect-and-nudge primitives (parity-extracted + template delegation); the multi-connector requiredConnectors/allowlist derivation; the menu/prompt expansion; per-primitive review summaries; parity + validator + e2e tests for each.
- **Out (2c+):** the digest/summarize shape (`sweep`, `brief`); multi-primitive composition; editing the proposed spec; Planner (Slice 3); Crystallization (Slice 4).

## 6. Gating + tests
- **Gated** (`packages/runtime` + composer/adopt path + connectors-touching) → `docs/gates/` report + 4-reviewer adversarial gate. **No migration** (adopt_nibbin v2 already live on 3 DBs; 2b adds no schema).
- **Security testing:** unchanged thesis — the LLM picks primitive id + scalar params only; the cross-resource primitive still builds all paths/effectArgs in trusted code; the multi-connector derivation is computed server-side from the registry, never from LLM output; the menu hides primitives whose connectors aren't granted; validator fail-closed (requiredConnectors ⊆ granted, allowlist ⊇ yielded tools). Each primitive's polite-pause throws **inside** the generator (Slice-2a P1).
- **Tests (per primitive):** parity — the template program and the primitive yield identical steps/effectArgs on the same fixture; validator — a composed spec for the primitive validates with its connectors granted and is rejected when a required connector is missing (esp. the cross-resource case: gcal-only is rejected for `nudge.unconfirmed-event`); e2e — a steps-spec runs through `interpretSpec`→`executeRun` with a path-aware reader stub and produces the expected `awaiting_approval` draft. Composer — no-key fallback maps each workflow category to the right primitive and the result passes `validateComposedSpec`.
- **Verify:** tsc (runtime + web) + vitest + eslint + `next build` (the four that gate; 2a's lesson).
