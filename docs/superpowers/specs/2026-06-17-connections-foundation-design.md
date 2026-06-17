# Connections Foundation (read-only connect) — Design

**Date:** 2026-06-17
**Status:** Draft — pending review
**Closes:** NIB-1 (Adopt button "does nothing"), NIB-3 (no UX for connecting external accounts)
**Branch (planned):** `feature/connections-foundation` (off `main`, not the macOS bug-fix branch)

---

## 1. Problem

A user cannot connect an external account today. The infrastructure exists — the OAuth flow engine (`packages/connectors/src/oauth/flow.ts`), the `connections` table + token vault, ~23 providers in the registry, revocation — but **two pieces are missing**: there is no OAuth callback route (nothing ever calls `exchangeCode()` or inserts a `connections` row in production) and no connect UI anywhere. The shop's *"connecting accounts lives in the grove for now"* is aspirational; the Settings → Connections page is read-only.

Consequence: clicking **Adopt** in the Agent Shop on a fresh account hits `missingConnectors`, redirects to `/app/shop?missing=…` showing a weak top-of-page note that points nowhere — so the button appears to "do nothing" (NIB-1). The fix for NIB-1 is therefore to make connecting actually work and route the adopt flow to it (NIB-3).

## 2. Architecture context (north star)

This spec is **Spec 1 of 4** in the Connections/agent-liveness arc. It deliberately builds only the read-only connect foundation. The guiding principles it must not violate:

- **The one privacy moat is the screen film.** Only the on-device screen capture is sacred (only the synthesis map leaves — invariant C7). **Connector permissions are not a minimization concern** — scope breadth is chosen for product value and to satisfy Google verification, not to be narrow for its own sake. We do still avoid *warehousing*: the diagnosis is a deep read that derives memory; we keep the derivation, not a permanent raw mailbox copy. Tokens live in the vault; raw bodies are read to build the diagnosis, not retained.
- **Read at connect; write when an agent first acts in Gmail (decision A).** First connect requests **`gmail.readonly`** (full read incl. bodies — the diagnosis needs message contents). Write (`gmail.compose`) is requested the first time an agent writes to the user's Gmail (the Student push-to-Gmail). The reason for this sequence is *practical, not brand*: the diagnosis only needs read, and a send-capable consent prompt at first connect would hurt conversion and widen verification. See the capability ladder (§11).
- **No draft-only scope exists.** `gmail.compose` is the narrowest scope that can create a Gmail draft, and it *also* permits send — Google offers no draft-without-send scope (`gmail.drafts.create` is not honored by the drafts API; `users.drafts.create` requires `compose`/`modify`/full). Therefore the draft → one-click-send → autonomous distinctions across Student/Senior/Graduate are enforced **server-side in our runtime**, not by OAuth scopes.
- **Registry change:** update the `gmail` descriptor's `scopes.read` from `['gmail.metadata']` to `['gmail.readonly']` (the scan/diagnosis modules currently assume metadata; widening to readonly unblocks body-level signals like FAQ mining and voice).
- **Direct API for first-party connectors.** Gmail is method `H` (hand-built OAuth, direct to the Google API). MCP is reserved for the user-supplied `generic-mcp` rail, not first-party connectors.

**Follow-on specs (not built here):** Spec 2 — per-Nibbin write-scope upgrade; Spec 3 — liveness/eventing (source-decoupled dispatch, cron polling for v1 → Pub/Sub webhooks at scale); Spec 4 — initial history sweep → derived memory. Device-side data-lake ingestion is a later north-star upgrade.

## 3. Goals / Non-goals

**Goals**
- A user can connect Gmail end-to-end (read-only) from a discoverable surface and see it as Connected.
- Adopting a Nibbin that needs Gmail routes the user to connect, then **auto-resumes** the adoption.
- A discoverable top-level **Connections** surface; the buried Settings tab redirects to it.
- Tester-allowlist gating enforced (Gmail is pending Google verification).
- Provider icons, usable on the Connections surface and as clickable chips in the grove chat.

**Non-goals (explicit)**
- Write scopes / per-Nibbin upgrade (Spec 2).
- Event-driven agent triggering / polling / webhooks (Spec 3).
- Initial history sweep + memory derivation (Spec 4).
- Aggregator (`A`) and generic-rail (`G`) providers — the surface lists them but only hand-built `H` Gmail is wired this pass. Others show "coming soon" / are non-interactive.
- On-device (desktop) Gmail ingestion.

## 4. Data model

### 4.1 `oauth_pending_authorizations` (new table)
Holds the short-lived state between `beginAuthorization` and the callback. Mirrors the existing `desktop_auth_codes` pattern.

| column | type | notes |
|--------|------|-------|
| `id` | uuid pk | |
| `state` | text unique not null | the issued OAuth `state`; lookup key at callback |
| `provider` | text not null | e.g. `gmail` |
| `account_id` | uuid not null → accounts | |
| `user_id` | uuid not null → users | who initiated |
| `nonce` | text not null | |
| `code_verifier` | text | PKCE S256 verifier (present for Gmail) |
| `scopes` | text[] not null | exact scopes requested (recorded onto the connection) |
| `return_to` | text | post-callback redirect (Connections, or shop resume) |
| `nibbin_id` | uuid | null for first connect; set for Spec 2 write upgrades |
| `created_at` | timestamptz default now() | |
| `expires_at` | timestamptz not null | ~10 min TTL |
| `consumed_at` | timestamptz | single-use: set on successful exchange |

RLS: **deny all to `authenticated`** (service-role only, like `connections` writes). Read/write only via the callback route's service client.

### 4.2 `tester_allowlist` (new table)
Backs the `TesterAllowlist` interface for verification-pending providers.

| column | type | notes |
|--------|------|-------|
| `email` | text pk | normalized lowercase |
| `provider` | text not null | scope the allowlist per provider (Gmail today) |
| `added_at` | timestamptz default now() | |

Seeded with the operator's tester email(s). `isAllowed(email)` = row exists for `(email, provider)`. `count()` = distinct emails for the provider, compared against the registry's `unverifiedUserCap` (100 for Gmail). Service-role read.

### 4.3 `connections` (existing — unchanged schema)
On successful exchange we insert a row: `status='active'`, `method='H'`, `scopes`=requested read scopes, `token_ref`=vault id, `created_by`=user. Token sealed via `connection_token_store()`.

## 5. Connect flow

### 5.1 Begin — `beginConnect(provider, returnTo?)` (server action)
1. `appSession()` → `{ user, accountId }`.
2. Resolve descriptor; if platform verification is pending, build the `TesterAllowlist` (from `tester_allowlist`) and pass `tester: { email: user.email, allowlist }`.
3. `beginAuthorization({ provider, clientId, redirectUri, tester })` → `PendingAuthorization`.
4. Service-role insert into `oauth_pending_authorizations` (state, nonce, codeVerifier, scopes, provider, accountId, userId, returnTo, expiresAt = now+10m).
5. `redirect(pending.url)` to Google.

Errors map to friendly redirects: `tester-required`/`tester-not-allowed` → Connections with "Gmail is in limited testing — your email isn't on the list yet."; `tester-cap-reached` → "Gmail testing is full while we finish verification."

### 5.2 Callback — `GET /api/connect/google/callback`
Route handler (service client; no user cookies required — keyed by `state`):
1. Read `code`, `state`, and Google error params. On `error=access_denied` → redirect `return_to` (or Connections) with "You declined the Gmail connection."
2. Look up pending by `state`. Reject if missing / `consumed_at` set / `expires_at` past → "That connection link expired — try again."
3. `exchangeCode({ provider, code, redirectUri, clientId, clientSecret, codeVerifier, expectedState=pending.state, returnedState=state, requestedScopes=pending.scopes })` → `StoredToken`. (Engine checks state timing-safe before any I/O.)
4. Service-role: insert `connections` row → `connection_token_store(connId, token)`.
5. Mark pending `consumed_at = now()`.
6. `redirect(pending.return_to ?? '/app/connections?connected=gmail')`.

On `exchange-failed` → Connections with "Couldn't finish connecting Gmail — nothing was saved. Try again." Never surface token endpoint bodies (engine already guards).

### 5.3 Credentials & redirect URI
- Env: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`.
- Redirect URI: `https://nibbin.com/api/connect/google/callback` (prod) + `http://localhost:3000/api/connect/google/callback` (dev).
- `redirectUri` passed to both `beginAuthorization` and `exchangeCode` must match exactly.

## 6. Connections surface (UI)

- New route `/app/connections` rendered in `AppShell` with a new sidebar nav item **"Connections"** (`NavKey` `'connections'`; placed after "Your Nibbins").
- Read the user's `connections` (RLS read) and merge with the registry's provider list:
  - **Not connected, wired (Gmail):** "Connect" button → `beginConnect('gmail')`.
  - **Connected:** status badge + scope summary + "Disconnect" (existing service-role revoke path).
  - **Not connected, not yet wired (other providers):** shown with icon + "Coming soon", non-interactive.
- `/app/settings/connections` → **308 redirect** to `/app/connections`; remove the Settings sub-nav "Connections" tab.
- Success/error banners via the existing `InlineFeedback` component (reads `?connected` / `?error` / `?needed`). Token-only styling; reuse existing `Card`/`Badge`/button primitives.

### 6.1 Provider icons
- New `ProviderIcon` component keyed by provider id, rendering a bundled SVG logo with a generic fallback (no external/runtime fetch).
- Bundle our own SVG assets per provider (Gmail/Google first); store under a shared assets location consumable by web.
- Used on the Connections surface and as **clickable chips in the grove chat** (the scan/adopt recommendation chips in `scan-actions.ts` / `KeeperChat`): clicking a provider icon opens the connect flow / Connections.

## 7. NIB-1 adopt feedback + auto-resume

- `adoptFromShopAction`: on `missingConnectors`, redirect to `/app/connections?needed=<providers>&resume=<templateKey>` instead of `/app/shop?missing=…`.
- Connections surface, with `needed`/`resume` present: show a prominent banner — "**Maya needs Gmail** — connect it to finish adopting." with the relevant Connect button emphasized. Pass `resume` through `beginConnect`'s `returnTo` so it survives the round-trip.
- On successful connect that carries a `resume` template key: re-invoke the adoption (`adoptTemplate`) automatically; on success redirect to `/app` (grove) with a confirmation; if still blocked (another missing connector), return to the banner naming the next one.
- Also strengthen the `?limit=` (cap) feedback to be an in-view `role="alert"` banner.

## 8. Security considerations
- Pending state: single-use (`consumed_at`), short TTL, service-role-only table; `state`/`nonce`/PKCE generated by the engine.
- `exchangeCode` verifies state timing-safe before any network I/O.
- Connection writes and token storage are service-role only; clients keep read-only RLS on `connections`.
- Token material only ever in the vault (`connection_token_store`), never in app tables or logs.
- Egress for the token endpoint is pinned to the descriptor's `egressAllowlist` (engine uses `safeFetch`).
- Tester gate enforced before redirecting to Google (fail fast, friendly message) **and** is independently enforced by Google's test-user list.

## 9. Testing strategy
- Unit: `beginConnect` gate logic (allowed / not-allowed / cap-reached); pending-row creation.
- Callback handler against the engine's `unsafeTestOverrides` mock token endpoint: happy path (insert + vault + consume + redirect), `access_denied`, state mismatch, expired/replayed state, exchange failure.
- `oauth_pending_authorizations` TTL + single-use enforcement.
- `tester_allowlist` allow/deny/cap counting.
- NIB-1 resume-adopt: missing → connect → auto-adopt success; still-missing path.
- Surface render states (not-connected / connected / coming-soon) and the settings → connections redirect.

## 10. Prerequisites (operator)
Google Cloud OAuth app (in your existing Google Cloud account):
- Enable the **Gmail API**.
- **OAuth consent screen:** External; app name/support email; add scope `…/auth/gmail.readonly` (full read incl. bodies — the diagnosis needs message contents); add your tester email under **Test users**; publishing status **Testing**.
- **OAuth client ID (Web application):** Authorized redirect URIs = the prod + localhost callback URLs above.
- Put client id/secret into `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` (dev `.env.local`, prod Vercel env).
- Pub/Sub is **not** needed (Spec 1 has no eventing). Full OAuth verification + CASA is a later production gate, not required for ≤100 test users.

## 11. Agent phase → capability → scope ladder (decision A; informs Spec 2)

**Constraint:** there is no draft-only Gmail scope. `gmail.compose` is the narrowest scope that creates a Gmail draft and it *also* permits send. So OAuth gives exactly one boundary — **read vs. write** — and every finer distinction (draft-only, one-click send, autonomous) is enforced in **our runtime**, not by scopes. **Decision A:** grant `compose` at Student (the token is send-capable from Student onward; "draft-only" is a runtime guarantee, not a scope guarantee).

Disambiguating "draft": a **Nibbin draft** is model output stored in Nibbin (no Gmail write — just `readonly` to read the thread it answers); a **Gmail draft** is written to the mailbox (`compose`). "Send draft to Gmail" = create a Gmail draft (`compose`), **not** a transmission.

| Stage | Behavior | OAuth scope held | Runtime enforcement |
|-------|----------|------------------|---------------------|
| **Egg** | reads/observes to learn the account | `readonly` | — |
| **Student** | drafts in Nibbin (fine-tune the agent + memory); click in → edit → **ad-hoc** "send draft to Gmail" (creates a Gmail draft, no transmit) | `readonly` + `compose` | runtime **refuses send**; drafts only |
| **Senior** | **auto**-creates a Gmail draft every time + **one-click human-approved send** (Nibbin/Slack/Telegram/iMessage/WhatsApp) | *same* (`compose` already permits send) | runtime **allows send but requires a human tap** each time |
| **Graduate** | **autonomous** send within restrictions (content / addresses / velocity) | *same* | runtime **allows autonomous send** within guardrails |

**Consent moments — just two:** (1) connect → `readonly` (Egg + the diagnosis); (2) first push-to-Gmail (Student) → `compose`. **Senior and Graduate add no new OAuth scope** — they are runtime-policy changes only. (`gmail.send` is declared on the consent screen but redundant for our flow, since `compose` already sends; it stays available in case we ever want a send-only agent.) The messaging-channel one-click is a separate notification/approval integration; the action it triggers is a Gmail send via the already-granted `compose`.

This ladder shapes Spec 2 (the runtime capability gating); Spec 1 implements only the `readonly` connect that Egg rides on.

## 12. Open questions / follow-ons
- Exact sidebar slot/label wording for "Connections" (confirm during implementation).
- Provider-icon asset sourcing (own SVGs — confirmed) and the shared asset location.
- Spec 2: realize the phase→capability→scope ladder above (ad-hoc `compose` at Student, `compose`+`send` at Senior, autonomy policy at Graduate).
