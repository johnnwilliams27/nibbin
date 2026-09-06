# Auth triage — the 49 servers we cannot currently rate

**Status:** research only. Nothing here has been signed up for, agreed to, or paid for.
No account was created, no form submitted, no email entered, no terms accepted. Every row
below is a decision for the account owner to make.

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

### 2. Seven servers are gated on *some* tools only — we can rate the public surface now

| Server | Public surface | Gated surface |
|---|---|---|
| `ai.compeller_compel` | `get_capabilities`, `list_styles` (2/3 probed OK) | `search_music` |
| `ai.echoloc_company-technographics` | `search_companies_by_technologies`, `get_company_by_domain` (2/3 OK) | `list_technologies` — and we only failed it because we **hit the 5-calls/day anonymous cap**, not because it is gated |
| `ai.foliora_search` | `get_product`, `get_snapshot` (2/3 OK) | `list_sites` |
| `ai.dataecho_mcp` | `get_site` (1/3 OK); `publish_site` also works anonymously | `list_sites`, `search_sites` |
| `ai.moonlings_moonlings` | `ping` (1/3 OK) — server explicitly documents it as free | `check_report_status`, `get_report_result` |
| `ai.com.mcp_contabo` | `tool_search` (1/3 OK) | 123 Contabo API tools |
| `ai.mitosislabs_mitosis` | **none probed** — but the server's own instructions say `get_pricing`, `search_docs`, `get_platform_status`, `list_skills` "need no sign-in" | the 8 `cortex_*` tools |

**Action independent of any credential:** re-run the probe planner against these seven with
public tools selected. Mitosis in particular is currently recorded as fully un-ratable when
it has four declared no-auth tools; that is a **probe-selection defect on our side**, not an
auth wall. Echoloc is a rate-limit artefact, not an auth wall — re-probing on a fresh day
likely clears it with no credential at all.

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
| `ai.lumify_sports-intelligence` | `https://lumify.ai/mcp` | `Unauthorized` (HTTP 401); handshake: *"Read the lumify://docs/quickstart resource … including the zero-signup instant-key auth path"* | https://lumify.ai/register | Create account, key instant, no card. 1,000 free credits that **never expire**, full endpoint access, 20 req/min. Server also advertises a zero-signup instant-key path in its own quickstart resource | **Yes — top pick.** Corpus-backed, 25 declared read-only tools, renewable-equivalent allowance |
| `ai.drillr_drillr` | `https://gateway.drillr.ai/mcp/data` | HTTP 401 | https://drillr.ai/signup → key at `/account/api-keys` | Create account, "free credits to start", key self-serve | **Yes.** `list_tables` / `get_table_schema` / `run_sql` over 90+ financial tables is close to an ideal read-only probe surface — real data, no account population needed |
| `ai.echoloc_company-technographics` | `https://api.echoloc.ai/mcp` | *"Anonymous preview limit reached (5 calls/day). … Free beta key (100 requests/month, instant)"* | https://echoloc.ai/auth?mode=signup&returnTo=%2Fapp%2Fapi (key at https://echoloc.ai/app/api; details https://echoloc.ai/for-agents/) | Sign up, copy key from the API page. Free beta 100 req/month | **Yes — cheapest win.** Already 2/3 rated. The failure is a *rate limit*, not a wall; a key removes it and un-trims results. Try a re-probe first |
| `ai.creativescope_creative-intelligence` | `https://mcp.creativescope.ai/mcp` | HTTP 401 | https://creativescope.ai — "Get free API key" | *"Sign up with your email. 30 seconds, no card."* 10 calls/day **free forever** | **Yes.** Renewable daily allowance survives repeat probing; corpus-backed ad-creative data |
| `ai.marketintell_marketintell` | `https://api.marketintell.ai/mcp` | HTTP 401; handshake names both paths | https://marketintell.ai/signup **or** in-band `register_challenge` → `register` | **Notable:** the second path is SHA-256 proof-of-work self-signup taking only `{challenge_id, nonce, name}` — **no email, no form, no ToS click**. Issues a Free-tier key | **Yes.** Corpus-backed market data, and the lowest legal friction of anything on this list. Still account creation, so still the owner's call |
| `ai.klarix_intelligence` | `https://mcp.klarix.ai/mcp` | HTTP 401; handshake lists free vs Pro tools | https://klarix.ai/mcp#get-key | Work email → free key. 25 **one-time** credits, 7 free read-only narrative tools | Yes, with a caveat: 25 credits is a burn-down, not renewable, so it may not survive repeat assessment runs |
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
| `ai.framethrower_framethrower` | `https://framethrower.ai/api/mcp` | HTTP 401 | https://framethrower.ai/register | OAuth 2.1, free signup, $2 free credits; an API token is also available in Settings → API | **Strongest runner-up.** Genuinely corpus-backed (5,489 films, read-only search) — the only own-identity server here that returns real data on a fresh account |
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

## Recommendation: the five to pursue first

Chosen for **corpus-backed data** (real results on a fresh account), a **renewable or
non-expiring free allowance** (survives repeat assessment runs), and **read-only tool
surfaces** that match how we probe.

1. **`ai.lumify_sports-intelligence`** — 1,000 non-expiring free credits, no card, full
   endpoint access, 25 declared read-only tools, and the server documents its own
   "zero-signup instant-key" path. Best return on effort on the entire list.
2. **`ai.drillr_drillr`** — `list_tables` / `get_table_schema` / `run_sql` over 90+ financial
   tables is almost a purpose-built read-only probe surface, and free credits are offered.
3. **`ai.echoloc_company-technographics`** — the cheapest action here is not a signup at all:
   **re-probe it.** We failed one tool on a 5-calls/day anonymous cap, not an auth wall. If a
   key is still wanted, it is free, instant, and 100 req/month.
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
  moves from "un-ratable" to rated with no credential, and echoloc's failure is a rate limit
  we can simply wait out.
- **Fix the pre-flight-config gap in the harness.** Four servers (datamerge, facesign,
  novence, dataecho) expect a setup tool call before the read tools. Until we can drive that,
  a valid credential would not help — and our current gap label quietly implies operator
  fault where none exists.
