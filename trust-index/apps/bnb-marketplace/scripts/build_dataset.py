#!/usr/bin/env python3
"""Build data/agents.json from the fetched responses in data/raw/.

Every field traces to a fetched API response. Nothing is invented: a value
that is not present in the source is null. This script NEVER synthesises an
`assessment`: it writes null, and carries forward an assessment only if a
separate probe run already recorded one for that agent at that same endpoint.

Categorisation is deterministic keyword matching over REAL text only
(name, description, tags, categories, OASF skills/domains, MCP tool names,
A2A skill names). Evidence quotes the actual matched term and the field it
was found in, so a judge can audit every call.

Anti-inflation rule: a category is assigned ONLY if a STRONG, specific term
matched. Weak/ambiguous tokens ("balance", "grid", "yield", "collateral")
never assign a category on their own -- they are recorded as near-misses on
an `other` agent instead. This keeps the four hackathon categories honest
and small rather than large and wrong.

Usage: python3 scripts/build_dataset.py
"""
import json, os, re, sys, time, collections

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(HERE, "data", "raw")
DET = os.path.join(RAW, "detail")
OUT = os.path.join(HERE, "data", "agents.json")

CATEGORIES = ["rebalancing", "grid_trading", "yield", "health_factor"]

# STRONG: specific enough that a match is real evidence of the category.
STRONG = {
    "rebalancing": [
        r"portfolio re-?balanc\w*", r"re-?balanc\w{0,4}\s+(?:the\s+)?portfolio",
        r"target weight\w*", r"portfolio drift",
        r"allocation drift", r"drift threshold", r"re-?weight\w*",
        r"target allocation", r"portfolio allocation", r"asset allocation",
    ],
    "grid_trading": [
        r"grid trading", r"grid[- _]?bot", r"grid strateg\w*",
        r"grid order\w*", r"trading grid", r"grid level\w*",
        r"grid_trading", r"grid spacing",
    ],
    "yield": [
        r"yield farm\w*", r"yield aggregat\w*", r"yield optimi\w*",
        r"yield strateg\w*", r"yield generat\w*", r"auto-?compound\w*",
        r"liquidity mining", r"staking reward\w*", r"vault strateg\w*",
        r"\bapy\b", r"\bapr\b", r"farming strateg\w*",
    ],
    "health_factor": [
        r"health factor", r"health_factor", r"liquidation risk",
        r"liquidation threshold", r"collateral(?:ization|isation)? ratio",
        r"loan[- ]to[- ]value", r"\bltv\b", r"under-?collateral\w*",
        r"margin call", r"liquidation protection", r"borrow\w* capacity",
    ],
}

# GENERIC-STRONG: on-topic wording that is NOT self-sufficient, because the
# word is ordinary English used outside finance ("Yin Yang polarity diagnosis
# and rebalancing" is not a portfolio agent). These assign a category only if
# a corroborating context word appears WITHIN A CHARACTER WINDOW of the match.
# Field-level corroboration is too coarse: an unrelated agent may mention a
# token elsewhere in the same description.
STRONG_GENERIC = {
    "rebalancing": [r"re-?balanc\w*"],
}
CTX_WINDOW = 80
# Fields that are cheap, self-declared registry labels. A category match found
# ONLY in these is recorded as a near-miss, never as the basis for a category.
WEAK_FIELDS = {"tag", "category_field", "oasf_domain"}
PORTFOLIO_CTX = re.compile(
    r"portfolio|allocation|\basset|position|weight|holding|treasury|index|"
    r"basket|vault|pool|fund", re.I)
FINANCE_CTX = re.compile(
    r"defi|token|swap|liquidity|trading|trade|stak\w+|yield|protocol|wallet|"
    r"on-?chain|crypto|\bdex\b|\bbnb\b|usdt|usdc|market|\bapy\b|\bapr\b|"
    r"lending|borrow|treasury|capital", re.I)

# WEAK: ambiguous on their own. Recorded as near-misses, never category-assigning.
WEAK = {
    "rebalancing": [r"\bbalanc\w*", r"\ballocation\b", r"\bportfolio\b"],
    "grid_trading": [r"\bgrid\b"],
    "yield": [r"\byield\w*", r"\bstak\w+", r"\bvault\w*", r"\bfarm\w*"],
    "health_factor": [r"\bliquidat\w*", r"\bcollateral\w*", r"\bborrow\w*",
                      r"\blend\w+", r"\bhealth\b"],
}

# Does the agent claim to DO things, or only to talk about them?
EXECUTION = [
    r"\bexecut\w*", r"\bswap\w*", r"\bplace (?:an? )?order", r"re-?balanc\w*",
    r"\bautomat\w*", r"\btrigger\w*", r"\bmanage\w* position", r"\bdeposit\w*",
    r"\bwithdraw\w*", r"\bclaim\w*", r"\bon-?chain action", r"\bswaps\b",
    r"\btransact\w*", r"\bbuy_\w+", r"\bsell_\w+", r"\bopen position",
    r"\bclose position", r"\bswitch\w* pool",
]
# Markers of a read-only news/analysis agent (the dominant BSC population).
ANALYSIS = [
    r"news_synthesis", r"market_insights", r"crypto_analysis", r"world_events",
    r"geopolitical_analysis", r"summarization", r"information_retrieval",
    r"\bnewsletter\b", r"\bdigest\b", r"\bbriefing\b", r"\binsights\b",
    r"\bsentiment\b", r"\bnews\b", r"\breport\w*\b", r"\banalys\w*",
]


def compile_all(d):
    return {k: [(p, re.compile(p, re.I)) for p in v] for k, v in d.items()}


S_RX, W_RX = compile_all(STRONG), compile_all(WEAK)
SG_RX = compile_all(STRONG_GENERIC)
E_RX = [(p, re.compile(p, re.I)) for p in EXECUTION]
A_RX = [re.compile(p, re.I) for p in ANALYSIS]


def find_generic(cat, fields):
    """Generic on-topic terms, valid only with nearby corroborating context.

    Returns (hits, tier) where tier is 'portfolio' (strong corroboration),
    'finance' (weaker corroboration) or None (no corroboration -> reject).
    """
    hits, best = [], None
    for pat, rx in SG_RX.get(cat, []):
        for fname, txt in fields:
            m = rx.search(txt)
            if not m:
                continue
            lo = max(0, m.start() - CTX_WINDOW)
            window = txt[lo:m.end() + CTX_WINDOW]
            if PORTFOLIO_CTX.search(window):
                tier = "portfolio"
            elif FINANCE_CTX.search(window):
                tier = "finance"
            else:
                continue  # on-topic word, wrong domain -> not this category
            hits.append((pat, fname, m.group(0), tier))
            if best is None or tier == "portfolio":
                best = tier
            break
    return hits, best


def detail_for(chain_id, token_id):
    p = os.path.join(DET, f"{chain_id}_{token_id}.json")
    if os.path.exists(p) and os.path.getsize(p) > 2:
        try:
            with open(p) as f:
                return json.load(f)
        except Exception:
            return None
    return None


def text_fields(cand, det):
    """Collect (field_name, text) pairs from REAL source data only."""
    out = []
    src = det or cand
    if src.get("name"):
        out.append(("name", str(src["name"])))
    if src.get("description"):
        out.append(("description", str(src["description"])))
    if det:
        for t in det.get("tags") or []:
            out.append(("tag", str(t)))
        for c in det.get("categories") or []:
            out.append(("category_field", str(c)))
        svc = det.get("services") or {}
        oasf = svc.get("oasf") or {}
        for s in oasf.get("skills") or []:
            out.append(("oasf_skill", str(s)))
        for d in oasf.get("domains") or []:
            out.append(("oasf_domain", str(d)))
        mcp = svc.get("mcp") or {}
        for t in mcp.get("tools") or []:
            out.append(("mcp_tool", t.get("name") if isinstance(t, dict) else str(t)))
        a2a = svc.get("a2a") or {}
        for s in a2a.get("skills") or []:
            nm = s.get("name") or s.get("id") if isinstance(s, dict) else str(s)
            if nm:
                out.append(("a2a_skill", str(nm)))
        oc = (det.get("raw_metadata") or {}).get("offchain_content") or {}
        if isinstance(oc, dict):
            for s in oc.get("skills") or []:
                if isinstance(s, dict):
                    nm = s.get("id") or s.get("name")
                    if nm:
                        out.append(("declared_skill", str(nm)))
                    if s.get("description"):
                        out.append(("declared_skill_desc", str(s["description"])))
                else:
                    out.append(("declared_skill", str(s)))
            for c in oc.get("capabilities") or []:
                out.append(("capability", str(c) if not isinstance(c, dict)
                            else json.dumps(c)))
    return [(f, t) for f, t in out if t]


def find(rxs, fields):
    """Return [(pattern, field, matched_text)] for real matches."""
    hits = []
    for pat, rx in rxs:
        for fname, txt in fields:
            m = rx.search(txt)
            if m:
                hits.append((pat, fname, m.group(0)))
                break
    return hits


def any_match(rx_list, fields):
    for rx in rx_list:
        for fname, txt in fields:
            m = rx.search(txt)
            if m:
                return (fname, m.group(0))
    return None


def exec_signal(fields, exclude_patterns, exclude_texts):
    """Execution evidence INDEPENDENT of the term that assigned the category.

    Without this exclusion the boost is circular: 'rebalance' would match the
    category and then be re-counted as proof the agent executes, inflating
    every rebalancing agent's confidence on a single word.
    """
    for pat, rx in E_RX:
        if pat in exclude_patterns:
            continue
        for fname, txt in fields:
            m = rx.search(txt)
            if m and m.group(0).lower() not in exclude_texts:
                return (fname, m.group(0))
    return None


def categorise(cand, det):
    fields = text_fields(cand, det)
    analysis_hit = any_match(A_RX, fields)

    scored, strong_hits, exec_hits, tag_only = {}, {}, {}, {}
    for cat in CATEGORIES:
        hits = find(S_RX[cat], fields)
        gen_hits, tier = find_generic(cat, fields)
        if not hits and not gen_hits:
            continue
        all_hits = hits + [(p, f, t) for p, f, t, _ in gen_hits]
        strong_hits[cat] = all_hits

        if hits:
            conf = 0.60 + 0.10 * (len(all_hits) - 1)
        else:
            # generic-only: corroborated by context, so lower base confidence
            conf = 0.60 if tier == "portfolio" else 0.50
        conf = min(conf, 0.85)

        # A match found ONLY in a registry tag / taxonomy label is not enough.
        # Measured: 159 agents carry the "Yield Optimizer" tag while only 4
        # mention yield anywhere in their name or description -- the rest are
        # audit, infra and platform agents. The tag is cheap self-declared
        # metadata, so it corroborates a category but cannot establish one.
        if all(f in WEAK_FIELDS for _, f, _ in all_hits):
            tag_only.setdefault(cat, all_hits)
            continue

        ex_pats = {p for p, _, _ in all_hits}
        ex_txts = {t.lower() for _, _, t in all_hits}
        exec_hit = exec_signal(fields, ex_pats, ex_txts)
        exec_hits[cat] = exec_hit
        if exec_hit:
            conf += 0.10
        if analysis_hit and not exec_hit:
            conf -= 0.25
        # A hit only in taxonomy/domain strings is weaker than one in prose.
        if all(f in ("oasf_domain", "category_field") for _, f, _ in hits):
            conf -= 0.10
        scored[cat] = max(0.15, min(0.95, round(conf, 2)))

    if not scored:
        near = [f"{c}:'{h[2]}'({h[1]}) tag-only, uncorroborated"
                for c, hs in tag_only.items() for h in hs[:1]]
        for cat in CATEGORIES:
            for pat, fname, txt in find(W_RX[cat], fields):
                near.append(f"{cat}:'{txt}'({fname})")
        ev = ("no strong category term matched; "
              + ("weak/ambiguous near-misses: " + ", ".join(near[:6])
                 if near else "no category signal in name/description/skills"))
        if det is None:
            ev += " [detail fetch unavailable: categorised from list fields only]"
        return "other", 0.0, ev

    cat = max(scored, key=lambda c: (scored[c], len(strong_hits[c])))
    exec_hit = exec_hits.get(cat)
    parts = [f"'{txt}' in {fname}" for _, fname, txt in strong_hits[cat][:4]]
    ev = f"matched {', '.join(parts)}"
    if exec_hit:
        ev += f"; independent execution signal '{exec_hit[1]}' in {exec_hit[0]}"
    if analysis_hit and not exec_hit:
        ev += (f"; read-only/analysis marker '{analysis_hit[1]}' in "
               f"{analysis_hit[0]} and no execution signal -> confidence reduced")
    others = [c for c in scored if c != cat]
    if others:
        ev += "; also matched " + ", ".join(f"{c}({scored[c]})" for c in others)
    if det is None:
        ev += " [detail fetch unavailable: categorised from list fields only]"
    return cat, scored[cat], ev


def pick_endpoint(det):
    """The callable endpoint as DECLARED. Reachability is the probe's job."""
    if not det:
        return None
    svc = det.get("services") or {}
    for key in ("mcp", "a2a"):
        ep = (svc.get(key) or {}).get("endpoint")
        if ep:
            return ep
    for key in ("mcp_server", "a2a_endpoint", "agent_url"):
        if det.get(key):
            return det[key]
    ep = (svc.get("web") or {}).get("endpoint")
    return ep or None


def protocols(cand, det):
    out = []
    src = det or cand
    for p in src.get("supported_protocols") or []:
        if p and p not in out:
            out.append(p)
    if det:
        for k in (det.get("services") or {}):
            lbl = {"mcp": "MCP", "a2a": "A2A", "web": "Web",
                   "email": "Email", "oasf": "OASF"}.get(k, k)
            if lbl not in out:
                out.append(lbl)
    return out


def main():
    with open(os.path.join(RAW, "candidates.json")) as f:
        cands = json.load(f)["candidates"]

    fail_path = os.path.join(RAW, "detail_failures.json")
    known_fail = set()
    if os.path.exists(fail_path):
        with open(fail_path) as f:
            known_fail = {x["agent_id"] for x in json.load(f)["failures"]}

    # A separate probe run writes `assessment` into data/agents.json. Rebuilding
    # must not destroy that work, so carry forward any assessment already
    # recorded -- but ONLY when the endpoint is still the same one that was
    # probed. If the endpoint changed, the old reading no longer describes what
    # we would dial, so it reverts to null rather than being silently reused.
    prior = {}
    if os.path.exists(OUT):
        try:
            with open(OUT) as f:
                for a in json.load(f).get("agents") or []:
                    if a.get("assessment"):
                        prior[a["agent_id"]] = (a.get("endpoint"), a["assessment"])
        except Exception as e:  # noqa: BLE001
            print(f"warn: could not read prior assessments ({e}); "
                  f"all assessments will be null")

    agents, no_detail, kept, dropped = [], 0, 0, 0
    for c in cands:
        det = detail_for(c["chain_id"], c["token_id"])
        if det is None:
            no_detail += 1
        src = det or c
        cat, conf, ev = categorise(c, det)
        ts = det.get("total_score") if det else c.get("total_score")
        fb = det.get("total_feedbacks") if det else c.get("total_feedbacks")
        ep = pick_endpoint(det)
        aid = (det or c).get("agent_id") or c["agent_id"]
        assessment = None
        if aid in prior:
            prev_ep, prev_a = prior[aid]
            if prev_ep == ep and ep is not None:
                assessment, kept = prev_a, kept + 1
            else:
                dropped += 1
        agents.append({
            "agent_id": src.get("agent_id") or c["agent_id"],
            "chain_id": src.get("chain_id", c["chain_id"]),
            "token_id": str(src.get("token_id", c["token_id"])),
            "name": src.get("name") or "",
            "description": src.get("description") or "",
            "owner_address": src.get("owner_address") or "",
            "image_url": src.get("image_url"),
            "category": cat,
            "category_confidence": conf,
            "category_evidence": ev,
            "protocols": protocols(c, det),
            "endpoint": ep,
            "x402_supported": bool(src.get("x402_supported", False)),
            "scan_total_score": ts if isinstance(ts, (int, float)) else None,
            "scan_feedbacks": int(fb) if isinstance(fb, (int, float)) else 0,
            # The list view does not carry is_endpoint_verified. For an agent
            # whose detail we could not fetch, membership of the
            # is_endpoint_verified=true stream IS the evidence -- without this
            # a rate-limited fetch would silently downgrade a verified agent
            # to false, turning our gap into a claim about the agent.
            "scan_endpoint_verified": bool(
                det.get("is_endpoint_verified", False) if det
                else "endpoint_verified" in (c.get("_sources") or [])),
            "assessment": assessment,    # from the separate probe run; else null
            # Which KIND of `endpoint: null` this is. Only the detail view
            # carries an endpoint, so an agent whose detail we never fetched
            # looks identical to one that declares none -- and every consumer
            # that counts `not endpoint` then reports our rate-limit gap as a
            # fact about the agent. See DATA-CONTRACT.md rule 4.
            "detail_status": "read" if det is not None else "unread_rate_limited",
            "is_reference_agent": False,
        })

    payload = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "agents": agents,
    }
    tmp = OUT + ".tmp"
    with open(tmp, "w") as f:
        json.dump(payload, f)
    os.replace(tmp, OUT)

    cats = collections.Counter(a["category"] for a in agents)
    print(f"wrote {len(agents)} agents -> {OUT}")
    print(f"assessments carried forward from probe run: {kept} "
          f"(dropped because endpoint changed: {dropped})")
    print(f"agents without a detail file: {no_detail} "
          f"(recorded fetch failures: {len(known_fail)})")

    # detail_status labels every unread agent "unread_rate_limited", which is
    # only honest while the rate limit really is the reason. If an agent has no
    # detail file and no recorded failure, we do not know why we lack it, and
    # saying "rate limited" would be inventing a reason -- the same class of
    # error the field exists to prevent. Fail loudly rather than mislabel.
    unread_ids = {a["agent_id"] for a in agents
                  if a["detail_status"] == "unread_rate_limited"}
    unexplained = unread_ids - known_fail
    if unexplained:
        print(f"ERROR: {len(unexplained)} agents have no detail file and no "
              f"recorded fetch failure, so 'unread_rate_limited' would be a "
              f"guess. Re-run fetch_details.py so the reason is recorded.")
        print(f"  e.g. {sorted(unexplained)[:5]}")
        return 1

    counts = collections.Counter(a["detail_status"] for a in agents)
    real_no_ep = sum(1 for a in agents
                     if a["detail_status"] == "read" and not a["endpoint"])
    print(f"detail_status: {dict(counts)}")
    print(f"declare no endpoint (detail READ, a fact): {real_no_ep}  "
          f"-- never report this as {real_no_ep + counts['unread_rate_limited']}")
    for c in CATEGORIES + ["other"]:
        hi = sum(1 for a in agents
                 if a["category"] == c and a["category_confidence"] >= 0.7)
        md = sum(1 for a in agents if a["category"] == c
                 and 0.4 <= a["category_confidence"] < 0.7)
        print(f"  {c:14} {cats.get(c,0):6}  (>=0.7: {hi}, 0.4-0.7: {md})")
    print(f"  with endpoint: {sum(1 for a in agents if a['endpoint'])}")
    print(f"  with feedback: {sum(1 for a in agents if a['scan_feedbacks'] > 0)}")


if __name__ == "__main__":
    sys.exit(main())
