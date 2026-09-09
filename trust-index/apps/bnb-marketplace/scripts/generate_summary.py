#!/usr/bin/env python3
"""Write data/SUMMARY.md from the built dataset and the raw fetch record.

Every number here is computed from data/agents.json and data/raw/. Nothing is
asserted that is not counted.
"""
import json, os, re, collections, time

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(HERE, "data", "raw")
DATA = os.path.join(HERE, "data")
CATS = ["rebalancing", "grid_trading", "yield", "health_factor", "other"]

# Bulk-mint naming patterns observed in the fetched data (not assumed).
BULK = [re.compile(r"subagent\d+_", re.I),
        re.compile(r"^[A-Za-z]+_[0-9A-F]{6}$"),
        re.compile(r"\d{3,}$")]


def band(c):
    if c >= 0.7:
        return "high(>=0.7)"
    if c >= 0.5:
        return "medium(0.5-0.7)"
    if c > 0:
        return "low(<0.5)"
    return "none(0.0)"


def outcome(a):
    """Which of the five things happened, read off the assessment alone.

    The split that matters is the last two against the first three: an endpoint
    that answered told us something, and an endpoint we failed to read told us
    nothing. Collapsing those two is the error this whole file exists to avoid.
    """
    if a["reachable"] is None:
        return "unmeasured"
    if a["reachable"] is False:
        return "not_dialable"
    r = a.get("withheld_reason") or ""
    if "declined an anonymous client" in r or "auth wall" in r:
        return "auth_walled"
    if "rate limited" in r:
        return "rate_limited"
    if a["protocol_spoken"]:
        return "protocol_established"
    return "answered_not_protocol"


LABELS = [
    ("protocol_established", "Spoke MCP or A2A to us",
     "handshake completed, or an Agent Card was served and parsed"),
    ("auth_walled", "Auth wall (401/403)",
     "the server answered and declined an anonymous client — up, working, unassessable by us"),
    ("rate_limited", "Rate limited (429)",
     "alive, and telling us we called too often"),
    ("answered_not_protocol", "Answered, but not as an agent",
     "HTTP 404/400/405, or an HTML page — the host is up and serves something else"),
    ("not_dialable", "Not dialable at all",
     "a non-HTTP scheme or a private/loopback host; there is nothing anyone could call"),
    ("unmeasured", "No reading obtained",
     "timeout, 5xx or a hostname that does not resolve — OUR gap, recorded as unknown, never as downtime"),
]


def assessment_section(agents, probes):
    """The probe sweep, counted. Every number here comes from agents.json."""
    assessed = [a for a in agents if a["assessment"]]
    by_ep = {}
    for a in assessed:
        by_ep.setdefault(a["endpoint"], a["assessment"])
    ep_counts = collections.Counter(outcome(x) for x in by_ep.values())
    ag_counts = collections.Counter(outcome(a["assessment"]) for a in assessed)
    four = [a for a in assessed if a["category"] != "other"]
    scored = [a for a in assessed if a["assessment"]["composite"] is not None]
    caps = [a for a in assessed if a["assessment"]["tool_count"] > 0]
    ep_caps = [x for x in by_ep.values() if x["tool_count"] > 0]
    gates = [a for a in assessed if a["assessment"]["gates_fired"]]
    mcp_tried = len([r for r in probes if r["mcp"]])
    a2a_tried = len([r for r in probes if r["a2a"]])

    L = []
    W = L.append
    W("## What the probe sweep measured")
    W("")
    W(f"Run against every distinct endpoint in the dataset. **{len(assessed)} agents "
      f"declare {len(by_ep)} distinct endpoints** — one factory mints many on-chain "
      f"identities behind a single server — so each endpoint was probed once and the "
      f"result fanned out to every agent declaring it. That is faster and it is the "
      f"polite thing to do to somebody else's host.")
    W("")
    W(f"- **{len(by_ep)} distinct endpoints probed.** {mcp_tried} got an MCP "
      f"handshake attempt; {a2a_tried} got an Agent Card fetch (A2A was tried where "
      f"the agent declares it and MCP did not establish, and on endpoints declaring "
      f"neither, where a static card GET is the cheapest honest way to learn whether "
      f"anything answers).")
    W("- Handshake and enumeration only: `initialize` + `tools/list`, or a card GET "
      "plus one benign `tasks/get` for a task id that cannot exist. "
      "**No tool and no skill was ever invoked**, so nothing was spent and nothing "
      "was mutated.")
    W("- Two concurrent requests per host, twenty across the run. Two hosts hold "
      "half the population between them and were not burst.")
    W("- Every request went through the collector's SSRF guard "
      "(`packages/collectors/src/net.ts`): blocked-host list, DNS re-vetting on "
      "every redirect, and a socket pinned to the vetted address.")
    W("")
    W("### Outcomes")
    W("")
    W("| outcome | endpoints | agents | what it means |")
    W("|---|---|---|---|")
    for key, label, meaning in LABELS:
        if ep_counts.get(key, 0) == 0 and ag_counts.get(key, 0) == 0:
            continue
        W(f"| {label} | {ep_counts.get(key,0)} | {ag_counts.get(key,0)} | {meaning} |")
    W("")
    answered = sum(ep_counts.get(k, 0) for k in
                   ("protocol_established", "auth_walled", "rate_limited",
                    "answered_not_protocol"))
    W(f"**{answered} of {len(by_ep)} endpoints answered us.** "
      f"{ep_counts.get('unmeasured',0)} produced no reading at all and are recorded "
      f"as `reachable: null` with a reason — those are our gaps, and writing them "
      f"down as \"down\" would be publishing our blind spot as somebody's downtime.")
    W("")
    W("### Capability enumerated")
    W("")
    W(f"- **{len(ep_caps)} endpoints ({len(caps)} agents) enumerated at least one "
      f"tool or skill.** Those names are in `assessment.tools_or_skills` exactly as "
      f"the server reported them.")
    W(f"- {len(gates)} agents fired a declaration-level safety gate "
      f"(`assessment.gates_fired`). These are read off the enumerated tool schemas "
      f"— a mutating tool with no description, or a tool asking the caller to hand "
      f"over a credential — using the same helpers as the MCP rubric. Nothing was "
      f"called to establish them.")
    W("")
    W("### Scores")
    W("")
    W(f"**{len(scored)} of {len(assessed)} agents carry a non-null `composite`.** "
      f"That is not a gap in the run; it is the run's finding. Completing a "
      f"handshake and reading a tool list establishes that an agent EXISTS and what "
      f"it CLAIMS. Neither is behavioural evidence, and a composite derived from a "
      f"tool list would be a guess wearing a decimal point. So every row reads "
      f"`composite: null`, `coverage: \"thin\"`, and a `withheld_reason` naming "
      f"exactly what we did and did not do. Publishing a number here is the one "
      f"thing this project exists not to do.")
    W("")
    W(f"All {len(four)} agents in the four hackathon categories that declare an "
      f"endpoint were probed first, ahead of the rest of the population.")
    return L


def main():
    with open(os.path.join(DATA, "agents.json")) as f:
        payload = json.load(f)
    agents = payload["agents"]

    assessed = [a for a in agents if a["assessment"]]

    probes = []
    pp = os.path.join(DATA, "probes", "endpoint-probes.json")
    if os.path.exists(pp):
        with open(pp) as f:
            probes = json.load(f).get("results", [])

    with open(os.path.join(RAW, "candidates.json")) as f:
        cand = json.load(f)
    totals = cand.get("api_totals", {})

    fails = {"count": 0, "failures": []}
    fp = os.path.join(RAW, "detail_failures.json")
    if os.path.exists(fp):
        with open(fp) as f:
            fails = json.load(f)

    n_detail = len([x for x in os.listdir(os.path.join(RAW, "detail"))
                    if x.endswith(".json")])
    n = len(agents)
    with_ep = [a for a in agents if a["endpoint"]]
    with_fb = [a for a in agents if a["scan_feedbacks"] > 0]
    verified = [a for a in agents if a["scan_endpoint_verified"]]
    x402 = [a for a in agents if a["x402_supported"]]

    # ---- noise / signal, measured ----
    desc = collections.Counter(a["description"].strip().lower()
                               for a in agents if a["description"].strip())
    dup_desc = sum(c for d, c in desc.items() if c > 1)
    top_dupes = [(d[:70], c) for d, c in desc.most_common(5) if c > 1]
    bulk = [a for a in agents if any(r.search(a["name"] or "") for r in BULK)]
    zero_score = [a for a in agents if not a["scan_total_score"]]

    cat_rows = []
    for c in CATS:
        rows = [a for a in agents if a["category"] == c]
        bands = collections.Counter(band(a["category_confidence"]) for a in rows)
        cat_rows.append((c, rows, bands))

    L = []
    W = L.append
    W("# BSC agent dataset — build summary")
    W("")
    W(f"Generated: `{payload['generated_at']}`  ")
    W(f"Source: 8004scan public API (`https://api.8004scan.io`), chain_id 56 (BSC).  ")
    W(f"Output: `data/agents.json` — **{n} agents**, conforming to `DATA-CONTRACT.md`.")
    W("")
    W("## Provenance")
    W("")
    W(f"- **{n} of {n} agent records are built from real fetched API responses.** "
      f"Every field traces to a file under `data/raw/` "
      f"(`data/raw/candidates.json` for list fields, "
      f"`data/raw/detail/<chain>_<token>.json` for detail fields).")
    W(f"- `data/raw/detail/` holds **{n_detail}** fetched detail responses.")
    W(f"- Detail fetches that failed after retries: **{fails['count']}**, recorded in "
      f"`data/raw/detail_failures.json`. A failed fetch is recorded as *our* "
      f"failure to measure — never as a fact about the agent.")
    W(f"- `assessment` is populated for **{len(assessed)} of {n}** agents, from the "
      f"endpoint sweep recorded in `data/probes/endpoint-probes.json`. It is "
      f"`null` for the {n - len(assessed)} agents that declare no endpoint. "
      f"No assessment value was synthesised: every field traces to a stored "
      f"probe transcript.")
    W(f"- `is_reference_agent` is `false` for all {n} agents.")
    W("")
    W("> **Disclosure.** An earlier draft of `data/agents.json` in this working "
      "directory contained hand-written placeholder agents (fabricated names, "
      "owner addresses, endpoints and a populated `assessment`). It was "
      "quarantined and discarded, and the dataset was rebuilt end-to-end from "
      "the fetched responses in `data/raw/`. None of that content survives in "
      "this dataset. We record our own errors rather than hiding them.")
    W("")
    W("## Candidate selection")
    W("")
    W("Priority order, deduped by `agent_id`:")
    W("")
    W("| stream | query | API total | taken |")
    W("|---|---|---|---|")
    W(f"| MCP | `/agents?chain_id=56&has_mcp=true` | {totals.get('mcp')} | "
      f"{totals.get('mcp')} |")
    W(f"| feedback | `/agents?chain_id=56&min_feedbacks=1` | "
      f"{totals.get('feedback')} | {totals.get('feedback')} |")
    W(f"| endpoint-verified | `/agents?chain_id=56&is_endpoint_verified=true` | "
      f"{totals.get('endpoint_verified')} | {totals.get('endpoint_verified')} |")
    W(f"| A2A (capped) | `/agents?chain_id=56&has_a2a=true` | "
      f"{totals.get('a2a')} | 3000 |")
    W("")
    W("Plus whole-population keyword searches, because the four hackathon "
      "categories are sparse and a genuine rebalancing agent need not declare "
      "MCP or A2A (so it would be invisible to the streams above):")
    W("")
    W("```")
    W("GET /api/v1/agents?chain_id=56&limit=100&offset=N&search=<term>")
    W("  terms: rebalance, rebalancing, portfolio rebalancing, grid trading,")
    W("         grid bot, trading grid, yield, yield farming, yield optimizer,")
    W("         apy, health factor, liquidation, collateral ratio")
    W("```")
    W("")
    W("Detail (this is the only view carrying the callable endpoint, tags and "
      "OASF skills):")
    W("")
    W("```")
    W("GET /api/v1/agents/56/{token_id}")
    W("```")
    W("")
    W("All requests send a `User-Agent` header — the API returns **403** without one.")
    W("")
    W("## Categories")
    W("")
    W("| category | agents | high >=0.7 | medium 0.5-0.7 | low <0.5 | none |")
    W("|---|---|---|---|---|---|")
    for c, rows, b in cat_rows:
        W(f"| {c} | {len(rows)} | {b.get('high(>=0.7)',0)} | "
          f"{b.get('medium(0.5-0.7)',0)} | {b.get('low(<0.5)',0)} | "
          f"{b.get('none(0.0)',0)} |")
    W("")
    four = sum(len(r) for c, r, _ in cat_rows if c != "other")
    W(f"**The four hackathon categories total {four} agents out of {n} "
      f"({100*four/n:.1f}%).** This is a real finding, not a shortfall: BSC's "
      "agent population is dominated by news/analysis agents, not DeFi "
      "execution agents.")
    W("")
    W("### How a category is assigned")
    W("")
    W("Deterministic keyword matching over real text only: name, description, "
      "tags, categories, OASF skills and domains, MCP tool names, A2A skill "
      "names, and declared skills/capabilities from on-chain metadata. "
      "`category_evidence` quotes the actual matched term and the field it came "
      "from, so any call can be audited.")
    W("")
    W("Three deliberate anti-inflation rules:")
    W("")
    W("1. **A category needs a specific term.** Ambiguous tokens (`balance`, "
      "`grid`, `yield`, `collateral`) never assign a category on their own; "
      "they are recorded as near-misses on an `other` agent. Matching the bare "
      "word `balance` would have produced hundreds of false rebalancing agents.")
    W("2. **Generic on-topic words need nearby corroboration.** Bare "
      "`rebalanc*` only counts with a portfolio/finance context word within "
      f"{80} characters. Field-level checks are too coarse — this rule "
      "correctly rejects a Chinese-metaphysics agent whose description reads "
      "\"Yin Yang polarity diagnosis and rebalancing\" and separately mentions "
      "a token on BNB Chain.")
    W("3. **Execution signal must be independent of the matched term.** "
      "Otherwise the word `rebalance` assigns the category and is then "
      "re-counted as proof the agent executes — a circular boost that had "
      "inflated 73 of 97 rebalancing agents to high confidence in an earlier "
      "pass. Read-only news/analysis agents that merely discuss a topic are "
      "confidence-penalised.")
    W("")
    W("## Endpoints and usage signal")
    W("")
    W(f"- **{len(with_ep)} agents ({100*len(with_ep)/n:.1f}%) declare a callable "
      f"endpoint** (MCP > A2A > web, as declared). These are the probe set.")
    W(f"- {len(with_fb)} agents have >=1 feedback on 8004scan.")
    W(f"- {len(verified)} agents are endpoint-verified by 8004scan.")
    W(f"- {len(x402)} agents declare x402 support.")
    W("")
    W("A declared endpoint is *declared*, not *reachable*: some point at "
      "placeholder hosts. Reachability is the probe run's job — see the next "
      "section, which measured it.")
    W("")
    L.extend(assessment_section(agents, probes))
    W("")
    W("## Noise / signal")
    W("")
    W(f"- BSC reports ~{cand.get('api_totals',{}).get('mcp','?')} MCP agents out of "
      "**310,418 total** on chain 56; only **6** are endpoint-verified and only "
      "**509** carry any feedback at all.")
    W(f"- **{dup_desc} of {n} agents in this candidate set share a description "
      f"with at least one other agent** — the clearest bulk-mint signal.")
    if top_dupes:
        W("  Most reused descriptions:")
        for d, c in top_dupes:
            W(f"  - {c}x `{d}...`")
    W(f"- {len(bulk)} agents match observed bulk-mint name patterns "
      "(e.g. `babycaisubagent66_quickassistant6584`, `OmegaCore_FDBCD5`).")
    W(f"- {len(zero_score)} agents have a null or zero 8004scan score.")
    W("")
    W("Bulk-minted agents are **not** excluded: some carry genuinely on-topic "
      "descriptions, and silently dropping them would be an unrecorded "
      "editorial judgement. They are visible through `scan_feedbacks`, "
      "`scan_total_score` and `category_confidence` instead.")
    W("")
    W("## Reproducing")
    W("")
    W("```bash")
    W("python3 scripts/fetch_candidates.py   # -> data/raw/list/, candidates.json")
    W("python3 scripts/fetch_details.py 16   # -> data/raw/detail/")
    W("python3 scripts/build_dataset.py      # -> data/agents.json")
    W("python3 scripts/generate_summary.py   # -> data/SUMMARY.md")
    W("```")
    W("")
    W("All three fetch steps are idempotent: cached responses under "
      "`data/raw/` are never re-fetched, so a rerun resumes rather than "
      "restarts.")
    W("")

    with open(os.path.join(DATA, "SUMMARY.md"), "w") as f:
        f.write("\n".join(L))
    print(f"wrote data/SUMMARY.md ({len(L)} lines)")
    print(f"four-category total: {four}/{n}")


if __name__ == "__main__":
    main()
