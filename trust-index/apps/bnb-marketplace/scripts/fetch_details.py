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

BASE = "https://api.8004scan.io/api/v1"
UA = "nibbin-trust-index/1.0 (hackathon marketplace data pipeline)"
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(HERE, "data", "raw")
DET = os.path.join(RAW, "detail")

_lock = threading.Lock()
_done = [0]


def detail_path(chain_id, token_id):
    return os.path.join(DET, f"{chain_id}_{token_id}.json")


def fetch_one(cand, tries=8):
    chain_id, token_id = cand["chain_id"], cand["token_id"]
    p = detail_path(chain_id, token_id)
    if os.path.exists(p) and os.path.getsize(p) > 2:
        return ("cached", cand["agent_id"], None)
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(
                f"{BASE}/agents/{chain_id}/{token_id}",
                headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=60) as r:
                body = r.read().decode()
            json.loads(body)  # validate before persisting
            tmp = p + ".tmp"
            with open(tmp, "w") as f:
                f.write(body)
            os.replace(tmp, p)
            return ("ok", cand["agent_id"], None)
        except Exception as e:  # noqa: BLE001 - retry timeouts too
            last = e
            code = getattr(e, "code", None)
            if code == 404:
                return ("missing", cand["agent_id"], "404 from detail endpoint")
            if code == 429:
                # Rate limited. Back off hard and honour Retry-After when the
                # server sends one: being throttled is not the agent's problem,
                # and giving up here would misrecord it as missing data.
                ra = 0
                try:
                    ra = int(e.headers.get("Retry-After", 0))
                except Exception:
                    ra = 0
                time.sleep(max(ra, min(5 * (2 ** i), 60)))
                continue
            time.sleep(min(1.5 * (2 ** i), 20))
    return ("failed", cand["agent_id"], repr(last)[:300])


def main():
    conc = int(sys.argv[1]) if len(sys.argv) > 1 else 16
    os.makedirs(DET, exist_ok=True)
    with open(os.path.join(RAW, "candidates.json")) as f:
        cands = json.load(f)["candidates"]
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
        if status in ("failed", "missing"):
            failures.append({"agent_id": aid, "status": status, "error": err})

    with open(os.path.join(RAW, "detail_failures.json"), "w") as f:
        json.dump({"count": len(failures), "failures": failures}, f, indent=1)

    print(f"\ndone in {time.time()-st:.0f}s: {counts}", flush=True)
    if failures:
        print(f"{len(failures)} failures recorded in data/raw/detail_failures.json",
              flush=True)


if __name__ == "__main__":
    sys.exit(main())
