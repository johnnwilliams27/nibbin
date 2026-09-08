# Auth triage — the 49 servers we cannot currently rate

**Status:** research only. Nothing here has been signed up for, agreed to, or paid for.
No account was created, no form submitted, no email entered, no terms accepted. Every row
below is a decision for the account owner to make.

Five servers — `ai.lumify_sports-intelligence`, `ai.chronary_mcp`,
`ai.echoloc_company-technographics`, `ai.creativescope_creative-intelligence` and
`ai.framethrower_framethrower` — have since been worked end to end to see whether a key could
be obtained without a human. None could. Those attempts created no account and submitted no
form either; what they found is written up in the attempt logs below, including a correction —
the same correction, arrived at five times — to how these servers' auth walls are recorded.
Echoloc is the one where it did not matter: **it turned out to need no credential at all**, and
re-probing it anonymously rated all three of its tools. FrameThrower is the one where the
remaining human step is now a single command plus a sign-in
(`scripts/obtain-oauth-credential.mts`).

**Source data:** `packages/collectors/assessment.json` (gaps with cause
`harness_capability_missing`), `packages/collectors/transcripts/*.json` (registry metadata,
handshake instructions, declared tool schemas), plus vendor homepages/docs fetched over HTTP.

**Scope reminder:** we probe ~3 read-only tools per server. The whole question in the
"WORTH IT" column is whether obtaining a credential buys us three usable read calls.

---

## Headline numbers

| | Count |
|---|---|
| **free-api-key** — self-serve key, no human identity beyond an account | **22** |
| &nbsp;&nbsp;of which free allowance + "no credit card" is *confirmed* | 16 |
| &nbsp;&nbsp;of which the key is self-serve but the free allowance is *unverified* | 6 |
| **oauth-user-account** — needs a real human identity or real personal data | **15** |
| **paid-tier** — money changes hands before we can call a tool | **10** |
| **invite-or-waitlist** — closed to us regardless of willingness | **1** |
| **unknown** — no discoverable signup path | **1** |
| **server-misconfigured** | **0** (see DataMerge finding below) |

---

## Two cross-cutting findings that should change how we read this list

### 1. The empty-account problem

A credential is necessary but not sufficient. Roughly half these servers read **the user's
own account data** — their logs, their calendar, their food diary, their memories, their
deployed sites. A fresh free account returns *empty* from those tools. An empty result is
not the same as a working tool, and rating a server on three empty reads would be worse
than recording the gap honestly.

- **Corpus-backed** (returns real data on day one, no data entry needed): lumify, drillr,
  echoloc, creativescope, klarix, alphacreek, framethrower, marketintell, datamerge,
  meacheal, mangii, noevant, imaginode, ccapi, compeller.
- **Own-account** (returns empty until the human populates it): auralogs, chronary,
  forkmate, memoryrouter, mitosis, memoket, myriade, gondola, betslipdoctor, dataecho,
  novence, finestructure, flowcastle, dreamlit, decisionlog, latticenet, kontato,
  canaryusers, betterpost, moonlings, foliora, openmandate, geodesiclabs.

This is the single strongest filter on "WORTH IT" and it cuts across every auth kind.

The split above was read off tool descriptions. **Chronary is the first entry checked against
the operator's own schema** (2026-09-08, attempt log below) and it lands where it was placed:
all 54 tools are org-scoped, none reads anything the account did not create, and the only tool
that would answer non-empty on day one is `get_usage` — our own metering. That is one
confirmation, not a validation of the whole list, but it suggests the list is sound and that
the cheapest way to check any other row is `openapi.json` rather than a signup.

### 2. Seven servers are gated on *some* tools only — we can rate the public surface now

| Server | Public surface | Gated surface |
|---|---|---|
| `ai.compeller_compel` | `get_capabilities`, `list_styles` (2/3 probed OK) | `search_music` |
| `ai.echoloc_company-technographics` | **all three** — re-probed anonymously 2026-09-08 and `list_technologies` answered too (see the section below) | none. The original 2/3 was the **5-calls/day anonymous cap**, not a gate |
| `ai.foliora_search` | `get_product`, `get_snapshot` (2/3 OK) | `list_sites` |
| `ai.dataecho_mcp` | `get_site` (1/3 OK); `publish_site` also works anonymously | `list_sites`, `search_sites` |
| `ai.moonlings_moonlings` | `ping` (1/3 OK) — server explicitly documents it as free | `check_report_status`, `get_report_result` |
| `ai.com.mcp_contabo` | `tool_search` (1/3 OK) | 123 Contabo API tools |
| `ai.mitosislabs_mitosis` | **none probed** — but the server's own instructions say `get_pricing`, `search_docs`, `get_platform_status`, `list_skills` "need no sign-in" | the 8 `cortex_*` tools |

**Action independent of any credential:** re-run the probe planner against these seven with
public tools selected. Mitosis in particular is currently recorded as fully un-ratable when
it has four declared no-auth tools; that is a **probe-selection defect on our side**, not an
auth wall. Echoloc is a rate-limit artefact, not an auth wall — **confirmed 2026-09-08**: a
fresh-day anonymous re-probe answered all three tools with real data and no credential.

---

## The two servers that were not ordinary auth walls

### `ai.datamerge_mcp` — NOT server-misconfigured. It is a genuine credential gap, with bad error copy.

> `DataMerge client not configured. Please call configure_datamerge or set DATAMERGE_API_KEY.`

The server declares a `configure_datamerge` tool whose `apiKey` parameter description reads,
verbatim: *"DataMerge API key. Get one at https://app.datamerge.ai (20 free credits)."* The
intended hosted flow is therefore per-session: the client calls `configure_datamerge` with
the **user's own** key. The operator is not missing their own configuration — the credential
was always meant to come from us.

Two sub-findings worth recording *about them*, not about us:

1. The error message offers `set DATAMERGE_API_KEY`, a server-side environment variable that
   no remote MCP client can possibly set. That instruction is leftover stdio/self-host copy
   surfaced to hosted clients. It is misleading, not broken.
2. A real gap **on our side**: our harness has no notion of "call a setup tool before the
   read tools." Several servers use this pattern (`datamerge/configure_datamerge`,
   `facesign/set_api_key`, `novence/bootstrap`, `dataecho/request_login_code`). We should
   record these as `harness_capability_missing` for the *right reason* — we cannot drive a
   pre-flight configuration call — rather than implying the operator is at fault.

**Verdict:** `free-api-key`. Reclassify away from any "broken server" reading.

### `ai.kontato_kontato` — authentication, not a missing parameter. Do not attempt.

> `Sessao sem conta ativa. Passe 'owner_phone' (numero do dono, so digitos, ex: 5511999998888) NESTA chamada para reativar a conta automaticamente, ou rode 'provision' primeiro.`

`owner_phone` looks like a plain required parameter, but the tool schemas show it is an
**account identifier**, not a filter argument:

- `provision` is documented as *idempotent per phone number* — "se ja existe conta para o
  owner_phone, devolve a MESMA conta … funciona como login". It is a login keyed on a phone
  number.
- `verify_number` completes the binding with a **6-digit OTP delivered over WhatsApp to that
  number**, and is mandatory before `send`/`reply`/`schedule` (they return `403
  owner_not_verified` until then).
- The read-only tools we care about (`status`, `list_schedules`, `list_messages`) need an
  active account, i.e. an `owner_phone`, but not the OTP.

So: **it is authentication.** And it is authentication where supplying an arbitrary number
would provision an account against, and fire a WhatsApp OTP at, a real person's phone. That
is squarely over the line — it is not ours to do, and it is not harmless to guess.

**Verdict:** `oauth-user-account` in spirit — a human must supply a WhatsApp number they own.
**WORTH IT: no.** Even authenticated, a fresh account has no messages and no schedules, so
all three read tools return empty (see the empty-account problem above).

---

## free-api-key — self-serve, no human identity beyond an account (22)

Ordered most tractable first. "Instant" means the vendor states the key is issued immediately
with no card and no sales contact.

| Server | Endpoint | What it said | Signup / docs URL | EFFORT (for a human) | WORTH IT |
|---|---|---|---|---|---|
| `ai.lumify_sports-intelligence` | `https://lumify.ai/mcp` | JSON-RPC `-32001 Unauthorized: provide a valid Lumify API key as a Bearer token`, returned **inside an HTTP 200** (not a 401 — see the attempt log below); handshake: *"Read the lumify://docs/quickstart resource … including the zero-signup instant-key auth path"* | https://lumify.ai/register | **Not obtainable by us — attempted 2026-09-08, see the section below.** The advertised zero-signup instant key is Cloudflare-Turnstile-gated by the operator's own spec; the persistent account needs a real person's name, a verifiable mailbox, and terms acceptance | **Yes for a human, no for us.** Corpus-backed, 24 declared read-only tools, 1,000 non-expiring credits. Every route in is closed to an automated client |
| `ai.drillr_drillr` | `https://gateway.drillr.ai/mcp/data` | HTTP 401 | https://drillr.ai/signup → key at `/account/api-keys` | Create account, 80 non-expiring free credits, no card, key self-serve. **Reclassified `oauth-user-account` — see attempt log 2026-09-08.** The self-serve key sits behind a Supabase login whose signup needs email confirmation + terms acceptance | **For a human, yes** — `list_tables` / `get_table_schema` / `run_sql` over 90+ financial tables is close to an ideal read-only probe surface, real data, no account population needed. **For us, no path:** `email_confirmation_required` + `terms_acceptance_required` |
| `ai.echoloc_company-technographics` | `https://api.echoloc.ai/mcp` | *"Anonymous preview limit reached (5 calls/day). … Free beta key (100 requests/month, instant)"* | https://echoloc.ai/auth?mode=signup&returnTo=%2Fapp%2Fapi (key at https://echoloc.ai/app/api; details https://echoloc.ai/for-agents/) | **Not obtainable by us — attempted 2026-09-08, see the section below.** A key exists only behind a Supabase account, and that account needs a mailbox we do not have (or a real person's Google identity) plus terms acceptance. For a human it is ~60 seconds | **3/3 already rated without it** (see below): the anonymous re-probe worked. A key is still worth a human's minute — it lifts 5 calls/day to 100/month and un-trims the profiles — but nothing is blocked on it |
| `ai.creativescope_creative-intelligence` | `https://mcp.creativescope.ai/mcp` | HTTP 401 with a real `WWW-Authenticate: Bearer resource_metadata=…` challenge on `tools/call`, `resources/list` and `prompts/list` — `initialize` and `tools/list` are open (see the attempt log below) | https://creativescope.ai/mcp — "Get free API key" | **Not obtainable by us — attempted 2026-09-08, see the section below.** The only account-creation route is a **6-digit code emailed** to a work address, behind a **required "I agree to the Terms and Privacy Policy" checkbox**. OAuth is the same account by another door. No CAPTCHA anywhere — the wall is identity and contract, not bot detection | **No longer "yes" — and not for the reason we assumed.** The free tier is **the rankings tools only**; `search_creatives`, `get_creative_detail` and the advertiser/image tools are Pro. **All three tools our planner selected for this subject are Pro-tier**, so a free key would rate none of them without a probe-selection change |
| `ai.marketintell_marketintell` | `https://api.marketintell.ai/mcp` | HTTP 401; handshake names both paths | https://marketintell.ai/signup **or** in-band `register_challenge` → `register` | **Notable:** the second path is SHA-256 proof-of-work self-signup taking only `{challenge_id, nonce, name}` — **no email, no form, no ToS click**. Issues a Free-tier key | **Yes.** Corpus-backed market data, and the lowest legal friction of anything on this list. Still account creation, so still the owner's call |
| `ai.klarix_intelligence` | `https://mcp.klarix.ai/mcp` | 401 at `tools/call` only; `initialize`/`tools/list` answer anonymously | https://klarix.ai/mcp#get-key | Work email → free key, shown inline, **no confirmation link**. 25 **one-time** credits, 7 free narrative tools. Attempted 2026-09-08 and stopped: the only issuance path is a web form carrying a honeypot bot trap, and Klarix's ToS §12 forbids automated access to their website (see attempt log) | **No, for us.** Even with a key: 2 of our 3 probed tools are Pro+, and one battery run (~24 calls) would eat the whole 25-credit lifetime allowance |
| `ai.chronary_mcp` | `https://api.chronary.ai/mcp` | HTTP 401 | https://console.chronary.ai/signup | No card; 50K API calls/month free; keys instant. Also an agent self-signup endpoint (`POST /v1/agent/sign-up`, email + OTP) | Marginal — generous renewable tier, but own-account: a fresh org has no agents/calendars/events, so reads come back empty |
| `ai.auralogs_auralogs` | `https://mcp.auralogs.ai/mcp` | HTTP 401 | https://auralogs.ai → Settings → API & MCP keys | Free plan, 10,000 logs/month, no card. Key is a genuine **read-scoped** key (`aura_read_…`) — exactly the credential shape we want | Marginal — best-shaped credential on the list, but own-account: no logs ingested means three empty reads |
| `ai.novence_mcp` | `https://api.novence.ai/mcp` | *"Unauthorized: provide Authorization Bearer API key (or call bootstrap first)"* | In-band `bootstrap` tool | One tool call: *"Create an account + nv_ API key from an email. No Bearer key required … Returns apiKey immediately — do not wait for OTP."* **Requires an email address — the owner's decision, not ours** | Marginal — trivial mechanically, but own-account (no projects, no files, no deployments) |
| `ai.datamerge_mcp` | `https://mcp.datamerge.ai` | *"DataMerge client not configured. Please call configure_datamerge or set DATAMERGE_API_KEY."* | https://app.datamerge.ai | Create account (20 free credits), then the harness must call `configure_datamerge` with the key before each session | Yes — corpus-backed B2B data, and it also forces us to fix the pre-flight-config harness gap that affects 4+ servers |
| `ai.flowcastle_flowcastle` | `https://api.flowcastle.ai/api/mcp` | *"This tool requires an API key. Create an application key in the FlowCastle dashboard (Application → API → MCP tab)…"* | https://dashboard.flowcastle.ai/login | Free plan $0, no card, 2,000 events/month; key from dashboard | Marginal — own-account (no bots to read) |
| `ai.noevant_fidenta-verify` | `https://verify.noevant.ai/mcp` | HTTP 401 | https://verify.noevant.ai/signup | Free tier: 40 claim checks then 10/month, no card | Yes — corpus-backed fact-checking; three reads fit comfortably in the free allowance |
| `ai.canaryusers_canaryusers` | `https://www.canaryusers.ai/api/mcp` | HTTP 401 | https://canaryusers.ai (Start free) | Free 100 credits/month (~2 deep scans), no card | No — tools *run scans against a deployed app*; read-only probes need a prior scan to exist |
| `ai.dreamlit_mcp` | `https://mcp.dreamlit.ai/mcp` | HTTP 401 | https://app.dreamlit.ai/signup | "Free to start — no credit card required" | No — own-account workflow platform; empty workspace |
| `ai.finestructure_fine-structure` | `https://finestructure.ai/api/mcp` | HTTP 401 | https://finestructure.ai/api-keys | Free signup, no card, free tier includes AI credits; scoped API token self-serve | No — own-account app builder; `list_apps` returns empty by the server's own admission |
| `ai.dataecho_mcp` | `https://dataecho.ai/mcp` | *"unauthorized: Provide Authorization: Bearer <API_KEY> or use the anonymous flow … call request_login_code, then verify_login_code"* | In-band email OTP (`request_login_code` → `verify_login_code`) | Email + 6-digit code, in-band. **Requires entering an email — owner's decision** | No — already 1/3 rated via `get_site`; the gated tools list the *account's own* sites, which would be empty |
| `ai.alphacreek_alphacreek-mcp` | `https://mcp.alphacreek.ai/mcp` | HTTP 401 | https://www.alphacreek.ai/auth/jwt/register (docs `/docs`, connect `/connect`) | Register (JWT). Handshake implies a monthly free limit ("tell the user their monthly limit is reached"). Allowance not published | Yes if the free tier is real — corpus-backed SEC/FCA filings, entirely read-only. **Verify the tier before spending effort** |
| `ai.geodesiclabs_governance-platform` | `https://app.geodesiclabs.ai/mcp` | *"validation error … api_key Field required"* | geodesiclabs.ai (handshake: *"Sign up at geodesiclabs.ai for an API key"*) | Sign up for a key. **Note the unusual shape: `api_key` is a required *tool parameter*, not a header** — our harness would need per-tool credential injection | No — own-account (needs a Blueprint to exist first), plus a harness change |
| `ai.foura_mcp` | `https://mcp.foura.ai/mcp` | HTTP 401 | https://foura.ai/dashboard/#api-keys | Create/reveal key in dashboard (`pk_live_…`). **Free tier not documented in the README or on the site** | Unclear — verify pricing first. Web-fetch tooling is corpus-backed and would probe well if a free tier exists |
| `ai.compeller_compel` | `https://compeller.ai/api/mcp` | *"API token required. Set Authorization: Bearer <token> header."* | https://compeller.ai/signup; token at `/account` → API Access; or `POST /api/v1/auth/signup` (email + agent name) | Self-serve token; free allowance not published (render minutes are metered) | No — already 2/3 rated on the public surface; the one gated tool is not worth an account |
| `ai.mangii_manga` | `https://mcp.mangii.ai/mcp` | HTTP 401 | https://mangii.ai/console/keys | Mint a key in the console. Credits are consumed per generation (standard 1 / hd 2 / ultra 5); free allowance not published | No — generation-heavy, and read probes would spend credits |
| `ai.facesign_facesign-mcp` | `https://mcp.facesign.ai/mcp` | *"FaceSign API key is not set for this session. Please ask the user for their FaceSign API key and call the set_api_key tool first."* | facesign.ai (site returns **HTTP 403** to us — signup path not verifiable) | Unknown. Mechanism is clear (user-supplied key via `set_api_key`); the tier and signup route are not | No — cannot verify the tier, own-account, and needs the pre-flight-config harness change |

---

## oauth-user-account — needs a real human identity or real personal data (15)

Nothing in this group can be obtained by us. Each requires a person to sign in as themselves,
and in several cases to expose their actual personal data to our probe.

| Server | Endpoint | What it said | Signup / docs URL | EFFORT (for a human) | WORTH IT |
|---|---|---|---|---|---|
| `ai.mitosislabs_mitosis` | `https://mitosislabs.ai/api/mcp` | HTTP 401 | https://mitosislabs.ai | OAuth to a personal memory vault | **No credential needed — fix the probe instead.** Four declared tools (`get_pricing`, `search_docs`, `get_platform_status`, `list_skills`) are documented as no-sign-in. Re-probe those |
| `ai.moonlings_moonlings` | `https://moonlings.ai/api/mcp` | *"This tool requires authentication: connect via OAuth (you get a free starter grant) or send a Moonlings API key as a Bearer token. The free `ping` tool wo…"* | https://moonlings.ai | OAuth, free starter grant | Marginal — `ping` already rated. The two gated tools poll *reports the account created*, so they need a prior paid scan |
| `ai.foliora_search` | `https://www.foliora.ai/mcp` | HTTP 401 | https://www.foliora.ai/login; free preview at `/preview` | OAuth or read-scoped API key; *"costs an email address and nothing else — no card, no charge, no sales call"* | No — 2/3 already rated on public preview; the gated tool lists the account's own sites |
| `ai.forkmate_forkmate` | `https://mcp.forkmate.ai/` | HTTP 401 | https://app.forkmate.ai/auth/login?intent=sign-up | OAuth, *"Everything Forkmate does is free — no credit card, no plan to pick"* | No — reads someone's actual **food diary**. Free, but empty on a new account and personal data by nature |
| `ai.gondola_gondola` | `https://mcp.gondola.ai/mcp` | HTTP 401 | https://gondola.ai/mcp | OAuth inside the MCP client; free; account created as part of the flow | No — reads the traveler's **loyalty accounts and trip history**. Empty and personal |
| `ai.framethrower_framethrower` | `https://framethrower.ai/api/mcp` | `initialize`/`tools/list` 200; every `tools/call` → HTTP 401 `Unauthorized: Authentication required` (see verified findings below) | https://framethrower.ai/register | OAuth 2.1, free signup, $2 free credits. (A Settings → API token was reported earlier but is **unverified** — it is behind the login) | **Strongest runner-up.** Genuinely corpus-backed (5,489 films, read-only search) — the only own-identity server here that returns real data on a fresh account |
| `ai.betterpost_server` | `https://betterpost.ai/mcp` | HTTP 401 | https://betterpost.ai | Sign in with a BetterPost account, 100 free credits | No — generation-oriented, own-account |
| `ai.latticenet_latticenet` | `https://latticenet.ai/mcp` | HTTP 401 | https://latticenet.ai/login (public feed: `/spectate`) | Google/GitHub OAuth. **The sign-in is explicitly a personal vouch**: "a real person standing behind you"; a human may vouch for exactly one agent | No — the credential is a personal reputational endorsement of an agent. Not something to obtain for a rating harness. Note `/spectate` is public if we want a read surface |
| `ai.memoryrouter_memoryrouter` | `https://mcp.memoryrouter.ai/mcp` | HTTP 401 | https://app.memoryrouter.ai/signup | OAuth to a memory vault; 14-day trial then **$20/month** | No — paid after trial, own-account, and reads a personal memory store |
| `ai.decisionlog_mcp` | `https://www.decisionlog.ai/api/mcp` | HTTP 401 | https://www.decisionlog.ai/auth.md ; sign-in https://www.decisionlog.ai/sign-in | OAuth 2.1 PKCE with dynamic client registration for humans. **Machine clients using `client_credentials` "must be provisioned by an authorized Decision Log administrator"** — i.e. our use case is admin-gated | No — the machine path is effectively invite-only; the human path yields an empty append-only log |
| `ai.com.mcp_strava` | `https://strava.run.mcp.com.ai/mcp` | HTTP 401 | https://mcp.com.ai (HAPI gateway; auth not documented publicly) | OAuth as a **Strava user**, exposing that person's real activity history | No |
| `ai.com.mcp_linkedin` | `https://linkedin.run.mcp.com.ai/mcp` | HTTP 401 | https://mcp.com.ai | OAuth as a **LinkedIn user**, exposing a real profile; LinkedIn API access is itself partner-gated | No |
| `ac.inference.sh_mcp` | `https://api.inference.sh/mcp` | *"Authentication"* | https://app.inference.sh (auth docs `/docs/api/authentication`) | Account at app.inference.sh; pay-per-run model, free tier not documented | No — the probed tools list the account's own apps/knowledge/skills; empty on signup |
| `ai.betslipdoctor_mcp` | `https://api.betslipdoctor.ai/api/mcp` | HTTP 401 | https://betslipdoctor.ai (subscribe on web or in the iPhone app) | OAuth **as a paying subscriber**; $29.99 / $49.99 / $79.99 per month. Handshake: "each call runs as the one user whose OAuth grant authenticates the request" | No — paid *and* own-account |
| `ai.kontato_kontato` | `https://api.kontato.ai/mcp` | *"Sessao sem conta ativa. Passe `owner_phone` … NESTA chamada"* | (see full finding above) | A human supplies **a WhatsApp number they personally own**; `provision` binds the account to it and `verify_number` requires an OTP sent to that phone | **No.** Guessing a number provisions an account against a stranger's phone. Not ours to do |

---

## paid-tier — money changes hands before any tool call (10)

| Server | Endpoint | What it said | Signup / docs URL | EFFORT (for a human) | WORTH IT |
|---|---|---|---|---|---|
| `ai.mainbook_bank-statement-converter` | `https://mcp.mainbook.ai/mcp` | HTTP 401 | https://mainbook.ai/mcp, signup `/auth/signup` | Pay-as-you-go page credits, from $50 for ~277 pages. (10 free pages exist on the web UI with no signup, but not via MCP) | No — handshake itself warns `convert_bank_statement` "creates a paid page-credit job, so do not call it speculatively" |
| `ai.ccapi_mcp` | `https://api.ccapi.ai/mcp` | HTTP 401 | https://ccapi.ai/register | Account free, but *"add a small amount of credit to try the models"* — no free allowance. Handshake: "Every tool call consumes the account's balance" | No — we would be spending real money per probe |
| `ai.imaginode_imaginode` | `https://imaginode.ai/api/mcp` | HTTP 401 | https://imaginode.ai/profile | *"Get an API key at https://imaginode.ai/profile (verified account required)"*; every generation costs credits | No — verified account plus paid credits, for a generation surface |
| `ai.kifly_mcp` | `https://kifly.ai/api/mcp` | HTTP 401 | https://kifly.ai (docs `/docs`, hello@kifly.ai) | 14-day trial, then Starter $29/mo. Auth mechanism not documented | No |
| `ai.ninar_ninar` | `https://ninar.ai/mcp` | HTTP 401 | https://ninar.ai/auth/login-page | Free plan exists but **API access begins at the Scale tier, $299/month** | No — clearly out of proportion |
| `ai.myriade_myriade` | `https://app.myriade.ai/mcp/` | HTTP 401 | https://myriade.ai/request-trial | "Request trial" — sales-led, flat platform + seat pricing. No self-serve signup | No — contact sales, and the tools query *the customer's own warehouse* |
| `ai.getminds_minds` | `https://getminds.ai/mcp` | HTTP 401 | https://getminds.ai (Plans / Book demo) | No published self-serve path; pricing page reveals no tiers. Demo-led | No |
| `ai.memoket_memoket` | `https://mcp.memoket.ai/mcp` | HTTP 401 | https://memoket.ai | Access is bundled with a **$199 hardware device** (Memoket Gem); the MCP reads that device's recordings | No — hardware purchase, and own-account |
| `ai.com.mcp_contabo` | `https://contabo.run.mcp.com.ai/mcp` | HTTP 401 | https://mcp.com.ai (runMCP; Starter $9/mo, Pro $199/mo) | Requires a **paying Contabo hosting customer's** API credentials — a real cloud account with real servers | No — 1/3 already rated (`tool_search` is public); the other 123 tools manage live infrastructure |
| `ai.com.mcp_openai-tools` | `https://openai-tools.run.mcp.com.ai/mcp` | HTTP 401 | https://mcp.com.ai | Requires a **paid OpenAI API key**; every call bills OpenAI | No |

---

## invite-or-waitlist (1)

| Server | Endpoint | What it said | Signup / docs URL | EFFORT | WORTH IT |
|---|---|---|---|---|---|
| `ai.openmandate_mcp` | `https://mcp.openmandate.ai/mcp` | HTTP 401 | https://openmandate.ai/api-keys (site returns **HTTP 403** to us) | **None available.** The operator's own registry description reads: *"OpenMandate is in private development and is not accepting new mandates or integrations."* | No — closed by the operator's own statement. Record as `operator_closed`, not as a gap of ours |

---

## unknown (1)

| Server | Endpoint | What it said | Signup / docs URL | EFFORT | WORTH IT |
|---|---|---|---|---|---|
| `ai.meacheal_mrc-data` | `https://api.meacheal.ai/mcp` | HTTP 401 | https://meacheal.ai (links to https://api.meacheal.ai but publishes no auth, pricing, or signup) | Unknown — no discoverable signup, pricing, or key-issuance path | Unclear. The data (Chinese apparel supply chain, corpus-backed) would probe well, but there is no route in. Worth one email to the operator rather than any signup attempt |

---

## Attempt log: `ai.echoloc_company-technographics` (2026-09-08) — no credential obtained, and none needed

*Attempted 2026-09-08. No account was created, no form submitted, no email entered, no terms
accepted, no browser driven. Nothing was stored in `subject_credentials` because there is no
secret to store.*

### 1. The anonymous re-probe alone restores the missing tool

The original 2/3 was recorded on 2026-09-04 after we spent the day's five anonymous calls.
Re-probing on a fresh day, with the harness's own defaults (`initialize` → `tools/list` →
one `tools/call` per tool), **all three tools answered with real data and no credential**:

| Tool | Anonymous result |
|---|---|
| `search_companies_by_technologies` | `total: 13482` for Snowflake; five named companies with domain, industry, country, size band, `usage_count`, `hiring_velocity` |
| `get_company_by_domain` | `walgreens.com` → id, name, industry, country, `employees_range_min` — core fields only, plus a trim notice |
| `list_technologies` | `total: 10617`; Python 84,806 / AWS 60,624 / Power BI 58,350 … |

`initialize` and `tools/list` are explicitly uncharged ("Discovery … needs no key"), so the
handshake and the declared surface cost nothing at all.

**So the answer to "does re-probing alone fix it" is yes for the probe, and only partly for
the battery.** The anonymous allowance is **5 tool calls per day for the whole server**, and
`runBattery` issues up to eight calls per tool — baseline, differential, absence, fabrication,
injection, injection_control, malformed, determinism — across three tools, so **up to ~24**.
A full anonymous battery run gets roughly five calls in and is capped for the rest.

Two consequences worth writing down rather than rediscovering:

- **Coverage, not completeness.** Anonymously we can rate *that each tool works*
  (`functional_correctness / invocation_succeeds`) but not `no_fabrication`,
  `injection_resistance`, `input_sensitivity` or determinism, because those need the later
  calls in the battery. The trimmed anonymous payloads also flatten the very thing the server
  is differentiated on — the adoption-direction fields never appear in preview output.
- **The misfiling is already fixed in code.** `diagnoseInvocation`'s `RATE_LIMIT` pattern now
  matches "preview limit reached" and is tested *before* `AUTH_WALL`, so exhausting the cap
  now files as `harness_capability_unhealthy` ("we spent an allowance") rather than
  `harness_capability_missing` ("they need an account we lack"). Echoloc is the named case in
  that comment. A capped anonymous run is therefore recorded as **our** gap, which is correct.

### 2. Every automated route to a key is closed

Hunted in the order the playbook prescribes; each step is a fact from the server, not an
inference:

1. **Handshake instructions** name only the human signup page
   (`echoloc.ai/auth?mode=signup`) and `hello@echoloc.ai` for production keys. No endpoint.
2. **MCP non-tool surface is absent.** `resources/list`, `resources/templates/list` and
   `prompts/list` all return `-32601 Method not found`. There is no in-band registration tool
   — nothing like MarketIntell's `register_challenge`/`register`.
3. **No RFC 7591 dynamic client registration.** No `WWW-Authenticate` header is ever emitted
   (the server answers anonymous calls 200, and `api.echoloc.ai/api/user/api-key` answers a
   bare `401` with no challenge). `/.well-known/oauth-protected-resource`,
   `/.well-known/oauth-authorization-server`, `/.well-known/mcp` and `/register` on
   `api.echoloc.ai` all 404.
4. **No self-serve key endpoint.** The published OpenAPI 3.1 document
   (`api.echoloc.ai/openapi.json`) declares eight paths — `/api/v2/{search,facets,export,
   save-from-search}`, the three `/api/corporate/v1/*` data endpoints, and `/` — with
   `components.securitySchemes: null`. There is no auth, signup or key path in it.
5. **The real key route needs a logged-in session.** The web app fetches
   `GET https://api.echoloc.ai/api/user/api-key` with
   `Authorization: Bearer <Supabase access_token>`; unauthenticated it is `401`.
6. **Auth is Supabase, and its own public settings close the door.**
   `GET /auth/v1/settings` on the project reports `"mailer_autoconfirm": false`,
   `"anonymous_users": false`, and exactly two enabled providers: `email` and `google`. The
   signup handler in the app bundle confirms it — on success it switches to a `check_email`
   state reading *"Check your email for the confirmation link to complete registration."*

That leaves three doors, and all three are ones we do not walk through:

- **Email + password** requires a confirmation link delivered to a mailbox. We have none.
  (Recorded and stopped here, per the mailbox rule.)
- **Google** is a real person's identity. Inventing one is deception; using the owner's is
  not ours to do.
- **Anonymous Supabase sessions** are disabled server-side, so there is no identity-free
  session to trade for a key.

Independently of the mailbox, the signup form states *"By signing in, you agree to our Terms
of Service and Privacy Policy"* — affirmative terms acceptance that binds the account owner.
That is a stop condition on its own.

**Verdict:** still `free-api-key` *for a human* — genuinely 60 seconds, no card, no sales
call. Not obtainable by an automated client. And, unusually for this list, **nothing is
blocked on it**: echoloc is ratable today at 3/3 tools anonymously.

---

## Attempt log: `ai.lumify_sports-intelligence` (2026-09-08) — no credential obtained

The top pick above was worked end to end. It did not yield a key, and the reason is worth
recording precisely, because the row as originally written implied a route that does not
exist for an automated client.

**What the operator advertises.** Four separate machine-readable surfaces all say the same
thing: the MCP handshake `instructions`, the `lumify://docs/quickstart` resource,
`https://lumify.ai/.well-known/agent.json`, and `https://lumify.ai/.well-known/mcp/server-card.json`.
Each promises *"a working API key in seconds with no signup, email, or card"* via a
**Get instant trial key** button at https://lumify.ai/docs/ai (100 credits, 14-day expiry).

**What the implementation actually requires.** The button POSTs
`{"cf-turnstile-response": token}` to `POST /v1/trial-key`. The rendered button carries
`data-sitekey="0x4AAAAAAD3L7DdNP1YYrbzi"`, and the operator's own OpenAPI summary
(https://lumify.ai/openapi-llms.txt) states it without ambiguity:

> `POST /v1/trial-key` — Issue an instant, unauthenticated trial API key. Issues a throwaway
> API key with no signup or email verification — 100 lifetime credits, 14-day expiry, one per
> network per 7 days. **Requires a valid Cloudflare Turnstile token.** Intended for the
> 'Get instant trial key' button on /docs/ai, **not for building a persistent integration** —
> use /register for that.

Turnstile is bot detection. Driving a browser through it to mint a key for a rating harness
is exactly the circumvention we do not do, and the operator has additionally said in writing
that this key is not for a standing integration — which is what a stored credential is. Both
reasons are independent and both are terminal. **Not attempted. Named and stopped.**

**Every other route, checked and closed:**

| Route | Result |
|---|---|
| `resources/list` + `resources/read` | Fully **open** without a key — both `lumify://sports` and `lumify://docs/quickstart` read fine. Good conformance signal for the server; no credential in them |
| `tools/call` (e.g. `list_sports`) | HTTP **200** carrying JSON-RPC `-32001 Unauthorized: provide a valid Lumify API key as a Bearer token` |
| `/.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server`, `/.well-known/mcp` | All **404**. No OAuth metadata, so no RFC 7591 dynamic client registration to fall back on |
| `POST /api/agent/keys` (the documented "provision API access programmatically" recipe) | Chicken-and-egg by the operator's own note: *"needs an existing session or key to bootstrap"*. Same shape as MarketIntell's `register` tool |
| `GET /v1/estimate/tools`, `GET /v1/sports` | **401**. Even the endpoints documented as "always free" (zero credits) still require a key, so there is no unauthenticated read surface on the REST side |
| Published demo/sample key in the docs | None. Every `lmfy-` string in the docs, llms.txt, SKILL.md and OpenAPI dumps is a placeholder (`lmfy-...`, `lmfy-YOUR_KEY`, `lmfy-abc123.def456...`) |
| `POST /register` (the persistent 1,000-credit account) | Closed on **three** of our boundaries at once. The form requires `first_name` + `last_name` (a real person we do not have and will not invent), an `email` that must be verified before the free tier activates (no mailbox is available to us), and submitting it *is* the act of agreeing to the Terms of Service (binds the owner's company; theirs to accept, not ours) |

**Correction to the transcript.** `packages/collectors/transcripts/ai.lumify_sports-intelligence.json`
records `auth: {required: false, status: 200}` because `initialize` succeeds anonymously.
That is true but misleading: the wall is at `tools/call`, and it is signalled *in band* as a
JSON-RPC error inside an HTTP 200 rather than as an HTTP 401. Any auth classifier that only
watches HTTP status will mislabel this server. Worth a look at how many of the 439 are the
same shape.

**Verdict:** `free-api-key` for a human, `human_identity_required` for us. This is a gap of
ours (no mailbox, no legal authority to accept terms, no licence to pass a bot check), not a
failure of the operator's — Lumify publishes more agent-facing onboarding material than
almost anything else in the cohort. If the account owner wants this one, it is about five
minutes of their time at https://lumify.ai/register, and the resulting key drops straight
into `subject_credentials` as `tier: free`, `quota_note: "1,000 credits, non-expiring; 20 req/min"`,
`expires_at: null`.

---

## Attempt log: `ai.chronary_mcp` (2026-09-08) — no credential obtained

Worked end to end because the row promised the most agent-native onboarding in the cohort: a
documented `POST /v1/agent/sign-up` that hands back a working key *before* any human reads an
OTP. The endpoint is real and it does that. We still stopped, on a boundary that is not ours
to cross, and the second half of the row — the empty-account worry — is now confirmed from
the operator's own schema rather than guessed.

**The map, which the operator publishes in full.** `GET https://api.chronary.ai/openapi.json`
is open, 193 KB, and carries four custom extensions that exist to onboard an agent:

| Extension | Value |
|---|---|
| `x-agent-self-signup` | `{url: /v1/agent/sign-up, verify_url: /v1/agent/verify, restricted_key_returned: true, human_in_the_loop: "otp_email", rate_limit: "5 req/60s per IP"}` |
| `x-agent-bootstrap-script` | `npx @chronary/agent-init@latest` — "performs sign-up, prompts for OTP, verifies… accepts `CHRONARY_EMAIL` and `CHRONARY_OTP`" |
| `x-mcp-server-card` | https://chronary.ai/.well-known/mcp/server-card.json — names `obtain_via: https://api.chronary.ai/v1/agent/sign-up` |
| `x-api-catalog` | RFC 9727 linkset at https://chronary.ai/.well-known/api-catalog |

`GET /health`, `GET /v1/plans`, `GET /v1/capacity` (`{"percent_full":3,"status":"open"}`) and
`GET /v1/auth/terms/current` all answer unauthenticated. The free plan is as advertised:
**50,000 API calls/month, 3 agents, 10 calendars, 2,500 events, no card**.

**Why the OTP was not the blocker.** Worth stating, because the row implied it was. The
operator documents the sign-up response as returning `org_id` + `agent_id` + `api_key`
immediately, on an org in status `unverified`, plan `free-agent-unverified` — "fully usable
for reads and writes within the standard per-resource quotas". `POST /v1/agent/verify` only
*graduates the plan tier*. A mailbox would not have been needed to get a usable key.

**What actually stopped it: `tos_version` is a required field of the sign-up body.**

```
AgentSignUpBody: required [email, agent_name, tos_version]
GET /v1/auth/terms/current →
  {"version":"2026-05-11","effective_at":"2026-05-11",
   "url":"https://chronary.ai/terms/v/2026-05-11","material":true}
```

Submitting that string is not a version negotiation, it is the acceptance. The operator says
so about the sibling endpoint that takes the same field: it "appends an immutable row to
`tos_acceptances` … capturing the accepting org, client IP, user-agent, and the ToS document
SHA-256". And the document at that URL is a binding agreement with **Chronary LLC, a
Washington limited liability company**, whose §3 requires the accepting party to represent
that they are **18 or older with legal capacity**, and whose preamble requires that anyone
accepting on behalf of an organization **has authority to bind it**. Those are
representations no agent can truthfully make on the owner's behalf. **Named and stopped.**
The email requirement is a second, independent stop — §3 also requires a valid address, and
no mailbox is available to us.

**Every other route, checked and closed:**

| Route | Result |
|---|---|
| `initialize`, `tools/list`, `resources/list`, `resources/templates/list`, `prompts/list` | All **200** anonymously. 54 tools, 1 resource, 1 resource template, 4 prompts enumerated — metadata only |
| `resources/read chronary://about` | **401.** Unlike Lumify, the resource is listed but not readable, so there is no open resource to mine |
| `tools/call` — spot-checked `get_usage`, `list_agents`, `list_calendars`, `list_booking_pages`, `list_proposals`, `get_audit_log`, `list_webhooks`, `list_scoped_keys`, `accept_terms` | **401** on all nine. There is **no public MCP tool surface at all** — this server does not belong with the seven partially-gated ones above |
| `/.well-known/oauth-protected-resource`, `…/mcp`, `/.well-known/oauth-authorization-server`, `/.well-known/mcp` | All **404**, and the 401 carries no `WWW-Authenticate`. No OAuth metadata, so no RFC 7591 dynamic client registration |
| `POST /v1/agent/sign-up` | The only self-serve path. Closed on terms acceptance and on the email requirement, above |
| `POST /v1/invite/claim` / `GET /v1/invite/verify` | Public, but consume a **signed invite token delivered to an email captured at intake**. Token possession *is* the identity proof; we have no token and no inbox to receive one |
| `POST /v1/waitlist` | Public, but only files an intake row — "no organization is created until the prospect is approved by a founder". Needs an email, yields no key |
| `POST /v1/auth/claim/initiate` | Needs a console session JWT, which needs an account. Chicken-and-egg |
| `POST /v1/keys` (mint a scoped `chr_ak_`) | Requires an existing org key **and** the Pro plan (`scoped_keys: 0` on Free) |
| Published demo/sandbox key | None. Every `chr_sk_`/`chr_ak_` string in the OpenAPI, server card and llms.txt is a placeholder |
| Console signup via a browser | **Not attempted, deliberately.** It is the same two walls with a form in front of them — the page cannot be submitted without an email and a terms tick. Driving it would be doing by hand exactly what we declined to do over HTTP |

**The empty-account question, answered from the schema rather than assumed.** The row said
reads "come back empty"; that is right, and it is now checkable without a key. All 54 tools
are scoped to the caller's own organization — `list_agents`, `list_calendars`, `list_events`,
`get_availability`, `list_proposals`, `list_webhooks`, `list_booking_pages`,
`list_ical_subscriptions`, `get_audit_log` — and a fresh org owns none of those objects. The
single exception is `get_usage`, which would return real plan limits beside all-zero
counters: non-empty, but it is our own metering, not corpus data. Nothing in the tool surface
reads anything the account did not itself create. **A Chronary key would buy three empty
reads**, which is a worse rating input than the honest gap we have now. Everything Chronary
serves publicly — plans, capacity, health, terms, booking-page slots — is REST-only and
exposed through no MCP tool.

**Correction to the transcript.** `packages/collectors/transcripts/ai.chronary_mcp.json`
records `auth: {required: false, status: 200}` and no `tools/call` attempt, because the
probe reads auth off the `initialize` hop alone. Auth is required for **everything that
matters** here. This is the same classifier defect flagged on Lumify arriving by the opposite
route: Lumify returns an in-band JSON-RPC error inside an HTTP 200, Chronary returns a
textbook HTTP 401 — and *both* are recorded as `required: false` because neither wall is at
`initialize`. The field is measuring handshake auth and being read as tool auth.

**Verdict:** `free-api-key` for a human, `terms_acceptance_required` for us. Roughly two
minutes of the owner's time at https://console.chronary.ai/signup — but it should be spent
only if the owner also wants to *populate* the account, because the credential alone does not
make this server ratable. Recommend leaving `ai.chronary_mcp` unrated and recording the gap.

---

## Attempt log: `ai.framethrower_framethrower` (2026-09-08) — no credential obtained, but the flow is now one command

*No account was created, no form submitted, no email entered, no terms accepted, no browser
driven. Nothing was stored in `subject_credentials` because there is no secret to store.*

The runner-up was worked end to end. Unlike lumify and chronary, **nothing here is
circumvention-shaped and nothing is ambiguous** — the server implements the MCP authorization
spec properly, and the wall is exactly one step wide: a human sign-in.

**Where the wall actually is.** Confirmed by direct probe, not inferred:

| Call | Result |
|---|---|
| `initialize` | **200**, full `instructions` returned |
| `tools/list` | **200**, all four tools declared |
| `tools/call search_frames` | **401** — `{"code":-32000,"message":"Unauthorized: Authentication required","www-authenticate":"Bearer resource_metadata=..."}` |

**Correction to the transcript.** `packages/collectors/transcripts/ai.framethrower_framethrower.json`
records `auth: {required: false, status: 200}`. This is the **same misclassification found on
lumify**, arrived at independently: the handshake is anonymous, so a classifier watching only
the handshake's HTTP status calls the server open. FrameThrower is the better-behaved case of
the two — it returns a real HTTP 401 *and* a spec-compliant `WWW-Authenticate` header naming
its resource metadata, so the fix is available to us and cheap. **Two of two servers checked
this way were mislabelled; this should be treated as a systematic defect in the auth classifier
rather than two anecdotes.**

**Every automated route, checked and closed:**

| Route | Result |
|---|---|
| `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server` | **Both 200.** Unlike lumify, full OAuth 2.1 metadata is published |
| `registration_endpoint` (RFC 7591 dynamic client registration) | **Open.** Returns a `client_id` with `token_endpoint_auth_method: none` to an anonymous POST. No vendor-side app pre-registration needed, no personal data, no terms — this is the standard MCP client bootstrap |
| `client_credentials` grant | **Not supported.** `grant_types_supported` is `["authorization_code","refresh_token"]`, and `POST /api/auth/mcp/token` with `grant_type=client_credentials` returns `{"error":"invalid_request","error_description":"code is required"}`. **There is no machine path to a token** |
| `GET /api/auth/mcp/authorize` with a valid PKCE challenge | **302 → `/login`.** The authorization endpoint hands off to a human sign-in page. This is the terminal step |
| `https://framethrower.ai/register` | Email + password, or **Continue with Google**; the page carries a `termsOfService` link and confirms the **$2 free credits**. Creating it binds the owner's identity and accepts the vendor's terms — theirs to accept, not ours |
| Settings → API token (claimed in the original row) | **Unverified and unverifiable** — it sits behind the login. The row above has been corrected to say so rather than repeat it as fact |

**What was built instead:** `packages/collectors/scripts/obtain-oauth-credential.mts`. It does
every part of the flow that is *not* the human step — discovery from the resource metadata,
dynamic client registration, PKCE S256, the localhost callback listener, the token exchange,
verification against `userinfo`, and the encrypted write via `putCredential` — so the owner's
share of the work is signing in and closing a tab. It refuses to start unless `DATABASE_URL`
and `TRUST_INDEX_CREDENTIAL_KEY` are both set, because obtaining a token we cannot store would
put a live secret in a terminal, and it carries the package's `--i-have-approval` gate. The
whole automated portion is verified working end to end against FrameThrower; only the sign-in
is outstanding. It takes `--endpoint`/`--subject-id`, so it should work unchanged against any
of the other 14 `oauth-user-account` servers that publish the same metadata.

**One limitation this surfaced, worth fixing before the OAuth servers are onboarded in bulk.**
`subject_credentials` has a single `secret_ct` slot and `applyCredential` sends it as the
bearer, so **a refresh token has nowhere to live.** FrameThrower's access token is time-boxed;
when it lapses the row goes stale and a human must re-run the script. For one server that is
fine, and `staleCredentials()` will surface it before a run mistakes it for the subject's
failure — but across 15 OAuth subjects it becomes recurring human toil that a refresh-token
column would remove entirely.

**Verdict:** `oauth-user-account` for a human, `human_identity_required` for us — a gap of
ours, not a failure of the operator's. FrameThrower is the best-behaved auth implementation
found in this cohort. It remains the strongest runner-up: corpus-backed (5,489 films), four
declared read-only tools, and real data on a brand-new account. If the owner wants it, it is
one command plus a sign-in, and the token lands in `subject_credentials` as `tier: free`,
`scheme: bearer`, with `expires_at` set from the token response.

---

## Attempt log: `ai.klarix_intelligence` (2026-09-08) — no credential obtained

*No account was created, no form submitted, no email entered, no terms accepted, no browser
driven. Nothing was written to `subject_credentials`.* The row promised the cheapest kind of
signup on this list — one field, key returned on screen, no confirmation link — and that part
is true. It closed anyway, on two boundaries, and the "WORTH IT" column turned out to be
wrong for a reason that has nothing to do with the wall.

**Where the wall actually is.** Not at the handshake. `initialize`, `tools/list` and
`resources/list` all answer **200 anonymously**; `resources/read klarix://status` and every
`tools/call` answer **401** with `WWW-Authenticate: Bearer realm="klarix-mcp"` and a JSON-RPC
`-32002 AUTH_HEADER_MISSING`. The error copy is unusually good — it names all three accepted
headers, links the signup page, and warns that a proxy may have stripped `Authorization` so
retry on `X-Api-Key`.

**Every route, hunted in the playbook's order:**

| Route | Result |
|---|---|
| `handshake.instructions` | Names one path only: https://klarix.ai/mcp#get-key. No endpoint, no in-band registration tool |
| `resources/list` → `resources/read` | Lists exactly one resource, `klarix://status`. Reading it is **401** — unlike Lumify, there is no open resource to mine |
| `WWW-Authenticate` → RFC 9728 / RFC 7591 | The challenge carries a bare `realm` and no `resource_metadata`. `/.well-known/oauth-protected-resource{,/mcp}`, `/.well-known/oauth-authorization-server{,/mcp}` and `/.well-known/openid-configuration` are **401 on `mcp.` and `api.`** (the auth middleware answers before routing, so the 401 is not even evidence the route exists) and **404 on `klarix.ai`**. No OAuth metadata, therefore no dynamic client registration |
| `/.well-known/mcp` | **Open**, on both `mcp.` and `api.`: an MCP server card v1.0 declaring `authentication: {required: true, schemes: ["bearer"]}` and all 15 tools with their plan tier. Good conformance signal; no key in it |
| Published REST surface | `GET /v1/health`, `/v1/tools`, `/v1/whoami` and `/openapi.json` on `api.klarix.ai` answer **200 without a key** — `whoami` is explicitly the "what did the server receive" debugger and costs no credit. Genuinely useful, and it is the operator's own agent-facing courtesy |
| `/v1/{keys,keys/free,auth/signup,auth/challenge,signup,register,trial,account,free-key,mcp/keys}` | All **401** from the same middleware — indistinguishable from 404. The OpenAPI 3.1 document (both copies, `klarix.ai/openapi.json` and `api.klarix.ai/openapi.json`) declares 18 paths and **none of them issues a key**. No MarketIntell-style proof-of-work endpoint exists here |
| `llms.txt` / `llms-full.txt` | Both published and both agent-addressed. Both point key acquisition at the same human page. Auth section says only `Bearer klx_live_…` from `klarix.ai/mcp#get-key` |
| Portal (`app.klarix.ai/login`, "Settings → API keys" per the API docs) | A client portal behind a login. Needs an account that only the web form or a sales engagement creates |
| The web form itself | **Named and stopped — see below** |

**Why the form was not submitted.** Two independent stops, either one sufficient:

1. **It is bot-gated, and their terms say so in words.** The form (chunk
   `/_next/static/chunks/03ja1w7.gfe1~.js`) POSTs `{email}` to `POST /api/mcp/keys` on
   `klarix.ai` and renders the key inline — *"Copy this key now. We only show the full value
   once."* Beside the visible email input it carries
   `<input type="text" name="website" tabIndex={-1} className="hidden" aria-hidden>` — a
   honeypot, i.e. bot detection, on the one issuance path. And Klarix's Terms of Service §12
   Acceptable Use reads, verbatim: *"Use automated systems (bots, scrapers) to access or
   extract data from our website."* Submitting that form from a script **or** from a driven
   browser is the automated website access they prohibit, on a form built to catch exactly
   that. Not attempted.
2. **Issuing the key binds the owner's company.** ToS §1: *"By accessing klarix.ai … or using
   services provided by Klarix … you agree to be bound by these Terms. If you are entering
   into these Terms on behalf of a company or organization, you represent and warrant that
   you have authority to bind that entity."* There is no checkbox on the form, so this is
   browse-wrap rather than a click — but the account would be keyed to a work email, and the
   only truthful address available is the owner's real published one. Enrolling it, and the
   representation that comes with it, is theirs to make. (No mailbox is available to us
   either; that one is *not* the blocker here, since the key is displayed rather than
   emailed.)

**The finding that actually decides this row: a free key would not buy us much.** The
"WORTH IT" column said yes-with-a-caveat about credits. Two harder facts:

- **2 of the 3 tools the planner selected are Pro+.** We probe `find_matched_prospects`
  (Pro+), `get_competitor_battlecard` (Free) and `score_prospect_fit` (Pro+). The operator
  states plainly that *"free keys cannot call Pro+ tools"*, so a free key unblocks **one of
  our three probed tools** unless the plan is re-selected against the seven free narrative
  tools first — the same probe-selection defect flagged for Mitosis above.
- **25 credits is one battery run, once, ever.** `runBattery` issues up to eight calls per
  tool; three tools is up to ~24 calls against a **one-time, non-renewable** 25-credit
  allowance. `initialize` and `tools/list` are free, but every `tools/call` spends a credit.
  The first full run would exhaust the account, and every later run would file as
  `harness_capability_unhealthy` — our spent allowance, correctly recorded as our gap, but a
  gap that never reopens.

**Correction to the transcript — the same defect again.**
`packages/collectors/transcripts/ai.klarix_intelligence.json` records
`auth: {required: false, status: 200}` because `initialize` succeeds anonymously, exactly as
Lumify, Chronary, FrameThrower and Drillr do. `probe.ts` sets `auth.required` from the
handshake hop alone (`probe.ts:240`), and `assess.ts:359` / `select.ts:433` both read that
field as though it described tool auth. Klarix is a clean HTTP 401 at `tools/call`, Lumify is
an in-band JSON-RPC error inside a 200, Chronary is a 401 on everything but the handshake —
every one of them recorded as `required: false`. The scoring is *not* wrong today (the call layer diagnoses its
own 401s and files `harness_capability_missing`, `capability: mcp_account`, which is what the
klarix rows in `assessment.json` show), so this is a metadata defect rather than a
mis-rating. But it means the transcript's `auth` block cannot be used to answer "how many of
the 439 are auth-walled", and three of the servers worked by hand are already this shape.

**Verdict:** `free-api-key` for a human, `terms_acceptance_required` + `bot_check_present`
for us. About thirty seconds of the owner's time at https://klarix.ai/mcp#get-key with a work
email; the key appears on the page and drops into `subject_credentials` as `scheme: header`,
`param_name: x-api-key` (or `bearer`), `tier: free`, `quota_note: "25 one-time credits,
non-renewable; 7 free tools, 8 tools Pro+"`, `expires_at: null`. **Recommend not spending it
yet** — re-select the probe plan onto the free-tier tools first, or the one-shot allowance is
spent on two tools the key cannot call.

---

## Attempt log: `ai.creativescope_creative-intelligence` (2026-09-08) — no credential obtained

*No account was created, no form submitted, no email entered, no terms accepted, no browser
driven, no payment offered. Nothing was stored in `subject_credentials` because there is no
secret to store.*

This was the fourth pick on the list below, chosen for one reason: **10 calls/day free
forever** is the only genuinely renewable daily allowance in the whole triage, which is exactly
the shape a daily rating job wants. The allowance is real. It is not reachable by us, and —
separately, and more usefully — it would not have rated this subject even if it were.

### 1. Every automated route to a key is closed

Hunted in the prescribed order; each step is a fact from the server, not an inference.

1. **Handshake instructions: none.** `initialize` returns `instructions: null`. It does carry a
   `serverInfo.description` naming the signup page
   (`https://www.creativescope.ai/account?utm_source=mcp&utm_medium=agent&utm_campaign=mcp_signup`)
   — a human page, not an endpoint.
2. **The MCP non-tool surface is walled; `tools/list` is not.** `initialize` and `tools/list`
   answer 200 anonymously. `resources/list`, `resources/templates/list`, `prompts/list` and
   `tools/call` all answer **HTTP 401** with
   `{"error":"authorization_required","error_description":"OAuth authorization or an API key is
   required. Get a free API key at https://creativescope.ai/mcp", …}`. The usual "read the docs
   resource" move is unavailable here: the resource surface sits behind the same wall as the
   tools.
3. **RFC 9728 → RFC 8414 → RFC 7591 all work, and none of it helps.** This is the most fully
   specified auth chain in the triage, and it is worth recording precisely because it *looked*
   like the win:
   - `WWW-Authenticate: Bearer resource_metadata="https://mcp.creativescope.ai/.well-known/oauth-protected-resource", scope="mcp:use"`
   - that document resolves and names `authorization_servers: ["https://api.creativescope.ai"]`
   - `https://api.creativescope.ai/.well-known/oauth-authorization-server` resolves and
     advertises `registration_endpoint: /oauth/register`, `code_challenge_methods_supported:
     ["S256"]` and `token_endpoint_auth_methods_supported: ["none"]` — a textbook public-client
     setup — and, decisively, **`grant_types_supported: ["authorization_code",
     "refresh_token"]`**.
   - `POST /oauth/register` genuinely works unauthenticated: `201` with a `client_id`, for a
     client registered truthfully as `Nibbin Trust Index` / `https://nibbin.ai`. **Dynamic
     client registration is not the wall.**
   - `GET /oauth/authorize` (with PKCE, `scope=mcp:use`, and the `resource` parameter it
     requires — RFC 8707; omitting it returns `invalid_target`) then serves the CreativeScope
     **account page**. The authorization step is a human sign-in.
   - `POST /oauth/token` with `client_credentials`, `device_code` or `password` returns
     `unsupported_grant_type: "Only authorization_code and refresh_token grants are
     supported."` `/oauth/device_authorization`, `/oauth/device/code` and `/oauth/par` all 404.

   **The lesson to carry to the other 438:** a working RFC 7591 registration endpoint is not a
   credential. It issues a *client*, not an *account*. Without a machine grant type —
   `client_credentials` above all — DCR gets you exactly as far as the login page. Check
   `grant_types_supported` *before* spending effort on a registration flow.
4. **No self-serve key endpoint.** Swept the API host: `/v1/auth/{signup,challenge,register}`,
   `/v1/keys`, `/api/keys`, `/signup`, `/api/{signup,register,free-key,trial,anonymous}`,
   `/api/agent/{register,sign-up}`, `/v1/agent/sign-up`, `/api/auth/*` — all 404. There is no
   MarketIntell-style in-band registration here.
5. **The real signup route, read out of the vendor's own bundle.** The account page's Nuxt
   chunks name it exactly: `POST /api/overseas/auth/code` → `POST /api/overseas/auth/verify`,
   with `POST /api/overseas/auth/google` as the alternative. Both confirmed live on
   `api.creativescope.ai` by posting an **empty** body — `{"message":"Enter a valid email
   address."}` and `{"message":"Google credential is required."}`. No address was ever
   submitted, so no mail was sent to anybody.

### 2. The two things that stop us, stated plainly

The register form in `AuthDialog` is three fields and a checkbox, and its own copy settles it:

- **Work email\*** (required) — *"No password — we email you a 6-digit code."* The flow is
  send-code → enter-code → *"Verify & create account"*. **There is no path to an account that
  does not require receiving an email.** We have no mailbox. Recorded and stopped, per the
  mailbox rule.
- **Company** (optional — and the only field we could have filled truthfully).
- **A required checkbox**: *"I agree to the Terms and Privacy Policy"*, `required` in the
  markup, guarded by *"Please agree to the Terms and Privacy Policy before continuing."* The
  Google button is disabled behind the same checkbox (`aria-label="Agree to the Terms and
  Privacy Policy to continue with Google"`). The Terms say *"By creating an account or using
  the Service, you agree to these Terms"* and require being *"at least 18 years old and able to
  form a binding contract"* with Hong Kong Chengguo Shuhang Information Technology Co.,
  Limited. **That is a contract and it binds the owner's company. Theirs to accept, not ours.**
  Recorded and stopped.

**Worth saying because it is unusual:** there is **no CAPTCHA and no bot detection** anywhere
in this flow — no Turnstile, no reCAPTCHA, no hCaptcha in any bundle, and DCR is open to an
unauthenticated POST. Unlike Lumify, nothing here was technically stopping us. The wall is
purely identity and contract, which is the cleanest possible statement of why this is the
owner's decision and not a harness gap.

### 3. The finding that outlives the credential: a free key would not rate this subject

The row promised "three probes/run fit trivially" inside 10 calls/day. The call budget is fine.
The **tier** is not:

| Tier | Tools |
|---|---|
| **Free** | rankings only — `get_creative_rankings`, `get_game_rank_markets`, `get_game_rank_trend` |
| **Pro / Team** | `search_creatives`, `get_creative_detail`, `find_similar_creatives`, `search_advertisers`, `get_advertiser_profile`, `generate_weekly_creative_brief`, the three `*reference_image_search*` tools |

The three tools our planner selected for this subject in `assessment.json` are
**`search_advertisers`, `get_reference_image_search_status` and
`get_reference_image_search_results`** — all three Pro. A free key would have turned three
`HTTP 401`s into three plan-gate errors and rated nothing, while *looking* like a credential
success. (The two image tools are also async job pollers seeded with an invented `job_id`, so
they would fail on a paid key too.)

Two defects are stacked here, and the credential is the smaller one:

- **Probe selection ignores tier.** `get_creative_rankings` — free, corpus-backed, and exactly
  the read-only shape we want — was available and was not chosen. Same class of defect as the
  Mitosis row above: we pick tools without regard to which ones we can reach.
- **A plan gate is not an auth wall.** If a credentialed run ever hits these tools, the refusal
  is "your plan does not include this tool" — neither a server failure nor
  `harness_capability_missing`. It belongs with the echoloc rate-limit fix: our constraint,
  recorded as ours.

**Correction to the transcript.** `packages/collectors/transcripts/ai.creativescope_creative-intelligence.json`
records `auth: {required: false, status: 200, scheme: null}`. Auth is required for every tool
call, every resource and every prompt, and the server announces it correctly — HTTP 401 plus a
well-formed `WWW-Authenticate` challenge naming both the scheme (`Bearer`) and the scope
(`mcp:use`). This is another server whose recorded `auth` block is wrong because the probe
reads auth off the `initialize` hop alone: Lumify hid it in a 200, Chronary and Echoloc
answered a bare 401, CreativeScope answers a fully compliant one — and all of them are filed
`required: false`. The field measures handshake auth and is being read as tool auth.

**Verdict:** `email_verification_required` **and** `terms_acceptance_required` — either alone
would stop us. About 30 seconds of the owner's time at https://creativescope.ai/mcp if they
want it. Recommend leaving `ai.creativescope_creative-intelligence` unrated and recording the
gap — **and fixing the probe selection first**, because that is worth more here than the key.

---

## Recommendation: the five to pursue first

Chosen for **corpus-backed data** (real results on a fresh account), a **renewable or
non-expiring free allowance** (survives repeat assessment runs), and **read-only tool
surfaces** that match how we probe.

1. **`ai.lumify_sports-intelligence`** — 1,000 non-expiring free credits, no card, full
   endpoint access, 24 declared read-only tools. Still the best return on effort, but the
   effort is now known to be **the owner's, not ours**: the advertised "zero-signup
   instant-key" path turned out to be Turnstile-gated, and `/register` needs a real name, a
   verifiable mailbox, and terms acceptance. See the attempt log above. Five minutes of a
   human's time; nothing more we can do on it.
2. **`ai.drillr_drillr`** — `list_tables` / `get_table_schema` / `run_sql` over 90+ financial
   tables is almost a purpose-built read-only probe surface, and 80 non-expiring free credits
   are offered. **Worked end to end 2026-09-08 (attempt log below): no path for us.** It is
   `oauth-user-account`, not `free-api-key` — both the OAuth flow and the `/account/api-keys`
   key terminate at a Supabase signup that needs email confirmation (no mailbox) and terms
   acceptance (owner's). One-command FrameThrower flow plus a human sign-in if the owner wants it.
3. ~~**`ai.echoloc_company-technographics`**~~ — **done, and it cost nothing.** The cheapest
   action was not a signup: re-probing it anonymously on a fresh day answered all three
   tools. See "Echoloc: the re-probe worked; the key is not obtainable by us" below. A key is
   still free/instant/100-req-month for a human, but it is now an upgrade, not an unblock.
4. **`ai.creativescope_creative-intelligence`** — 10 calls/day *free forever* is the only
   truly renewable daily allowance found; three probes/run fit trivially, and the data is
   vendor-side.
5. **`ai.marketintell_marketintell`** — corpus-backed market data, and its in-band
   proof-of-work signup issues a free key from `{challenge_id, nonce, name}` with **no email,
   no form, and no terms to accept**. That makes it the lowest-legal-friction credential on
   the list — though it still creates an account, so it remains the owner's decision.

**Runner-up:** `ai.framethrower_framethrower` — the only own-identity/OAuth server that
returns real corpus data on a brand-new account (5,489 films, read-only search), free signup
with $2 credits.

### Two things worth doing before obtaining any credential at all

- **Re-probe the seven partial servers on their public tools** (table above). Mitosis alone
  moves from "un-ratable" to rated with no credential, and echoloc's failure was a rate limit
  we could simply wait out — now demonstrated rather than predicted.
- **Fix the pre-flight-config gap in the harness.** Four servers (datamerge, facesign,
  novence, dataecho) expect a setup tool call before the read tools. Until we can drive that,
  a valid credential would not help — and our current gap label quietly implies operator
  fault where none exists.

---

## Attempt log: `ai.drillr_drillr` (2026-09-08) — no credential obtained; oauth-user-account, not free-api-key

*No account was created, no form submitted, no email entered, no terms accepted, no browser
driven (the environment's proxy blocks it — see below). Nothing was stored in
`subject_credentials` because no secret could be obtained without crossing a boundary that is
the owner's to cross.*

The top-ranked pick above was worked end to end. `list_tables` / `get_table_schema` /
`run_sql` over 90+ financial tables is exactly the read-only surface the row promised — the
data would probe well. But **the row's classification is wrong: this is `oauth-user-account`,
not `free-api-key`.** Both credentialing paths drillr offers terminate at a drillr.ai account
sign-in, and account creation crosses two of our hard boundaries at once.

**Where the wall is** (direct probe, not inferred):

| Call | Result |
|---|---|
| `initialize` | **200**, full `instructions` returned (handshake is anonymous) |
| `resources/list`, `prompts/list` | **`-32601 Method not found`** — server declares only `tools`, so avenue (2), open resources, does not exist here |
| `tools/call list_tables` (unauthenticated) | **401** `{"error":"Unauthorized"}`, header `WWW-Authenticate: Bearer resource_metadata="https://gateway.drillr.ai/.well-known/oauth-protected-resource"` |

**Transcript correction.** `packages/collectors/transcripts/ai.drillr_drillr.json` records
`auth: {required: false, status: 200}` — the **same handshake-vs-tool misclassification** found
on lumify and framethrower, a third instance of the systematic classifier defect. The handshake
is open; the wall is at `tools/call` and is a spec-compliant 401 + `WWW-Authenticate`.

**Every automated route, checked and closed:**

| Route | Result |
|---|---|
| `/.well-known/oauth-protected-resource` (+ `/mcp/data` variant) and `/.well-known/oauth-authorization-server` | **All 200.** Full OAuth 2.1 metadata published; AS = `https://gateway.drillr.ai` |
| `registration_endpoint` (RFC 7591 dynamic client registration) | **Open and anonymous.** `POST /oauth/register` → **201** with a `client_id` and `token_endpoint_auth_method: none`, reproducibly, no personal data. This is the standard MCP client bootstrap and it is *not* the wall |
| `client_credentials` grant | **Not supported.** `grant_types_supported` = `["authorization_code","refresh_token"]`; `POST /oauth/token grant_type=client_credentials` → **400 `unsupported_grant_type`**. No machine path to a token |
| `GET /oauth/authorize` with valid PKCE S256 + `resource` | **302 → `https://drillr.ai/oauth/consent?mcp_state=…`.** The authorization endpoint hands off to a human consent page that requires a logged-in drillr.ai session. Terminal human step |
| `gateway.drillr.ai` HTTP surface (`/`, `/docs`, `/openapi.json`, `/v1/auth/*`, `/api/keys`, `/signup`) | **All 404.** No in-band signup endpoint (unlike MarketIntell's proof-of-work path) |
| `drillr.ai/signup` account creation | **Supabase GoTrue email/password (or Continue with Google).** The auth bundle carries "confirm your email" / "Verify" (email confirmation) and an affirmative Terms/Privacy step (`/api/legal/accept`, "agree to"). `drillr.ai/pricing` confirms the free tier: **80 credits, non-expiring, no card, key at `/account/api-keys`** — but the key page sits behind the login |

**Two boundaries, either one disqualifying for us:**
- **Email confirmation with no mailbox.** GoTrue signup requires a real address and an emailed
  confirmation. No mailbox is available to the rater — record and stop.
- **Affirmative terms acceptance.** Signup requires accepting drillr's Terms/Privacy, which
  binds the owner's company — theirs to accept, not ours.

The "Continue with Google" alternative needs a real personal Google identity — also not ours.

**Environment note (not drillr's fault, ours to record):** the pre-installed Chromium cannot
tunnel through this session's agent proxy — every navigation, drillr and `example.com` alike,
returns `ERR_CONNECTION_RESET` (proxy `recentRelayFailures`: `ws_closed_mid_exchange`). So the
web-signup avenue (avenue 5) could not even be driven to observe the form. `guardedFetch`
(node, direct egress) worked throughout; only the browser path is unavailable here.

**No new code needed.** drillr publishes the same OAuth 2.1 metadata FrameThrower does, so
`packages/collectors/scripts/obtain-oauth-credential.mts --endpoint https://gateway.drillr.ai/mcp/data
--subject-id ai.drillr/drillr` drives the entire automated portion (discovery, DCR, PKCE,
callback, token exchange, encrypted write). Only the account-creation-plus-consent step is
outstanding, and that is the owner's.

**Verdict:** `oauth-user-account` for a human, `email_confirmation_required` + `terms_acceptance_required`
for us — a gap of ours, not a failure of the operator's. The row in the free-api-key table above
should be re-read in light of this: the *key* is self-serve, but only from inside an account
whose creation we cannot complete. If the owner wants it, it is the one-command FrameThrower flow
plus a sign-in; the token would land as `tier: free`, `scheme: bearer`, quota **80 non-expiring
credits**.
