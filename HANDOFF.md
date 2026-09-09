# Nibbin Trust Index — engineering handoff

You are taking over a live product. Read this in full before touching anything.

---

## 0. What this is, and the one property that makes it worth building

Nibbin is an **independent assessor of AI agents and the interfaces they expose**. We probe a
subject's declared interface, measure how it actually behaves when called, and publish a rating —
or decline to, and say why. Subjects are ERC-8004 on-chain agents and the MCP/A2A endpoints they
declare.

The distinguishing property, and the entire reason anyone should trust the output:

> **We refuse to publish when the evidence is thin, and we record the reason.
> Our inability to measure never becomes a fact about the subject.**

Everything below is downstream of that sentence. A change that makes a number look better by
blurring it is a regression, even if it ships.

### The seven rules (non-negotiable, from `CLAUDE.md`)

1. **A gap is never evidence.** "We could not obtain the data" is recorded as *our* failure, never
   as a fact about the subject. Only `harness_capability_missing` / `harness_capability_unhealthy`
   leave the completeness denominator.
2. **Never fabricate.** No invented agent, score, endpoint, or category — not even as a
   placeholder. A missing value is `null` plus a reason.
3. **401/403 is an auth wall** — a known and rateable state, not a dead endpoint. 429 means alive
   and rate-limiting us. Judge by the body, never the status alone.
4. **Coverage is orthogonal to score.** Coverage is how much we looked; score is how good it is.
   Never merge them.
5. **Withholding is the product.** Do not soften it to make a number look better.
6. **Third-party data stays labelled** as third-party. Never present someone else's score as our
   measurement.
7. **Participation and payment never influence a score**, in any direction. We do not rank agents
   we deployed ourselves.

**Rule 1 has a corollary that was learned the hard way and is now rule 4 of `DATA-CONTRACT.md`:**
recording a gap faithfully in one file and then counting it as a fact in another is still a
violation. Every *consumer* of a null has to carry the gap, not just the producer. See §4.1.

---

## 1. Repository and deployment

| | |
|---|---|
| Repo | `johnnwilliams27/nibbin`, default branch `main` |
| v1 product | archived to `johnnwilliams27/old-nibbin` (391 commits). Nothing deleted. See `ARCHIVE.md` |
| Live site | `nibbin.com` → 308 → `www.nibbin.com` |
| Vercel project | `nibbin-bnb-marketplace`, Root Directory `trust-index/apps/bnb-marketplace` |
| Build | Next.js **static export** (`output: 'export'`). No server, no API routes at runtime |
| Branch protection | `main` is protected. Required checks: `typecheck`, `lint`, `test`, `build` |

**Do not add a root `vercel.json`.** Root Directory is already configured, so the build runs
*inside* that folder; a root `vercel.json` that `cd`s into the same relative path fails with
"No such file or directory". This already broke production once.

### Workspace layout

```
trust-index/
  packages/
    scoring/      pure engine, NO I/O (eslint enforces this), deterministic, golden fixtures
    collectors/   the GOOD prober — TS, SSRF-guarded, SSE-aware, A2A-aware
      src/net.ts    READ THIS BEFORE ANY OUTBOUND CODE (SSRF, DNS pinning, redirect re-vetting)
      src/mcp/      streamable-http + sse transports
      src/a2a/      agent-card discovery, 3 tiers
      src/judge/    LLM judge panel
    indexer/      on-chain enumeration, registries, chains
    db/           persistence, snapshots, encrypted credentials
  apps/
    bnb-marketplace/   the public site + its OWN separate python data pipeline
```

**Critical structural fact:** `apps/bnb-marketplace` is **excluded from the pnpm workspace**
(`pnpm-workspace.yaml` has `"!apps/bnb-marketplace"`). It has its own `package-lock.json` and
builds with **npm**, not pnpm. It does not use `workspace:*` deps.

**There are two different probers and they do not share code:**

- `packages/collectors` — the good one. SSE + streamable-http, follows redirects with per-hop
  SSRF vetting, strips origin-bound headers cross-origin, surfaces 401/403 as auth walls.
- The marketplace's own probe, which produced `apps/bnb-marketplace/data/probes/endpoint-probes.json`.
  **111 rows, all A2A, zero MCP probes.** It is much weaker. Most of §3's bugs come from this.

Unifying these — having the marketplace consume `packages/collectors` — is probably the single
highest-leverage refactor available. See §3.

---

## 2. Current state

### Live right now
- `www.nibbin.com` serving, snapshot `2026-09-09 04:19 UTC`
- 10,041 agents indexed, **230 listed** across 4 categories (rebalancing 78, yield 114,
  grid_trading 14, health_factor 24). The other 9,811 are category `other` — indexed and counted,
  not listed
- 3,204 assessments, **0 published scores**, all withheld. This is deliberate and correct, but see §5

### Unmerged work you must decide on first
Branch `fix/detail-fetch-retry-cap` — 3 commits ahead of `main`, **not deployed**:
- `ced6fee` docs: the required-check-behind-a-path-filter deadlock (also on `docs/ci-path-filter-gotcha`)
- `933bb5d` cap `Retry-After` in `fetch_details.py`
- `e99dce3` **the `detail_status` fix** — stops publishing a rate-limit gap as "declares no endpoint"

Until `e99dce3` merges, **nibbin.com still says "the rest cannot be hired at all"** about 11 agents
we never actually read. Merging it is the first thing to do.

Local `main` is 1 commit ahead of `origin/main` (the GOTCHAS commit, rejected by branch protection
and since moved onto a branch). Reset it: `git checkout main && git reset --hard origin/main`.

### Background job
A detached `refetch2.sh` is closing the 8004scan detail gap (~8,590/10,041 at handoff, was 8,565).
It waits for the hourly quota and re-runs; the fetch is idempotent, cached files are never
re-fetched. Check `ls data/raw/detail | wc -l`. If it has died, just re-run
`python3 scripts/fetch_details.py 8` on a fresh quota window.

---

## 3. Known bugs and open findings — start here

These are measured, not speculative. Each has been verified against live endpoints.

### 3.1 4,883 agents are misattributed as failing our handshake — THE BIG ONE

`data/agents.json` records 2,716 agents with:

> `"the endpoint answered HTTP 405 but did not complete an MCP handshake"`

Those sit behind **6 endpoints**, and 2,711 behind exactly one. Dial it yourself:

```
GET https://q402.quackai.ai/api/mcp/info   →  200 application/json
{"type":"https://eips.ethereum.org/EIPS/eip-8004#service.mcp",
 "name":"@quackai/q402-mcp", "version":"0.11.15",
 "transport":"stdio",
 "install":{"npx":"npx -y @quackai/q402-mcp@latest"},
 "tools":[{"name":"q402_pay",...},{"name":"q402_balance",...}, ...8+ tools with descriptions]}
```

This is a **valid ERC-8004 service descriptor**. `transport: stdio` — the MCP server runs locally
via npx, not over HTTP. It enumerates its tools right there in the document.

Our prober is HTTP-only. It **structurally cannot dial stdio**. It POSTed a JSON-RPC `initialize`
at a discovery *document* and recorded the resulting 405 as though it were the agent's answer.

Under rule 1 this is `harness_capability_missing` — the one category that *leaves* the completeness
denominator — currently written as a subject failure across **4,883 agents (27% of the index)**.
Not currently rendered on the site (all are category `other`), but it ships in `agents.json`.

**Two fixes, do both:**
1. Reword the verdict to name our limitation, not theirs. Small, honest, immediate.
2. **Read the descriptor instead of POSTing at it.** A `service.mcp` document enumerates tools
   directly — that turns 4,883 agents from a blind spot into measurable *declarations*
   (provenance `self_reported`, weight 0.15 — declaration, not behaviour, and must be labelled as
   such). This is the largest single coverage win available.

### 3.2 Redirects not followed by the marketplace probe

`https://mcp.composio.dev/mcp` returns **301 → `https://composio.dev/toolkits/mcp`**, recorded as a
failure. `packages/collectors/src/mcp/sse.ts` already has a correct redirect-following `dial()`
with per-hop SSRF vetting and origin-bound header stripping. The marketplace probe doesn't use it.
This is the same trap already documented in `docs/GOTCHAS.md`.

### 3.3 SSE vs streamable-http

An MCP server speaking SSE answers a POST with 404/405/400. Probing POST-only misfiles live servers
as dead. `collectors` handles this (GET opens the stream, `event: endpoint` names the POST URL).
The marketplace probe does not. **Any 404/405 verdict in `agents.json` is suspect until re-probed
with the SSE-aware client.**

### 3.4 Only 111 endpoints were ever probed

8,339 agents declare an endpoint. The probe file has **111 distinct endpoints**. The 3,204
"assessments" are those 111 results **fanned out across agents that share a host**. Any per-agent
claim derived from a shared-host probe needs care — one endpoint's behaviour is not 2,711 agents'
behaviour, and presenting it as such is close to a rule-1 problem of its own. Decide explicitly how
shared endpoints should be represented.

### 3.5 Judge rubric self-contradiction
`packages/collectors/src/judge/index.ts` — lines ~286 and ~291 contradict each other on the rubric.
Unresolved. 17 judge label misses also flagged for human review.

### 3.6 Sybil / duplicate signal is measured but not surfaced
- 7,548 of 10,041 agents share a description with at least one other; 5,170 share one
- "BORT" = 105 identities behind 1 owner and 3 endpoints
- 2,711 identities behind 1 endpoint (§3.1)

This is arguably the most *interesting* finding in the dataset and it is nowhere in the UI. For a
"can I trust this agent" product, "this is one of 105 identical registrations by one owner" is more
decision-relevant than any composite score. Consider surfacing it as a first-class signal.

---

## 4. The assessment approach — review and improve

### 4.1 The failure mode to internalise

The project's signature error, committed repeatedly, is **letting a measurement gap harden into a
claim**. Concrete instances, all real:

| what was published | what was true |
|---|---|
| "~23 agents assessable" | 5,568 MCP + 28,459 A2A declared |
| "1,708 declare no endpoint" | 228 do. 1,474 we never fetched |
| "the rest cannot be hired at all" | 70 measured, 11 never read |
| "405, did not complete MCP handshake" (§3.1) | they declared stdio; we only speak HTTP |
| MCP servers recorded "HTTP 404" | they were SSE, or 401 auth walls, or 307 redirects |

The pattern is identical every time: a limitation of the harness gets written in the grammar of a
finding about the subject. **When you write any string a reader will see, ask: is this a fact about
them, or a fact about us?**

`DATA-CONTRACT.md` rule 4 and the `detail_status` field exist because of this. Follow that pattern
for every new gap you introduce: name the gap in the data, default to *unknown* rather than to a
claim, and make the UI able to say "we don't know."

### 4.2 Coverage expansion, in rough order of value

1. **stdio descriptors** (§3.1) — 4,883 agents, largest single win
2. **Point the marketplace at `packages/collectors`** — inherits SSE, redirects, auth-wall
   handling, SSRF guards in one move. Kills §3.2, §3.3 together
3. **Probe the 5,135 agents that declare an endpoint we never dialled** — pure coverage, no new
   capability needed
4. **A2A breadth** — `collectors/src/a2a` exists and works; 28,459 BSC agents declare A2A
5. **Auth walls** — 3,774 total, **230 fully self-servable** (`client_credentials` + DCR) across
   189 domains. Those 230 are obtainable without a human. 3,544 need human login — those are a
   *known rateable state* (rule 3), not failures
6. **Behavioural battery** — currently 0 agents have one, which is why 0 scores are published.
   3,171 endpoints *answered*; almost none produced enough evidence to rate. Closing this is what
   turns the site from a census into a rating

### 4.3 Population framing — get this right, it has been wrong before

Measured, independently verified:
- **ERC-8004: 496,976 agents across 12 chains** (within ~1.5% of 8004scan's published 504,235+,
  derived without their API). BSC 341,769 (69%, almost zero feedback); Base 85,662 (most feedback)
- BSC: 310,403 registered, 5,568 `has_mcp`, 28,459 `has_a2a`, ~5 endpoint-verified, 509 with any
  feedback
- Growth ~2,448/day, mostly bulk registrations

Never conflate these populations. Three different numbers (161 / 259 / 637) were previously merged
into one claim and it was wrong. State which population every number describes.

---

## 5. Withholding — the honest tension

The site currently publishes **0 scores and withholds all 75 assessed** listed agents. That is
correct under rule 5 and it is the product's whole thesis.

It is also, for a hackathon judge, a site that rates nothing.

**Do not resolve this by lowering the bar.** Resolve it by *earning* scores: run the behavioural
battery (§4.2.6) on the agents that answered, so the withholding becomes selective rather than
total. A site that rates 40 agents and withholds 190 with stated reasons is dramatically stronger
than one that withholds everything — and infinitely stronger than one that lowered a threshold.

The earlier withholding-rate analysis: 98.9% withheld, of which only ~17% is genuinely thin
subjects and **~83% is our own harness gaps**. Closing §4.2 moves that ratio honestly.

---

## 6. 8004scan references — read this before ripping them out

The ask is to clean up public references to 8004scan. Current footprint:

- **12 files under `src/`** (user-visible): `app/page.tsx` (4), `app/agent/[chain]/[tokenId]/page.tsx` (3),
  `lib/sorting.ts` (3), `app/methodology/page.tsx` (2), `app/compare/page.tsx` (2),
  `components/AgentExplorer.tsx` (2), `lib/types.ts` (2), plus `components/Provenance.tsx`,
  `components/SiteFooter.tsx`, `app/category/[slug]/page.tsx`, `lib/census.ts`, `app/globals.css`
- Contract fields: `scan_total_score`, `scan_feedbacks`, `scan_endpoint_verified`
- Pipeline: `fetch_candidates.py`, `fetch_details.py` fetch from `api.8004scan.io`
- Docs: `DATA-CONTRACT.md`, `README.md`, `generate_summary.py`

**The tension, stated plainly:** rule 6 says third-party data stays labelled as third-party, and
never gets presented as our measurement. Right now the entire candidate list, every feedback count,
every `total_score` and every endpoint-verification comes from 8004scan's API. **Removing the
attribution while keeping the data would convert a labelled third-party dataset into an implied
first-party one — a direct rule 6 violation, and the most damaging kind, because it is the exact
thing we criticise others for.**

So the clean-up has to mean one of:

- **(a) Reduce dependence, then reduce attribution.** Enumerate agents from chain directly via
  `packages/indexer` (this already works — 496,976 agents derived without their API). Once the
  population frame is ours, 8004scan's role shrinks to the `scan_*` columns only, and the prominence
  drops honestly.
- **(b) Keep the data, keep the label, reduce the *visual* prominence** — fewer repetitions, one
  clear provenance statement rather than nine scattered mentions, footer attribution instead of
  inline. Legitimate, and much faster.

**(a) is the right answer and (b) is the acceptable interim.** What is not acceptable is deleting
the word while keeping the rows. Confirm the intent with the owner before doing either.

---

## 7. UX, visual design and prose

The site is content-heavy and its credibility comes from tone. Improve it, but the constraint is
that **the honesty is the brand** — do not smooth away the hedges, the "we do not know", the `n/a`s
or the withheld reasons. They are the product. Make them *well-designed*, not quieter.

Areas:
- **Visual design** — typography scale, spacing rhythm, colour system, dark/light parity, the
  stat-tile and bar-chart treatments. The census bars are deliberately drawn to true proportion
  (the small ones are hairlines) with a note saying so — keep that, it is a point of integrity
- **Prose** — tighten. Remove AI tells: em-dash overuse, "it's worth noting", "delve", triads of
  adjectives, hedge-stacking, section-closing summaries that restate the section. Read it aloud
- **Navigation and IA** — 4 categories + compare + methodology today. 9,811 unlisted agents are
  currently unreachable in the UI; decide whether they should be browsable
- **Search** — there is effectively none. With 10,041 rows this is the biggest functional UX gap
- **Layout and smoothness** — transitions, loading/empty states, responsive behaviour, table
  ergonomics on mobile
- **Accessibility** — contrast, focus states, keyboard nav, semantic markup

Note the constraint: **static export**. No server-side search, no API routes. Search must be
client-side (prebuilt index) or a third-party service.

---

## 8. Wallet connection and the hire flow

Current state: `HirePanel.tsx` produces a copyable config (an MCP `mcpServers` JSON block, or an A2A
agent-card reference). There is no wallet connection.

Requirements:
- Connect-wallet flow that is genuinely pleasant, BNB Chain (chain 56) and testnet 97
- Hire/activate path from an agent page
- x402 payment support where declared (`x402_supported` is already in the contract)
- ERC-8183 (Agentic Commerce Protocol) job flow: post job → escrow → deliver → settle.
  **This already works** — job 1163 completed autonomously on BSC testnet at $0.00, verified on-chain
  (`effectiveGasPrice: 0` via MegaFuel gas sponsorship). Use that as the reference implementation
- Safety gates must remain loud. `gates_fired` non-empty blocks the flow behind an acknowledgement,
  and that is deliberate — an agent that failed a safety gate accepting x402 payments can cost the
  user funds directly

Static export means wallet interaction is entirely client-side. That is fine — but any "hire"
that implies a server-side action needs to be honest about what actually happens.

---

## 9. BNB Chain hackathon tracks

Fetch the current track criteria yourself — do not trust a summary:
https://www.bnbchain.org/en/hackathons/smart-money-era?tab=tracks

Then do a literal, honest gap analysis: for each track, what the criteria ask for, what exists
today, what is missing. Write it down before building. Do not claim a criterion is met because
something adjacent exists.

---

## 10. Security and operational constraints — hard limits

- **Secrets live only at** `/tmp/claude-0/-home-user-nibbin/<session>/scratchpad/keys.env`
  (chmod 600, outside the repo). `TRUST_INDEX_PROBE_SEED`, `TRUST_INDEX_CREDENTIAL_KEY`,
  `X402_WALLET_PRIVATE_KEY`, `X402_WALLET_ADDRESS`, `MARKETINTELL_API_KEY`. **Never commit them.**
  CI runs gitleaks over the whole repo
- **API key rotation is out of scope. Do not raise it.**
- **Never attempt CAPTCHAs**, Turnstile, hCaptcha, or honeypots
- **Truthful identity only** in every outbound request: "Nibbin Trust Index" / nibbin.com. Never
  impersonate a browser or another client
- **No card payments.** Crypto only, under caps: $100/sweep, $20/endpoint
- **Probes are read-only by default.** Handshake and enumerate. Never call a tool that mutates
  state on someone else's server
- **`packages/collectors/src/net.ts` before any outbound code.** SSRF, DNS rebinding, socket
  pinning, per-redirect re-vetting. Origin-bound headers (`authorization`, `cookie`,
  `mcp-session-id`, `x-api-key`) must not survive a cross-origin redirect
- **`packages/scoring` performs no I/O and reads no wall clock.** eslint enforces both. Use
  `as_of_ts` from the snapshot, never `Date.now()`
- A **Drillr RLS finding** exists in `subject_credentials.notes`. Do not notify, do not publish
- **Probe constants are derived per subject from a held seed** so subjects cannot pre-compute them.
  Do not weaken this

---

## 11. Working practice

- **`--frozen-lockfile` from a clean `node_modules` is the only meaningful check.** "Lint is clean"
  off a warm install has been wrong twice. Run typecheck, lint AND build together — fixing one has
  broken another
- The marketplace builds with **npm** (`npm run build`), the rest with **pnpm**
- CI: `.github/workflows/trust-index.yml`. Runs on every PR (the `paths:` filter was removed — a
  required check behind a path filter is an unresolvable deadlock; see `docs/GOTCHAS.md`)
- **Read `docs/GOTCHAS.md` before debugging anything.** It is a list of traps already paid for
- Update protocol: at every milestone gate update `docs/STATE.md`, append `LEARNINGS.md`, add new
  traps to `docs/GOTCHAS.md`. Keep `CLAUDE.md` under 50 lines — it is a router
- `docs/STATE.md` has current state and open P0/P1

---

## 12. Suggested order

1. Merge `fix/detail-fetch-retry-cap` — the live site is currently making 11 false claims
2. Confirm the refetch closed the detail gap; rebuild the dataset
3. Fix §3.1 wording immediately (one-line honesty fix), then build the stdio descriptor reader
4. Point the marketplace at `packages/collectors`; re-probe. This invalidates and improves a large
   fraction of existing verdicts — expect the numbers to move, and expect them to move *toward*
   more agents being measurable
5. Run the behavioural battery so the site can publish real scores (§5)
6. BNB track gap analysis (§9) — before more building, so the work is aimed
7. UX and prose pass (§7), wallet flow (§8)
8. 8004scan reduction (§6) — confirm intent first

Throughout: when you are about to write a number or a sentence about an agent, check whether you
measured it or inferred it. That check is the product.
