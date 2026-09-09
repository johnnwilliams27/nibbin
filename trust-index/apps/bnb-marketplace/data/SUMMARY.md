# BSC agent dataset — build summary

Generated: `2026-09-09T09:56:02.435Z`  
Source: 8004scan public API (`https://api.8004scan.io`), chain_id 56 (BSC).  
Output: `data/agents.json` — **10041 agents**, conforming to `DATA-CONTRACT.md`.

## Provenance

- **10041 of 10041 agent records are built from real fetched API responses.** Every field traces to a file under `data/raw/` (`data/raw/candidates.json` for list fields, `data/raw/detail/<chain>_<token>.json` for detail fields).
- `data/raw/detail/` holds **8590** fetched detail responses.
- Current detail gaps in this snapshot: **1451** rows recorded as rate-limited and **0** rows with unknown detail status. These are measurement gaps, not evidence that an agent declares no endpoint. The fetch log contains **1483** historical failure records; some may have been resolved by later successful fetches. Current counts come from `detail_status`, not membership in that log.
- `assessment` is populated for **7937 of 10041** agents, from the endpoint sweep recorded in `data/probes/endpoint-probes.json`. No assessment value was synthesised: every field traces to a stored probe transcript.
- It is `null` for the other 2104 agents. The recorded reasons must not be conflated: **239** were read and declare no endpoint (there is nothing to probe — this is a fact about them); **414** declare an endpoint that this sweep had not reached when it ran; and **1451** we never read at all, because the detail fetch was rate-limited. Only the first group is evidence. The other two are our gaps, and rerunning closes them — `fetch_details.py` for the third, the probe sweep for the second.
- `is_reference_agent` is `false` for all 10041 agents.

> **Disclosure.** An earlier draft of `data/agents.json` in this working directory contained hand-written placeholder agents (fabricated names, owner addresses, endpoints and a populated `assessment`). It was quarantined and discarded, and the dataset was rebuilt end-to-end from the fetched responses in `data/raw/`. None of that content survives in this dataset. We record our own errors rather than hiding them.

## Candidate selection

Priority order, deduped by `agent_id`:

| stream | query | API total | taken |
|---|---|---|---|
| MCP | `/agents?chain_id=56&has_mcp=true` | 5574 | 5574 |
| feedback | `/agents?chain_id=56&min_feedbacks=1` | 509 | 509 |
| endpoint-verified | `/agents?chain_id=56&is_endpoint_verified=true` | 6 | 6 |
| A2A (capped) | `/agents?chain_id=56&has_a2a=true` | 28461 | 3000 |

Plus whole-population keyword searches, because the four hackathon categories are sparse and a genuine rebalancing agent need not declare MCP or A2A (so it would be invisible to the streams above):

```
GET /api/v1/agents?chain_id=56&limit=100&offset=N&search=<term>
  terms: rebalance, rebalancing, portfolio rebalancing, grid trading,
         grid bot, trading grid, yield, yield farming, yield optimizer,
         apy, health factor, liquidation, collateral ratio
```

Detail (this is the only view carrying the callable endpoint, tags and OASF skills):

```
GET /api/v1/agents/56/{token_id}
```

All requests send a `User-Agent` header — the API returns **403** without one.

## Categories

| category | agents | high >=0.7 | medium 0.5-0.7 | low <0.5 | none |
|---|---|---|---|---|---|
| rebalancing | 41 | 10 | 23 | 8 | 0 |
| grid_trading | 14 | 8 | 3 | 3 | 0 |
| yield | 95 | 54 | 32 | 9 | 0 |
| health_factor | 24 | 9 | 11 | 4 | 0 |
| other | 2449 | 0 | 0 | 0 | 2449 |

**The four hackathon categories total 174 agents out of 10041 (1.7%).** This is a real finding, not a shortfall: BSC's agent population is dominated by news/analysis agents, not DeFi execution agents.

### Independence: an agent count is not a builder count

Minted collections put many on-chain identities behind one operator, so a raw count overstates how many distinct things exist. Distinct owners and endpoints behind each category:

| category | agents | distinct owners | distinct endpoints |
|---|---|---|---|
| rebalancing | 41 | 37 | 11 |
| grid_trading | 14 | 11 | 4 |
| yield | 95 | 64 | 24 |
| health_factor | 24 | 20 | 9 |

The largest single owner accounts for **71** of the 174 categorised agents (`0x97e8f3b4bffc1982b2791b21609c3b2542c5eb50`). The clearest example in the dataset is the 105-agent `BORT` collection: one owner, three distinct endpoints. Read the category counts as agents, not as teams.

### How a category is assigned

Deterministic keyword matching over real text only: name, description, tags, categories, OASF skills and domains, MCP tool names, A2A skill names, and declared skills/capabilities from on-chain metadata. `category_evidence` quotes the actual matched term and the field it came from, so any call can be audited.

Four deliberate anti-inflation rules, each one added because it caught a real false positive in this data:

1. **A category needs a specific term.** Ambiguous tokens (`balance`, `grid`, `yield`, `collateral`) never assign a category on their own; they are recorded as near-misses on an `other` agent. Matching the bare word `balance` would have produced hundreds of false rebalancing agents.
2. **Generic on-topic words need nearby corroboration.** Bare `rebalanc*` only counts with a portfolio/finance context word within 80 characters. Field-level checks are too coarse — this rule correctly rejects a Chinese-metaphysics agent whose description reads "Yin Yang polarity diagnosis and rebalancing" and separately mentions a token on BNB Chain.
3. **Execution signal must be independent of the matched term.** Otherwise the word `rebalance` assigns the category and is then re-counted as proof the agent executes — a circular boost that had inflated 73 of 97 rebalancing agents to high confidence in an earlier pass. Read-only news/analysis agents that merely discuss a topic are confidence-penalised.
4. **A registry tag cannot establish a category on its own.** 159 agents carry the `Yield Optimizer` tag while only **4** mention yield anywhere in their name or description — the rest are smart-contract audit, infra and platform agents. Tags are cheap self-declared metadata, so a tag-only match is recorded as a near-miss on an `other` agent. This one rule removed 157 false yield agents (271 -> 114).

## Endpoints and usage signal

- **8351 agents (83.2%) declare a callable endpoint** (MCP > A2A > web, as declared). These are the probe set.
- 509 agents have >=1 feedback on 8004scan.
- 6 agents are endpoint-verified by 8004scan.
- 519 agents declare x402 support.

A declared endpoint is *declared*, not *reachable*: some point at placeholder hosts. Reachability is the probe run's job — see the next section, which measured it.

## What the probe sweep measured

Run against every distinct endpoint in the dataset. **7937 agents declare 56 distinct endpoints** — one factory mints many on-chain identities behind a single server — so each endpoint was probed once and the result fanned out to every agent declaring it. That is faster and it is the polite thing to do to somebody else's host.

- **56 distinct endpoints probed.** 156 got an MCP handshake attempt; 80 got an Agent Card fetch (A2A was tried where the agent declares it and MCP did not establish, and on endpoints declaring neither, where a static card GET is the cheapest honest way to learn whether anything answers).
- Handshake and enumeration only: `initialize` + `tools/list`, or a card GET plus one benign `tasks/get` for a task id that cannot exist. **No tool and no skill was ever invoked**, so nothing was spent and nothing was mutated.
- Two concurrent requests per host, twenty across the run. Two hosts hold half the population between them and were not burst.
- Every request went through the collector's SSRF guard (`packages/collectors/src/net.ts`): blocked-host list, DNS re-vetting on every redirect, and a socket pinned to the vetted address.

### Outcomes

| outcome | endpoints | agents | what it means |
|---|---|---|---|
| Spoke MCP or A2A to us | 32 | 357 | handshake completed, or an Agent Card was served and parsed |
| Auth wall (401/403) | 1 | 1 | the server answered and declined an anonymous client — up, working, unassessable by us |
| Answered, but not as an agent | 19 | 7562 | HTTP 404/400/405, or an HTML page — the host is up and serves something else |
| Not dialable at all | 1 | 14 | a non-HTTP scheme or a private/loopback host; there is nothing anyone could call |
| No reading obtained | 3 | 3 | timeout, 5xx or a hostname that does not resolve — OUR gap, recorded as unknown, never as downtime |

**52 of 56 endpoints answered us.** 3 produced no reading at all and are recorded as `reachable: null` with a reason — those are our gaps, and writing them down as "down" would be publishing our blind spot as somebody's downtime. Each was retried at a 30-second timeout before being written off as unmeasured.

### Capability enumerated

- **30 endpoints (354 agents) enumerated at least one tool or skill.** Those names are in `assessment.tools_or_skills` exactly as the server reported them.
- 6 agents fired a declaration-level safety gate (`assessment.gates_fired`). These are read off the enumerated tool schemas — a mutating tool with no description, or a tool asking the caller to hand over a credential — using the same helpers as the MCP rubric. Nothing was called to establish them.

### Scores

**239 of 7937 agents carry a non-null `composite`.** That is not a gap in the run; it is the run's finding. Completing a handshake and reading a tool list establishes that an agent EXISTS and what it CLAIMS. Neither is behavioural evidence, and a composite derived from a tool list would be a guess wearing a decimal point. So every row reads `composite: null`, `coverage: "thin"`, and a `withheld_reason` naming exactly what we did and did not do. Publishing a number here is the one thing this project exists not to do.

All 6913 agents in the four hackathon categories that declare an endpoint were probed first, ahead of the rest of the population.

## Noise / signal

- BSC reports ~5574 MCP agents out of **310,418 total** on chain 56; only **6** are endpoint-verified and only **509** carry any feedback at all.
- **7548 of 10041 agents in this candidate set share a description with at least one other agent** — the clearest bulk-mint signal.
  Most reused descriptions:
  - 5170x `gasless stablecoin payment agent on bnb chain....`
  - 309x `autonomous automation & ops agent registered through termix....`
  - 300x `autonomous security & verification agent registered through termix....`
  - 299x `autonomous market & protocol research agent registered through termix....`
  - 281x `autonomous writing & content agent registered through termix....`
- 218 agents match observed bulk-mint name patterns (e.g. `babycaisubagent66_quickassistant6584`, `OmegaCore_FDBCD5`).
- 2788 agents have a null or zero 8004scan score.

Bulk-minted agents are **not** excluded: some carry genuinely on-topic descriptions, and silently dropping them would be an unrecorded editorial judgement. They are visible through `scan_feedbacks`, `scan_total_score` and `category_confidence` instead.

## Reproducing

```bash
python3 scripts/fetch_candidates.py   # -> data/raw/list/, candidates.json
python3 scripts/fetch_details.py 5    # -> data/raw/detail/ (1000 req/hr cap)
python3 scripts/build_dataset.py      # -> data/agents.json
python3 scripts/generate_summary.py   # -> data/SUMMARY.md
```

Both fetch steps are idempotent: cached responses under `data/raw/` are never re-fetched, so a rerun resumes rather than restarts.
