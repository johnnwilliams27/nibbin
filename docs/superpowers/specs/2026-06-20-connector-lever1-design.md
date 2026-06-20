# Connector Lever 1 — Generic OAuth Callback + Google Calendar

**Date:** 2026-06-20
**Status:** Design approved, pending spec review
**Scope:** Generalize the OAuth-landing infrastructure so any wired connector can complete a connect, then light up Google Calendar as the first connector to use it. Unify the scan window to 12 months across all connectors.

---

## 1. Background & Problem

Today **only Gmail is genuinely connectable** end-to-end. The backend registry (`packages/connectors/src/registry/registry.ts`) marks ~21 connectors `availability: 'live'`, but that flag is aspirational: the verification audit (2026-06-20) found that only Gmail has the full chain (OAuth config → callback route → client class → vault token → UI connect → active polling). The poll route even hard-codes `if (connection.provider !== 'gmail') continue;`.

Five hand-built `[H]` connectors — **google-calendar, stripe, honeybook, pixieset, instagram-dm** — already have an OAuth provider config *and* a written client class, but are blocked by three things:
1. `wired: false` in `CONNECTABLE_PROVIDERS` (`oauth/providers.ts`),
2. **no generic callback route** — only `/api/connect/google/callback` exists, so a second connector's OAuth round-trip has nowhere to land,
3. no API credentials in the environment.

Four of the five (Stripe, HoneyBook, Pixieset, Instagram) need external developer credentials only the owner can obtain. **Google Calendar is the exception**: it reuses Gmail's existing, already-CASA-declared Google OAuth app, so it needs no new credentials and no new vendor relationship. It is the one connector we can fully light up with code alone.

This slice therefore builds the **generic callback infrastructure once** (paying off for all future connectors) and **proves it with Google Calendar**, leaving the other four "drop in a secret → flip a flag" ready.

## 2. Goals / Non-Goals

**Goals**
- A single, audited, provider-parameterized OAuth callback route that any wired connector uses.
- Google Calendar fully connectable: connect → read-only scan → poll-based liveness.
- Scan window unified to **12 months** across every connector (matching the Gmail onboarding sweep), with the month-derived math fixed so it can't drift.
- Human-actionable front-end error states for every failure path.

**Non-Goals (this slice)**
- Lighting up Stripe / HoneyBook / Pixieset / Instagram (blocked on external credentials — left ready, not wired).
- Google Calendar **push** (`watch` channel) webhooks — cron polling only; push is a follow-up.
- Any aggregator (`[A]`) integration — that is the separate "Lever 2" project and needs a subprocessor/privacy decision.
- Incremental-consent sharing of one Google connection across services (see §4 — we chose separate connections).

## 3. Key Decisions (locked with owner)

1. **Scope:** Infra + Google Calendar only. Other four left credential-ready.
2. **Connection model:** **Separate connection per connector** (Option B). Google Calendar is its own `connection` row with `provider = 'google-calendar'` and its own vault token, independent of the Gmail row. Same Google OAuth *app* (one client_id/secret), separate consent round-trip and token. This matches the existing one-connection-per-provider code (no refactor of the connection↔connector mapping) and means disconnect/revoke/scan-purge operate per-row — tearing down Calendar never touches Gmail.
3. **Callback route:** **One dynamic route** `/api/connect/[provider]/callback` (Approach 1). Provider-specific differences are pure config (endpoints, scopes) plus an optional small handler hook. The dangerous parts (state validation, vault sealing, same-origin `returnTo`) live in exactly one audited place.
4. **Window:** **12 months across the board**, single source of truth.

## 4. Architecture

Two halves: **(a) generalize the OAuth landing infrastructure**, and **(b) light up Google Calendar** on top of it.

### 4.1 Components

| Change | File(s) | Type |
|---|---|---|
| Dynamic OAuth callback | `apps/web/app/api/connect/[provider]/callback/route.ts` | **new** |
| Shared exchange→seal→redirect helper | extracted from `apps/web/app/api/connect/google/callback/route.ts` | refactor |
| Existing Google callback | `apps/web/app/api/connect/google/callback/route.ts` | thin shim / 301 → keeps working |
| Generalized initiate (authorize URL builder + pending-auth row) | connect-initiate path | refactor |
| Wire `google-calendar` | `oauth/providers.ts` (`wired: true`), `catalog.ts` (`coming_soon`→`live`) | config flip |
| Poll capability check | poll route (replace `provider !== 'gmail'`) | refactor |
| Scan window → 12 months | `packages/connectors/src/types.ts` + dependents | refactor |
| Front-end error states | connections UI | new |

`google-calendar.ts` (client class) and `packages/scan/src/modules/calendar.ts` (scan module) **already exist** — they are wired in, not written.

### 4.2 The dynamic callback route

`/api/connect/[provider]/callback` runs the same security-critical sequence the Google route does today, parameterized:

1. **Validate `[provider]`** against an allowlist derived from `CONNECTABLE_PROVIDERS` where `wired === true`. Unknown or un-wired provider → reject (front-end error state, see §6). This is the injection guard Approach 1 requires.
2. **Consume the `oauth_pending_authorizations` row** keyed by `state` (single-use, TTL'd, service-role; no cookie). Mismatch/expired/missing → reject.
3. **Look up provider OAuth config** from `oauth/providers.ts` by provider id and **exchange the code** via the existing `oauth/flow.ts` engine (PKCE verifier from the pending row).
4. **Seal tokens into the vault** (`connection_token_store`) and create/update the connection row scoped to this connector id. Tokens never touch app tables, logs, or redirects.
5. **Validate `returnTo`** same-origin `/app/`, then redirect (success or error state).

The **initiate** side is generalized symmetrically: build the authorize URL from `providers.ts` per provider id and write the pending-auth row. Provider-specific response quirks stay in each client class, not the route.

## 5. Connection model & scope ladder (Google Calendar)

- **Connect creates** a `provider = 'google-calendar'` connection row + vault token, independent of Gmail.
- **First connect = `calendar.readonly`** — read-only; the only scope requested at connect. The diagnosis sweep needs to see the calendar, nothing more.
- **Write = `calendar.events`** — escalated **per-Nibbin at runtime**, exactly like Gmail's `compose`: gated by the double-check (connection scope grant + `nibbin_write_grants`), never handed out at connect.
- **Calendar writes** (creating/modifying events) flow through the same `send_velocity` + write-grant + approval guardrails as outbound email, so an agent cannot silently spray calendar invites.

This preserves the established "read on Day One, write is earned and per-Nibbin" invariant — no new permission paradigm.

## 6. Front-end error handling (explicit requirement)

Every failure path renders a **human-actionable** error state in the connections UI — a clear reason and a next step — never a silent redirect, a generic message, or a leaked raw provider error. Failure paths to cover:

- **Connect rejected/cancelled at Google** (user denied consent) → "You didn't finish connecting Google Calendar. Try again." + retry affordance.
- **Invalid/expired/missing `state`** → "That connection link expired. Please start the connection again." + restart affordance.
- **Code-exchange failure** (Google rejected the exchange) → reason + retry, no raw error surfaced.
- **Vault-seal failure** (our side) → "Something went wrong saving your connection. Please try again." + the failure is logged server-side (without tokens).
- **Unknown / un-wired provider** → generic not-available state (should be unreachable via UI; guards the injection case).
- **Tester-allowlist block** (unverified Google app, >100 cap or non-allowlisted user) → an explicit "Google Calendar is in limited testing" state, consistent with the existing Gmail allowlist UX.

Errors carry a reason code and a trace id server-side; the UI shows the human message, not the code. Token material never appears in a redirect URL, log line, or error body.

### Token refresh & degradation
- Calendar inherits the connector base's **refresh-on-401 + single-retry + re-seal** (PR #115), so a stale calendar token self-heals rather than dying.
- A calendar fetch error degrades that connection's findings without aborting other connectors' sweeps; the fan-out ceiling of 5 / DEFER-don't-drop behavior is unchanged.

## 7. Scan, liveness & the 12-month window unification

### 7.1 Window unification (cross-cutting, all connectors)
There are two window concepts in the code, currently out of sync:
- The **Gmail onboarding sweep** (`api/sweep/gmail/onboarding/route.ts`) already reads **~12 months**.
- The **scan-engine window** (`packages/connectors/src/types.ts` → `SCAN_WINDOW_DAYS = 90`) is still **90 days**. This is the lookback **every** scan module computes findings over (email, crm, payments, dm, calendar).

Change:
- Replace `SCAN_WINDOW_DAYS = 90` with a single source of truth — **`SCAN_WINDOW_MONTHS = 12`** — deriving days from it.
- **Fix the month-derived math keyed to the old 90-day ≈ 3-month assumption.** `payments.ts` divides fee/subscription totals by `3` to get a monthly figure (lines ~109, ~144); these must be driven by `SCAN_WINDOW_MONTHS` so a 12-month window yields a correct monthly average (otherwise dollar-per-month figures come out 4× too high). Driving them off the constant prevents future drift.
- Sweep all "90 days" / "in 90 days" basis strings and comments: `crm.ts`, `payments.ts`, and comments in `types.ts`, `engine.ts`, `index.ts`, `google-calendar.ts`, plus the `package.json` description.
- This lands as its **own clearly-scoped step** in the plan (it touches all connectors' findings), with existing module tests re-run to catch magnitude shifts.

### 7.2 Calendar scan
The `calendar.ts` scan module computes over the 12-month window and emits **derived-only** findings (e.g., meeting density, double-bookings, back-to-back load) into the `SweepDerived` path. Raw event bodies are **never persisted** — same discipline as the Gmail sweep.

### 7.3 Liveness
Replace the poll route's `provider !== 'gmail'` hard-code with a **provider-capability check** so `google-calendar` rides the existing `*/5` cron. **Cron polling only this slice.** Google's push `watch` channel is deferred to a follow-up.

## 8. Testing

- **Callback route** — unit tests (mirror `connect-callback.test.ts`): happy path (state consumed → token sealed → connection row created), each rejection branch, the provider-allowlist guard, same-origin `returnTo` enforcement.
- **Window unification** — assert `SCAN_WINDOW_MONTHS = 12`, that derived-days math is correct, and that payments' monthly divisor tracks the constant (anti-drift lock).
- **Calendar module** — re-run existing module tests over the 12-month window; add coverage for the derived findings.
- **Front-end error states** — each failure path renders the intended human-actionable message and leaks no token/raw error.
- **Lint / typecheck / full test suite** green before PR (run `npm run lint`, `npm run typecheck`, and the test suite — not just one).

## 9. Security

This touches OAuth, the token vault, and an open-redirect surface, so per standing rule it goes through the **4-reviewer adversarial gate** (red-team / claims-auditor / logic-skeptic / cost-auditor) before merge, with the report written to `docs/gates/`.

**Invariants preserved:** one Google OAuth app (no new credentials); tokens only in the vault, never app tables/logs/redirects; `calendar.readonly` at connect with write earned per-Nibbin; tester-allowlist gating still applies; quarantine markers wrap all calendar content before any model sees it; same-origin `returnTo`.

## 10. Out of scope / follow-ups

- Wiring Stripe / HoneyBook / Pixieset / Instagram once their credentials exist (the route + flag pattern is ready for them).
- Google Calendar push (`watch`) webhooks for sub-5-minute freshness.
- Lever 2: aggregator (Nango/Composio) integration to bulk-enable the 10 `[A]` connectors — separate project, needs a subprocessor/privacy decision.
