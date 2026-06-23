# P4 — Nango Connector Lane Design

**Date:** 2026-06-22
**Status:** DRAFT — awaiting human prereqs (see §7)
**Decision ref:** D17; ADR `docs/decisions/2026-06-22-connector-strategy-diy-vs-aggregator.md` (now partially superseded — the inflection condition is met for the out-of-box lane)
**Do NOT build until §7 is resolved.**

---

## 1. What this spec covers

D17 adopts Nango as a **second, parallel connector lane** for out-of-the-box SaaS providers. This is a **contained migration, not a replatform**:

- Gmail, Google Calendar, and Stripe are moved onto Nango's OAuth + token-lifecycle machinery.
- The existing hand-built clients (`GmailClient`, `GoogleCalendarClient`, `StripeConnectorClient`) and their primitive vocabulary remain unchanged.
- The generic MCP/API rail (`rails/mcp.ts`, `method:'G'` connectors) is **retained and untouched** as the proprietary-system lane.
- Every safety invariant — C8 send-velocity, C9 vault-only tokens, egress allowlist, quarantine, action-level gate — is preserved in full. Nango sits below the primitive boundary, not inside or above it.

---

## 2. How Nango slots in

### 2.1 The two-lane model

```
CONNECTIONS UI
    │
    ├─ [N] Nango lane  ─────────────────────────────────────────────────────┐
    │     Gmail · Google Calendar · Stripe (and future out-of-box providers) │
    │     Nango handles: OAuth initiation, callback, access-token refresh    │
    │     Nibbin holds: the Nango connection-id in Supabase connections table│
    │     At use time: Nibbin calls Nango proxy() → Nango injects token      │
    │     Token custody: Nango (cloud) or our infra (self-hosted) — see §4   │
    └───────────────────────────────────────────────────────────────────────┘
    │
    ├─ [H] Hand-built lane  ─────────────────────────────────────────────────┐
    │     HoneyBook · Pixieset · Instagram-DM (any future provider whose     │
    │     OAuth2 flow or write semantics differ enough to warrant DIY)        │
    │     Unchanged: oauth/flow.ts + oauth/providers.ts + HttpConnectorClient │
    └───────────────────────────────────────────────────────────────────────┘
    │
    └─ [G] Generic MCP/API rail  ────────────────────────────────────────────┐
          User-supplied MCP URLs; IMAP/SMTP; CalDAV; CSV; webhooks           │
          McpRailClient unchanged; deny-by-default safeFetch; no OAuth       │
          This is the proprietary/company-system lane — NO Nango.            │
          Preserved exactly as-is (rails/mcp.ts).                            │
          ─────────────────────────────────────────────────────────────────  │
```

The registry `ConnectorDescriptor.method` field gains a fourth value `'N'` (Nango-managed). The existing `'H'`, `'A'`, `'G'` values are unchanged.

### 2.2 Cloud Nango vs. self-hosted

Two deployment options; the choice is a human decision (see §7).

| Dimension | Nango Cloud | Self-hosted (Docker) |
|---|---|---|
| Token custody | Nango's AES-256-GCM vault on their infra | Our infra; we hold all tokens |
| Ops burden | None | Container fleet management, upgrades |
| Data residency | Nango's servers (US/EU selectable) | Our choice |
| GDPR subprocessor | Nango becomes a subprocessor — DPA required | No new subprocessor |
| Cost | Usage-based (~$0.01/connection/month at volume) | Self-hosted free (ELv2 license) |
| Privacy posture | Acceptable per ADR §Context ("connector data is cloud-but-disciplined") | Ideal for privacy moat |
| Time-to-first-connect | ~1 day (sign up, set env vars, configure integration) | ~2–3 days (Docker, config, network) |

**Recommended path:** start with Nango Cloud for velocity; migrate to self-hosted when connection count and ops capacity make it worthwhile. The code is identical in both cases — only the `NANGO_HOST` env var changes.

### 2.3 What Nango takes over vs. what stays in-house

| Concern | Current owner | Post-Nango owner |
|---|---|---|
| OAuth redirect URL construction | `oauth/flow.ts` `beginConnectAuthorization()` | Nango (its hosted OAuth UI or its `nango.auth()` SDK call) |
| State parameter + PKCE | `oauth/flow.ts` `generateState()` + `codeChallengeS256()` | Nango (internal) |
| Code exchange + token endpoint POST | `oauth/flow.ts` `exchangeCode()` | Nango |
| Tester-allowlist gate | `flow.ts` `enforcePlatformGate()` | **Stays in Nibbin** — Nango has no concept of our tester-gate; the platform gate must be re-checked at the Nibbin layer before redirecting to Nango's auth flow |
| Access token storage | `SupabaseTokenVault` (`vault.store()` / `vault.read()`) | Nango vault; the Supabase `connections` row stores Nango's `connectionId` + `providerConfigKey` instead of a raw token |
| Refresh-on-401 | `HttpConnectorClient.tryRefresh()` → `refreshAccessToken()` → re-seal vault | Nango (transparent; happens inside `nango.proxy()` automatically) |
| Per-request token injection | `vault.read()` → `authorization: Bearer ${token.accessToken}` in `HttpConnectorClient.request()` | `nango.proxy({ connectionId, providerConfigKey, endpoint, ... })` — Nango injects the current valid token before forwarding |
| Egress allowlist enforcement | `safeFetch` `allowedHosts` | **Stays in Nibbin** — Nango proxy does not enforce our allowlist. The `NangoConnectorClient` (see §3.1) must re-verify the target hostname against the registry descriptor's `egressAllowlist` before issuing the proxy call. |
| Response quarantine | `quarantine()` after every `request()` | **Stays in Nibbin** — quarantine wraps Nango's proxy response exactly as it wraps the current `safeFetch` response. |
| Webhook registration | Gmail `watch()` / Calendar `watchEvents()` | **Stays in Nibbin** — Nango does not manage provider-push subscriptions for us; `GmailClient.watch()` and `GoogleCalendarClient.watchEvents()` remain the callers. The underlying HTTP call goes through the Nango proxy. |
| Send-velocity caps | `SendVelocityLimiter` / `send_velocity_consume` RPC | **Stays in Nibbin** — velocity is a Nibbin application invariant, not transport. |
| Scope-at-connect enforcement (`requireGrantedScope`) | `GmailClient.requireGrantedScope()` | **Stays in Nibbin** — Nango stores the scopes it obtained; we must read them back and enforce the same check. |
| `oauth/flow.ts`, `oauth/providers.ts` | Nibbin codebase | Kept but no longer called for `[N]` providers. The [H] providers (HoneyBook, Pixieset, Instagram-DM) continue to use them unchanged. |

---

## 3. Migration path: Gmail, Google Calendar, Stripe

### 3.1 `NangoConnectorClient` — new base class

A new `packages/connectors/src/connectors/nango-base.ts` implements the same interface contract as `HttpConnectorClient` but issues requests through Nango's proxy instead of `safeFetch` + vault:

```
NangoConnectorClient
  ├── connection: Connection      (same as HttpConnectorClient)
  ├── descriptor: ConnectorDescriptor
  ├── nango: Nango                (Nango server-side SDK instance)
  │
  ├── request(path, init) → SafeResponse
  │     1. Assert connection.status === 'active'
  │     2. Assert target hostname ∈ descriptor.egressAllowlist
  │        (allowlist re-check: Nango proxy does NOT enforce this)
  │     3. Call nango.proxy({ connectionId, providerConfigKey, endpoint: path, method, ... })
  │        → Nango fetches, injecting a valid (auto-refreshed) access token
  │     4. If 401/403 returned by proxy (refresh also failed upstream):
  │        throw ConnectorRequestError(provider, status, 'auth')
  │        — the connection must be re-authorized (user must reconnect)
  │     5. If 429: throw ConnectorRequestError(provider, status, 'rate-limit')
  │     6. Return SafeResponse-shaped wrapper over Nango's response
  │
  ├── read(path) → QuarantinedContent      (same signature as HttpConnectorClient)
  └── readJson<T>(path) → { data: T; quarantined: QuarantinedContent }
```

`GmailClient`, `GoogleCalendarClient`, and `StripeConnectorClient` are updated to extend `NangoConnectorClient` instead of `HttpConnectorClient`. **All their public methods are unchanged.** The only internal diff is that `super(...)` receives a `Nango` instance instead of a `TokenVault`.

Factory functions (`makeGmailClient(connection, nango)` vs. `makeGmailClient(connection, vault)`) are the injection point. Tests can supply a mock `Nango` object.

### 3.2 Connection record changes

The `connections` Supabase table grows two columns (new migration):

| Column | Type | Purpose |
|---|---|---|
| `nango_connection_id` | `text` nullable | Nango's opaque connection identifier |
| `nango_provider_config_key` | `text` nullable | Nango's integration key (e.g. `'google-mail'`, `'stripe'`) |

For `[N]` connections these are non-null; `access_token`/`refresh_token` in the vault row become unused (the row is retained for RLS and FK integrity but tokens are stale/zeroed). For `[H]`/`[G]` connections both new columns are null — no change.

The disconnect flow for `[N]` connections calls `nango.deleteConnection(connectionId, providerConfigKey)` before marking the row `revoked` (same as the current vault revoke pattern).

### 3.3 Connect flow changes per provider

**Before (current [H] flow):**
1. UI form → `beginConnectAction` → `beginConnectAuthorization()` → redirect to provider's OAuth URL
2. Provider callback → `/api/connect/[provider]/callback` → `exchangeCode()` → `vault.store()` → row `active`
3. `testerAllowlist.isAllowed()` gated inside `beginConnectAuthorization()`

**After (Nango [N] flow):**
1. UI form → server action → tester-gate check (same `enforcePlatformGate` logic, but now called directly — not via `beginConnectAuthorization()`) → redirect to Nango's hosted OAuth flow URL (or call `nango.auth()` on the client side — whichever pattern Nango recommends for Next.js server components)
2. Nango's OAuth callback → Nango stores token in its vault → Nango fires a webhook (or the client-side SDK resolves) → Nibbin records `nango_connection_id` + `nango_provider_config_key` in the `connections` row → row `active`
3. Scopes granted are read back from Nango (`nango.getConnection(...)` exposes `credentials.raw.scope`) and stored in `connections.scopes` as before — the `requireGrantedScope` and `isReadOnly` checks remain valid

The `oauth/flow.ts` `beginConnectAuthorization` and `exchangeCode` functions are NOT called for `[N]` providers. The `OAUTH_PROVIDERS` config entries for `gmail`, `google-calendar`, `google-drive`, `google-sheets-docs`, and `stripe` become dead code for the Nango lane but are retained so `[H]` path tests remain green during the transition.

### 3.4 Scope fidelity — the C8 / write-scope / send-velocity invariants

These are the most load-bearing safety constraints. Each is preserved:

**Gmail write scopes (`gmail.compose`, `gmail.send`)**
- Requested at connect: Nango integration configured with the same full scope list (`gmail.readonly` + `gmail.compose` + `gmail.send`) — the owner-approved Connector Lever 1 connect-time scope model is preserved.
- `GmailClient.requireGrantedScope(SCOPE_SEND)` reads `connection.scopes` (populated from Nango's `credentials.raw.scope` at connect time). This check is unchanged.
- Send-velocity: `SendVelocityLimiter` / `send_velocity_consume` RPC runs before the Nango proxy call, same as today.

**Google Calendar write scope (`calendar.events`)**
- Nango integration configured with `calendar.readonly` + `calendar.events` (same as registry descriptor).
- `GoogleCalendarClient.createEvent()` `requireGrantedScope` check unchanged.

**Stripe read-only (`read_only`)**
- Stripe stays read-only. Nango is configured with Stripe Connect OAuth and `read_only` scope only. No write scope is added — the ADR "Option B" decision (overdue-invoice nudges via Gmail, not Stripe native) is unchanged.
- `send` velocity caps on the registry descriptor entry for Stripe are vestigial (no outbound Stripe write) — left in place, they fire on nothing.

**Google tester allowlist (100-user cap)**
- The platform gate (`enforcePlatformGate` in `oauth/flow.ts`) must be extracted into a standalone function callable from the Nango connect action — it must NOT be removed just because `beginConnectAuthorization` is no longer called. The 100-user tester cap is still required until Google CASA + OAuth verification clears.

**Webhook registration**
- Gmail Pub/Sub `watch()` and Calendar channel `watchEvents()` are called after connect, using the `NangoConnectorClient` proxy. Nango has no awareness of these push subscriptions; Nibbin manages them identically to today.

---

## 4. Security: egress, token custody, privacy posture

### 4.1 Token custody

The central security question is: **does a third party now hold the user's OAuth tokens?**

- **Nango Cloud:** Yes — Nango's AES-256-GCM vault on their infrastructure. This is the same posture as any SaaS OAuth broker. The ADR explicitly accepted this ("connector data is cloud-but-disciplined; the owner has ruled connector data flowing through a third-party processor is acceptable"). The tokens are access tokens, not user data. Nango holds them no differently from how Supabase currently holds them (AES-256 Vault). A DPA must be executed with Nango.
- **Self-hosted Nango:** Nibbin holds all tokens in its own infrastructure. Token custody is equivalent to today's Supabase Vault; no new subprocessor.

### 4.2 Egress

The existing `safeFetch` + `egressAllowlist` enforcement for `[H]` connectors is partially replaced:

- For `[N]` connectors, Nango's proxy issues the actual HTTP request; our `safeFetch` no longer sits on that path.
- **Mitigation:** `NangoConnectorClient.request()` re-checks the target URL against `descriptor.egressAllowlist` BEFORE calling the proxy. This is a Nibbin-layer enforcement, not a network-layer enforcement. It is defense-in-depth rather than a hard network fence. The risk delta is small: the target hosts (Gmail API, Google OAuth, Stripe API) are fixed and well-known; the allowlist check remains in our trusted code.
- For `[H]` connectors (HoneyBook, Pixieset, Instagram-DM): `safeFetch` egress enforcement is unchanged.
- For `[G]` connectors (MCP rail): `safeFetch` deny-by-default egress enforcement is unchanged.

### 4.3 Quarantine

Response quarantine (`quarantine()`) is applied to every Nango proxy response in `NangoConnectorClient.read()` and `readJson()`. This is identical to today's pattern. No external data reaches the LLM without passing through quarantine.

### 4.4 Privacy-first posture (screen capture moat)

The on-device screen capture (C7) remains the privacy moat. Nango does not interact with the capture layer. The derived-not-raw principle for connector reads is unchanged — scan modules derive structured findings from raw responses; raw bodies are never persisted to our tables. Nango's proxy is a pass-through transport; it does not log or store response bodies (verify in Nango's DPA / data handling documentation before go-live).

### 4.5 Supabase Vault token rows for `[N]` connections

On the Nango lane the vault row is not populated with a live token. Options:
1. Leave the vault row empty (null access_token) — cleanest; no stale token at rest in our DB. The `connections.nango_connection_id` is the reference.
2. Populate the vault row with a sentinel (e.g. `access_token = 'NANGO_MANAGED'`) — preserves FK assumptions if any code path reads the vault row before checking `method`.

**Recommended:** option 1 (null vault row). All code paths that read the vault must be gated on `descriptor.method === 'N'` to skip vault reads — a small audit is required at build time.

---

## 5. Connections UI: two-lane presentation

The Connections page (`apps/web/app/app/connections/page.tsx`) and the `CONNECTABLE_PROVIDERS` list (`apps/web/lib/connections/providers.ts`) require no structural change. The connect action diverges by `method`:

```
beginConnectAction(provider):
  descriptor = getConnector(provider)
  if descriptor.method === 'N':
    → tester-gate check (enforcePlatformGate equivalent)
    → redirect to Nango hosted connect URL
  else if descriptor.method === 'H':
    → existing beginConnectAuthorization() path (unchanged)
  else:
    → [G] generic rail: credential form (unchanged)
```

From the user's perspective both `[N]` and `[H]` lanes look identical: "Connect Gmail" → consent screen → redirect back → active badge. The lane is invisible to the user.

The `scopeSummary()` and `isReadOnly()` utility functions read from `connections.scopes`, which is populated from Nango's granted scope string at connect time — same format as today. No UI change needed.

The `ConnectorDirectory` (`CONNECTORS` catalog) is unchanged. A `[N]` provider does not need a new status; it is still `live` or `coming_soon` in the catalog.

---

## 6. Generic MCP/API rail — proprietary lane (unchanged)

`packages/connectors/src/rails/mcp.ts` (`McpRailClient`) and all `method:'G'` descriptors are entirely untouched by this spec. Nango has no role in the proprietary lane. The deny-by-default `safeFetch`, credential pinning (`credentialHosts`), and quarantine in `McpRailClient.callTool()` are unchanged.

This lane remains the right choice for:
- User-supplied internal systems (ERPs, bespoke APIs) with non-standard auth
- IMAP/SMTP, CalDAV (protocol-level, not REST OAuth)
- Webhook receivers / CSV import (no auth at all)
- Any provider where Nango does not have a supported integration

The two lanes coexist under the same `connections` table, same registry, and same Connections UI. The `method` field on the descriptor is the only routing key.

---

## 7. PREREQUISITES / OPEN QUESTIONS for the human

**P4 cannot be built until every item in this section is resolved.**

### P1 — Cloud vs. self-hosted decision (blocking)

**Question:** Do you want to start with **Nango Cloud** or **self-hosted Nango**?

- Cloud: faster to start (~1 day); Nango holds OAuth tokens; requires a DPA; ~$0.01/connection/month at scale; no infra ops.
- Self-hosted: you hold tokens; requires a Docker host or a container service (e.g. Railway, Fly.io, ECS) with persistent storage; ~2–3 days setup; free at any volume under ELv2.

The recommended starting point is **Nango Cloud** for velocity. Self-host is the right long-term answer if/when Nibbin has the ops capacity.

### P2 — Nango account (blocking for Cloud) or host URL (blocking for self-hosted)

- **Cloud path:** Create a Nango account at https://nango.dev. Retrieve: `NANGO_SECRET_KEY` (server-side), `NANGO_PUBLIC_KEY` (client-side). Configure three integrations: `google-mail`, `google-calendar`, `stripe` in the Nango dashboard.
- **Self-hosted path:** Deploy Nango. Retrieve: `NANGO_HOST` (the URL of the self-hosted instance), `NANGO_SECRET_KEY`.

### P3 — Nango integration configuration (blocking)

In the Nango dashboard (or via Nango CLI for self-hosted), three integrations must be configured before the connect flow can work:

| Integration key | Provider | OAuth client ID/secret source | Scopes |
|---|---|---|---|
| `google-mail` | Google | Existing Gmail Google OAuth app (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) | `gmail.readonly`, `gmail.compose`, `gmail.send`, `openid`, `email` |
| `google-calendar` | Google | Same Google OAuth app | `calendar.readonly`, `calendar.events`, `openid`, `email` |
| `stripe` | Stripe Connect | Stripe platform OAuth app (`STRIPE_OAUTH_CLIENT_ID`, `STRIPE_OAUTH_CLIENT_SECRET`) | `read_only` |

**Note:** Nango does not register developer apps with providers on your behalf. You must supply your existing OAuth credentials. The Google tester-allowlist restriction and 100-user cap remain your responsibility to enforce in Nibbin code — Nango does not enforce them.

### P4 — Data-residency / subprocessor decision (blocking if using Nango Cloud)

Nango Cloud means Nango becomes a **data subprocessor** for OAuth access tokens (not raw user data, but tokens that grant access to user data). You must:

1. Confirm you are willing to accept Nango as a subprocessor.
2. Execute Nango's DPA (available at trust.nango.dev or by request). Verify their current compliance posture (SOC2 Type II, GDPR, data region options) at https://trust.nango.dev before signing.
3. Add Nango to Nibbin's subprocessor list / privacy policy.

If you choose self-hosted Nango, this item is N/A.

### P5 — Verify Nango does NOT log response bodies (blocking)

Before go-live, confirm with Nango's documentation or DPA that their proxy does **not** log, store, or analyze the contents of proxied API responses. Nibbin's derived-not-raw privacy posture depends on raw Gmail/Calendar/Stripe response bodies never leaving our processing boundary. The current `safeFetch` path guarantees this; Nango proxy must provide the equivalent guarantee.

### P6 — Nango self-hosted version and SDK version pin

At build time, pin the Nango server version (self-hosted) and `@nangohq/node` SDK version. Nango's ELv2 license means the self-hosted version can fall behind cloud; breaking API changes between versions have occurred historically. Record the pinned versions in `package.json` and the connector-batch plan.

### P7 — Google CASA / OAuth verification status (non-blocking for code, blocking for GA)

The tester-allowlist (100-user cap) for Google connectors is unchanged. GA for Gmail/Calendar on the Nango lane requires the same Google CASA + OAuth verification that was required on the hand-built lane. Nango does not accelerate or bypass this process. Track status in `docs/STATE.md` as before.

### P8 — Stripe OAuth app credentials

`STRIPE_OAUTH_CLIENT_ID` and `STRIPE_OAUTH_CLIENT_SECRET` are needed to configure the Stripe integration in Nango. If you have not yet obtained these from the Stripe dashboard (Connect > Settings > OAuth), do so before P4 build starts. These same credentials were the blocker for Task 5 in the connector-batch plan.

---

## 8. Build sequence (for when prerequisites are met)

This section is advisory — the actual plan will be a separate build document.

1. **Env + Nango config:** `NANGO_SECRET_KEY`, `NANGO_PUBLIC_KEY`/`NANGO_HOST`; configure three integrations in Nango dashboard. Add `@nangohq/node` to `packages/connectors/package.json`.
2. **`NangoConnectorClient` base class** (`nango-base.ts`): egress-allowlist re-check, proxy call, quarantine wrap, 401/429 error normalization.
3. **Migration:** add `nango_connection_id` + `nango_provider_config_key` to `connections`; backfill nulls for existing rows.
4. **Update `GmailClient`, `GoogleCalendarClient`, `StripeConnectorClient`** to extend `NangoConnectorClient`. Factory functions updated. All public methods and test contracts unchanged.
5. **Connect action routing:** gate on `descriptor.method === 'N'`; extract `enforcePlatformGate` into a standalone callable; wire Nango auth redirect.
6. **Callback / post-connect handler:** receive Nango's event/webhook confirming a successful connect; write `nango_connection_id` + `nango_provider_config_key` + scopes into the `connections` row.
7. **Disconnect flow:** call `nango.deleteConnection()` before row revoke.
8. **Adversarial gate** (required — write path, token custody change, auth flow change). Gate report to `docs/gates/`.
9. **Migration applied to dev + staging + prod** in the standard three-DB sequence.

---

## 9. What this spec explicitly does NOT change

- The primitive vocabulary (`packages/runtime/src/primitives/*`) — unchanged.
- The `validateComposedSpec` boundary — unchanged.
- The action-level gate (`Observe / Draft / Send`) — unchanged.
- Send-velocity caps and the `send_velocity_consume` RPC — unchanged.
- `McpRailClient` and all `[G]` connectors — unchanged.
- `[H]` connectors (HoneyBook, Pixieset, Instagram-DM): `oauth/flow.ts`, `oauth/providers.ts`, `HttpConnectorClient` — unchanged.
- Scan modules (`packages/scan/src/modules/*`) — unchanged; they call the same client methods.
- The Connections UI structure and user experience — unchanged.
- Google tester-allowlist enforcement — unchanged (extracted from `flow.ts`, called from the Nango connect action).
- The `connections` table RLS and FK structure — extended only (two nullable columns added).
