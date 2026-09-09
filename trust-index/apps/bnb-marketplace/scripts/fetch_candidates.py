#!/usr/bin/env python3
"""Pull the BSC candidate set from 8004scan into data/raw/.

Idempotent: every page is cached on disk and never re-fetched. A fetch that
fails after all retries is recorded as a fetch failure (our failure to
measure), never as an absence of data.

Usage: python3 scripts/fetch_candidates.py
"""
import json, os, sys, time, urllib.parse, urllib.request, urllib.error

BASE = "https://api.8004scan.io/api/v1"
UA = "nibbin-trust-index/1.0 (hackathon marketplace data pipeline)"
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(HERE, "data", "raw")
LIST_DIR = os.path.join(RAW, "list")
CHAIN = 56
PAGE = 100

# Candidate streams, in the priority order from the brief. Each is
# (slug, query-params, cap). cap=None means "take everything the API reports".
STREAMS = [
    ("mcp",              {"has_mcp": "true"},               None),
    ("feedback",         {"min_feedbacks": "1"},            None),
    ("endpoint_verified",{"is_endpoint_verified": "true"},  None),
    ("a2a",              {"has_a2a": "true"},               3000),
]

# Targeted whole-population searches for the four hackathon categories.
# The four categories are known to be sparse, and a real rebalancing agent
# need not declare MCP/A2A, so it would be invisible to the streams above.
# These are recall aids only -- they do not relax categorisation.
SEARCH_TERMS = [
    "rebalance", "rebalancing", "portfolio rebalancing",
    "grid trading", "grid bot", "trading grid",
    "yield", "yield farming", "yield optimizer", "apy",
    "health factor", "liquidation", "collateral ratio",
]


def get(url, tries=5):
    """GET with exponential backoff. Returns parsed JSON or raises."""
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(
                url, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read().decode())
        except Exception as e:  # noqa: BLE001 - retry everything, incl. timeouts
            last = e
            code = getattr(e, "code", None)
            if code in (400, 404):  # not transient
                raise
            time.sleep(min(2 ** i, 20))
    raise RuntimeError(f"failed after {tries} tries: {url}: {last!r}") from last


def page_path(slug, offset):
    return os.path.join(LIST_DIR, slug, f"offset_{offset:07d}.json")


def fetch_stream(slug, params, cap):
    """Page a filtered list endpoint into data/raw/list/<slug>/."""
    os.makedirs(os.path.join(LIST_DIR, slug), exist_ok=True)
    items, offset, total = [], 0, None
    while True:
        p = page_path(slug, offset)
        if os.path.exists(p):
            with open(p) as f:
                d = json.load(f)
        else:
            q = {"chain_id": CHAIN, "limit": PAGE, "offset": offset, **params}
            d = get(f"{BASE}/agents?{urllib.parse.urlencode(q)}")
            with open(p, "w") as f:
                json.dump(d, f)
        total = d.get("total")
        batch = d.get("items") or []
        items.extend(batch)
        if not batch:
            break
        offset += PAGE
        if cap and len(items) >= cap:
            items = items[:cap]
            break
        if total is not None and offset >= total:
            break
    print(f"  {slug}: {len(items)} items (api total={total}"
          f"{', capped' if cap else ''})", flush=True)
    return items, total


def fetch_search(term):
    """Whole-population keyword search; small result sets, single page mostly."""
    slug = "search_" + term.replace(" ", "_")
    os.makedirs(os.path.join(LIST_DIR, slug), exist_ok=True)
    items, offset = [], 0
    while True:
        p = page_path(slug, offset)
        if os.path.exists(p):
            with open(p) as f:
                d = json.load(f)
        else:
            q = {"chain_id": CHAIN, "limit": PAGE, "offset": offset,
                 "search": term}
            d = get(f"{BASE}/agents?{urllib.parse.urlencode(q)}")
            with open(p, "w") as f:
                json.dump(d, f)
        batch = d.get("items") or []
        items.extend(batch)
        total = d.get("total")
        if not batch or (total is not None and offset + PAGE >= total):
            break
        offset += PAGE
        if offset >= 500:  # these sets are tiny; guard runaway paging
            break
    print(f"  search '{term}': {len(items)}", flush=True)
    return items


def main():
    os.makedirs(LIST_DIR, exist_ok=True)
    by_id, sources, totals = {}, {}, {}

    print("Streams:", flush=True)
    for slug, params, cap in STREAMS:
        items, total = fetch_stream(slug, params, cap)
        totals[slug] = total
        for it in items:
            aid = it["agent_id"]
            by_id.setdefault(aid, it)
            sources.setdefault(aid, []).append(slug)

    print("Category recall searches:", flush=True)
    for term in SEARCH_TERMS:
        for it in fetch_search(term):
            aid = it["agent_id"]
            by_id.setdefault(aid, it)
            sources.setdefault(aid, []).append(f"search:{term}")

    out = {
        "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "api_totals": totals,
        "candidates": [
            {**by_id[a], "_sources": sorted(set(sources[a]))}
            for a in sorted(by_id)
        ],
    }
    dest = os.path.join(RAW, "candidates.json")
    with open(dest, "w") as f:
        json.dump(out, f)
    print(f"\nDeduped candidates: {len(by_id)} -> {dest}", flush=True)


if __name__ == "__main__":
    sys.exit(main())
