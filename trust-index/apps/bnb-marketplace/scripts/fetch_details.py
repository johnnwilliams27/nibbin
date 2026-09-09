#!/usr/bin/env python3
"""Fetch the full agent detail for every candidate into data/raw/detail/.

The list view does not carry the callable endpoint, tags or OASF skills --
only the detail view does. Idempotent: a cached detail file is never
re-fetched. Agents whose detail could not be fetched after retries are
written to data/raw/detail_failures.json as OUR failure to measure; they are
never silently treated as agents without endpoints.

Usage: python3 scripts/fetch_details.py [concurrency]
"""
import json, os, sys, threading, time, urllib.request
import concurrent.futures as cf
from detail_response import read_detail, validate_detail

BASE = "https://api.8004scan.io/api/v1"
UA = "nibbin-trust-index/1.0 (hackathon marketplace data pipeline)"
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(HERE, "data", "raw")
DET = os.path.join(RAW, "detail")

_lock = threading.Lock()
_done = [0]

# Quota is shared across identities. Once exhausted, queued work is deferred
# without another request. Already-running requests may still finish.
_quota_exhausted = threading.Event()


def detail_path(chain_id, token_id):
    return os.path.join(DET, f"{chain_id}_{token_id}.json")


def fetch_one(cand, tries=8):
    chain_id, token_id = cand["chain_id"], cand["token_id"]
    p = detail_path(chain_id, token_id)
    try:
        if read_detail(p, cand) is not None:
            return ("cached", cand["agent_id"], None)
    except (ValueError, OSError):
        pass  # Invalid cache is replaceable only by a valid new response.
    last = None
    for i in range(tries):
        if _quota_exhausted.is_set():
            return ("rate_limited", cand["agent_id"],
                    "deferred: this run exhausted the shared detail quota (HTTP 429)")
        try:
            req = urllib.request.Request(
                f"{BASE}/agents/{chain_id}/{token_id}",
                headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=60) as r:
                body = r.read().decode()
            validate_detail(json.loads(body), cand)
            tmp = p + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                f.write(body)
            os.replace(tmp, p)
            return ("ok", cand["agent_id"], None)
        except Exception as e:  # noqa: BLE001 - retry timeouts too
            last = e
            code = getattr(e, "code", None)
            if code == 404:
                return ("missing", cand["agent_id"], "404 from detail endpoint")
            if code == 429:
                _quota_exhausted.set()
                retry_after = e.headers.get("Retry-After", "unspecified") if e.headers else "unspecified"
                return ("rate_limited", cand["agent_id"], f"HTTP 429; Retry-After: {retry_after}")
            if i + 1 < tries:
                time.sleep(min(1.5 * (2 ** i), 20))
    return ("failed", cand["agent_id"], repr(last)[:300])


def main():
    _quota_exhausted.clear()
    _done[0] = 0
    conc = int(sys.argv[1]) if len(sys.argv) > 1 else 16
    os.makedirs(DET, exist_ok=True)
    with open(os.path.join(RAW, "candidates.json")) as f:
        cands = json.load(f)["candidates"]

    # The API allows 1000 requests/hour, so a run CAN be cut off mid-way.
    # Fetch in value order, not registry order, so that whatever we do get is
    # the highest-signal part of the population rather than an arbitrary slice.
    def priority(c):
        s = set(c.get("_sources") or [])
        return (
            0 if "endpoint_verified" in s else
            1 if "feedback" in s or (c.get("total_feedbacks") or 0) > 0 else
            2 if any(x.startswith("search:") for x in s) else
            3 if "mcp" in s else 4)

    cands.sort(key=priority)
    total = len(cands)
    print(f"{total} candidates, concurrency={conc}", flush=True)

    results = []

    def work(c):
        r = fetch_one(c)
        with _lock:
            _done[0] += 1
            if _done[0] % 500 == 0:
                print(f"  {_done[0]}/{total}", flush=True)
        return r

    st = time.time()
    with cf.ThreadPoolExecutor(conc) as ex:
        results = list(ex.map(work, cands))

    counts = {}
    failures = []
    for status, aid, err in results:
        counts[status] = counts.get(status, 0) + 1
        if status in ("failed", "missing", "rate_limited"):
            failures.append({"agent_id": aid, "status": status, "error": err})

    with open(os.path.join(RAW, "detail_failures.json"), "w") as f:
        json.dump({"count": len(failures), "failures": failures}, f, indent=1)

    print(f"\ndone in {time.time()-st:.0f}s: {counts}", flush=True)
    if failures:
        print(f"{len(failures)} failures recorded in data/raw/detail_failures.json",
              flush=True)


if __name__ == "__main__":
    sys.exit(main())
