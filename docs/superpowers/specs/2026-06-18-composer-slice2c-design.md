# Composer Slice 2c — the digest/summarize shape — Design Spec

**Date:** 2026-06-18
**Status:** Approved-path (Slice 2c of the synthesis-core arc; continues the arc greenlight). Builds on 2a (#139) + 2b (#141). Completes shape-population: after 2c every shipping template has a composable primitive equivalent.
**Goal:** Add the **second structural shape** — **summarize/digest** (read → present, no side effect) — by parity-extracting the two remaining templates (`sweep`, `brief`) into primitives, proving synthesis covers presentation agents and the **3-connector** read aggregation case.

## 1. What 2c adds (and why it's the lowest-risk slice yet)
2a built the mechanism; 2b populated detect-and-nudge across resources + the multi-connector derivation. 2c adds the only remaining shape and templates. **Presentation drafts are strictly lower-stakes than nudges**: they yield a `draft` step with a READ capability (`email.read`) + `presentation: true` — no email is ever sent, the runner presents the digest to the user. So there is *less* safety surface than the nudge family, not more. The 3-connector `brief` reuses 2b's `effectiveTools`-union connector derivation verbatim (it already handles N connectors). Same parity guarantee: each template delegates to the shared primitive impl, bound by a real differential parity test (the 2b lesson).

## 2. The two new primitives (`kind:'primitive'`)
### 2.1 `digest.inbox-cleanup` (from `sweep`)
- **Shape:** `email.read` (mailbox sweep) → group newsletter-ish inbox messages (those with a `List-Unsubscribe` header) by sender → present a top-N "keep or clear" digest. **Presentation only** (no send).
- **Connector:** gmail. **effectiveTools:** `['email.read']`. **sideEffect:** `read` (it only reads + presents; no draft/write side effect).
- **inputSchema:** `{ topSenders: { type:'number', default:5, min:1, max:20 } }` (sweep shows top 5).
- **Impl:** the `sweepProgram` internals (reuse shared `readMailbox`/`header`; the `List-Unsubscribe` filter; per-sender count; top-N; the deterministic digest body; `patternKey:'sweep:keep-or-clear'`; `presentation:true`; `effectArgs:{senders}`).

### 2.2 `digest.morning` (from `brief`) — the 3-connector aggregation
- **Shape:** `calendar.read` (upcoming events) + `payments.read` (overdue invoices) + `email.read` (fresh inbox count) → compose one 3-part morning digest. **Presentation only**.
- **Connectors:** google-calendar **and** stripe **and** gmail. **effectiveTools:** `['calendar.read','payments.read','email.read']`. **sideEffect:** `read`.
- **inputSchema:** `{}` (brief has fixed windows; no scalar knob needed for parity. An empty schema is valid — Slice 2a/2b precedent.)
- **Impl:** the `briefProgram` internals (gcal events window now−1d…now+2d; stripe invoices 90-day window + overdue filter + `$` sum; gmail fresh-mail count over 2 days; the 3-line digest; `patternKey:'brief:morning-digest'`; `presentation:true`; `effectArgs:{events, freshMail, overdue}`). Reads gcal on the gcal connection, stripe on the stripe connection, gmail on the gmail connection (the cross-resource connectionId routing from 2b, now three-way).

## 3. No new mechanism — confirm the existing gates cover presentation primitives
- The `effectiveTools`-union connector derivation (2b) already handles 3 connectors: `digest.morning` only appears in the menu when gcal AND stripe AND gmail are all granted; `validateComposedSpec` checks `requiredConnectors ⊆ accountConnections` for the full set.
- The 2a validator rule "reject a raw non-primitive draft/write composed step" is unaffected: presentation drafts use a READ capability (`email.read`), and they ride a primitive anyway. Presentation drafts have no `effectArgs` that become a side effect (the runner does not execute them), so the `sanitizeEffectArgs` backstop (2b P3) is a harmless no-op on them.
- `digest.morning`'s polite-pause checks ALL THREE connectors **inside** the generator (the 2a P1 lesson), before any read.

## 4. Composer menu, fallback mapping, review UX
- The Composer menu now lists up to 6 primitives. The no-key fallback `mapWorkflowToPrimitive` gains: an inbox-overwhelm / triage / unsubscribe / newsletter signal → `digest.inbox-cleanup`; a morning-planning / daily-overview / "stay on top of things" signal → `digest.morning`. Still only ever returns an available primitive; still `validateComposedSpec`-gated.
- Per-primitive review summaries gain two sentences ("scan your inbox each morning for newsletter pile-ups and show you a one-tap clear list — nothing is deleted without you"; "every morning, pull your day together — next on the calendar, fresh mail, and any overdue invoices — into one short brief"). Emphasize **read-only / nothing-sent** for the digests in the review card.

## 5. Scope / boundaries
- **In (2c):** the 2 digest primitives (parity-extracted + template delegation); menu/fallback/summary updates; the differential parity test extended to all 6 templates; behavioral test for `topSenders`; validator + e2e tests for both (incl. the 3-connector grant/missing cases).
- **Out (later):** multi-primitive composition (chaining primitives); editing the proposed spec; Planner (Slice 3); Crystallization (Slice 4). With 2c done, ALL 6 templates have primitive equivalents — the synthesis loop generalizes fully; the next frontier is composition + the Planner, not more single-shape primitives.

## 6. Gating + tests
- **Gated** (`packages/runtime` + composer path) → `docs/gates/` report + 4-reviewer adversarial gate. **No migration**.
- **Security testing:** presentation primitives are read-only (no send); the LLM still picks id + scalar params only; 3-connector derivation is server-side from the registry; menu hides `digest.morning` unless all 3 connectors granted; validator fail-closed; polite-pause checks all connectors inside the generator. Parity guards delegation in CI.
- **Tests:** differential parity (drive the real `sweepProgram`/`briefProgram` via `buildProgram` vs the primitive, deep-equal yielded steps — extend the existing `programs.parity.test.ts` to all 6); `topSenders` behavioral (non-default N changes the digest list length); validator rejects `digest.morning` when any of the 3 connectors is missing (test each missing one); e2e (a digest steps-spec runs `interpretSpec`→`executeRun` with path-aware reader stubs for all sources → an `awaiting_approval`/presentation outcome carrying the digest); Composer no-key fallback maps a triage workflow → `digest.inbox-cleanup` and a daily-overview workflow → `digest.morning`, both passing `validateComposedSpec`.
- **Verify:** tsc (runtime + web) + vitest + eslint + `next build`.
