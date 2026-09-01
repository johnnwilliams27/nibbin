#!/usr/bin/env python3
"""
Getro portfolio job scanner.

Sweeps the Getro-backed job boards of top VC funds for open EXECUTIVE
product / operating leadership roles (Head of Product, VP/SVP/EVP Product,
Chief Product Officer, CPTO, COO), dedupes companies across funds, and emits
JSON for downstream domain-fit scoring.

Transport: shells out to `curl` (the only reliable egress path in this
environment; the headless browser is reset by the proxy). The Getro public
API is:
    POST https://api.getro.com/api/v2/collections/{network_id}/search/jobs
    headers: User-Agent (browser), Origin, Accept: application/json, Content-Type
    body:    {"hitsPerPage":N,"page":P,"query":"","filters":{"seniority":[...]}}
    resp:    {"results":{"count":N,"jobs":[...]}}
"""
import subprocess, json, re, sys, time
from concurrent.futures import ThreadPoolExecutor, as_completed

# fund_key -> (display name, getro network id)
GETRO_NETWORKS = {
    "general-catalyst": ("General Catalyst", 222),
    "8vc":              ("8VC", 1005),
    "accel":            ("Accel", 8672),
    "thrive":           ("Thrive Capital", 2105),
    "insight":          ("Insight Partners", 246),
    "menlo":            ("Menlo Ventures", 767),
    "craft":            ("Craft Ventures", 340),
    "oak-hcft":         ("Oak HC/FT", 637),
    "venrock":          ("Venrock", 319),
    "406":              (".406 Ventures", 13096),
    "khosla":           ("Khosla Ventures", 257),
    "redpoint":         ("Redpoint Ventures", 189),
    "founders-fund":    ("Founders Fund", 13095),
    "radical":          ("Radical Ventures", 816),
    "flare":            ("Flare Capital Partners", 9366),
}

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
# The Getro search API caps deep pagination at ~420 results, so we cannot page
# the whole "director" tier (thousands of rows). Instead:
#   1) paginate the small "vice_president" bucket fully  -> VP/SVP/EVP/CPO/CPTO/COO
#   2) run narrow phrase queries (corpus-reducing) to catch exec titles that
#      Getro tags as "director" (esp. "Head of Product") or mis-tags.
VP_SENIORITY = ["vice_president"]
PHRASE_QUERIES = [
    "head of product", "chief product officer", "chief operating officer",
    "chief product and technology officer", "svp product", "vp of product",
]

# ---- title matching -------------------------------------------------------
# \bproduct\b prevents matching "production"; management/mgmt suffix allowed
_P = r"product(?:s|\s+management|\s+mgmt)?\b"
EXEC_RE = re.compile(
    r"("
    r"chief\s+product\s+officer|(?<![a-z])cpo(?![a-z])|"
    r"chief\s+product\s+(?:and|&|/)\s*(?:technology|engineering)\s+officer|(?<![a-z])cpto(?![a-z])|"
    r"chief\s+operating\s+officer|(?<![a-z])coo(?![a-z])|"
    r"chief\s+(?:business|commercial)\s+officer|"
    r"(?:global\s+|group\s+)?head\s+of\s+" + _P + r"|"
    r"head/vp\s+of\s+" + _P + r"|"
    r"(?:s|e)?vp[, ]+(?:of\s+)?" + _P + r"|"
    r"(?:senior|executive)\s+vice\s+president[, ]+(?:of\s+)?" + _P + r"|"
    r"vice\s+president[, ]+(?:of\s+)?" + _P +
    r")", re.I)

# disqualifiers (applied after EXEC match)
EXCL_RE = re.compile(
    r"(marketing|"
    r"\bdesign(?:er)?\b|\bux\b|\bui\b|"
    r"product\s+operations|product\s+ops|"
    r"product\s+engineering|product\s+(?:and|&)\s+(?:software\s+)?security|product\s+security|"
    r"\bproduction\b|communications|\bassurance\b|"      # Production / Comms / QA(Assurance)
    r"\bassistant\b|chief\s+of\s+staff|business\s+partner|"  # EA / CoS / ABP roles
    r"expert\s+opportunity|\$\d|/hr|/hour|per\s+hour|/week|hourly|"
    r"contract(?:or)?\b|part[- ]time|intern(?:ship)?|"
    r"\bcounsel\b|\blegal\b|\banalyst\b|\bresearch\b|"
    r"\bengineer\b(?!ing)|\bdesigner\b)",
    re.I)

def title_is_exec(t: str) -> bool:
    return bool(EXEC_RE.search(t)) and not EXCL_RE.search(t)

# ---- Getro API ------------------------------------------------------------
def getro_post(network_id, body, retries=4):
    args = ["curl", "-sS", "--max-time", "30",
            "-H", f"User-Agent: {UA}",
            "-H", "Origin: https://jobs.example.com",
            "-H", "Accept: application/json",
            "-H", "Content-Type: application/json",
            "-X", "POST", "-d", json.dumps(body),
            f"https://api.getro.com/api/v2/collections/{network_id}/search/jobs"]
    delay = 2
    for attempt in range(retries):
        p = subprocess.run(args, capture_output=True, text=True)
        try:
            d = json.loads(p.stdout)
            if "results" in d:
                return d
        except Exception:
            pass
        time.sleep(delay); delay *= 2
    return {"results": {"jobs": [], "count": 0}, "_error": p.stdout[:200]}

def _paginate(nid, body, max_pages):
    """Page through a query until exhausted or max_pages, deduping by job id."""
    out, seen, page = [], set(), 0
    while page < max_pages:
        b = dict(body); b["hitsPerPage"] = 100; b["page"] = page
        d = getro_post(nid, b)
        js = d["results"]["jobs"]; count = d["results"]["count"]
        new = 0
        for j in js:
            if j["id"] not in seen:
                seen.add(j["id"]); out.append(j); new += 1
        if not js or len(out) >= count or new == 0:
            break
        page += 1
    return out, (count if 'count' in dir() else len(out))

def scan_fund(fund_key):
    name, nid = GETRO_NETWORKS[fund_key]
    by_id = {}
    # 1) full vice_president tier (cap-safe)
    vp_jobs, vp_count = _paginate(nid, {"query": "", "filters": {"seniority": VP_SENIORITY}}, max_pages=15)
    for j in vp_jobs:
        by_id[j["id"]] = j
    # 2) narrow phrase queries (catch director-tagged Head of Product etc.)
    for q in PHRASE_QUERIES:
        pj, _ = _paginate(nid, {"query": q}, max_pages=2)
        for j in pj:
            by_id.setdefault(j["id"], j)
    jobs = list(by_id.values())
    matched = [j for j in jobs if title_is_exec(j["title"])]
    return fund_key, name, vp_count, len(jobs), matched

def main():
    results = {}
    errors = []
    with ThreadPoolExecutor(max_workers=6) as ex:
        futs = {ex.submit(scan_fund, k): k for k in GETRO_NETWORKS}
        for f in as_completed(futs):
            k = futs[f]
            try:
                fund_key, name, count, pulled, matched = f.result()
                results[fund_key] = matched
                print(f"[{name:26}] tier jobs={count:5}  pulled={pulled:5}  exec-matches={len(matched)}",
                      file=sys.stderr)
            except Exception as e:
                errors.append((k, str(e)))
                print(f"[ERROR] {k}: {e}", file=sys.stderr)

    # ---- dedupe companies across funds -----------------------------------
    # key on org slug; a company backed by multiple funds -> one entry, many funds
    companies = {}   # org_slug -> record
    for fund_key, matched in results.items():
        fund_name = GETRO_NETWORKS[fund_key][0]
        for j in matched:
            org = j.get("organization") or {}
            oslug = org.get("slug") or org.get("name")
            if not oslug:
                continue
            rec = companies.setdefault(oslug, {
                "company": org.get("name"),
                "org_slug": oslug,
                "stage": org.get("stage"),
                "head_count": org.get("head_count"),
                "industry_tags": org.get("industry_tags") or [],
                "topics": org.get("topics") or [],
                "funds": set(),
                "roles": {},        # dedupe roles by (title, url)
            })
            rec["funds"].add(fund_name)
            rk = (j["title"], j.get("url"))
            if rk not in rec["roles"]:
                rec["roles"][rk] = {
                    "title": j["title"],
                    "url": j.get("url"),
                    "work_mode": j.get("work_mode"),
                    "seniority": j.get("seniority"),
                    "locations": j.get("searchable_locations") or j.get("locations") or [],
                    "location_details": j.get("location_details"),
                    "created_at": j.get("created_at"),
                    "comp_min_cents": j.get("compensation_amount_min_cents"),
                    "comp_max_cents": j.get("compensation_amount_max_cents"),
                    "comp_currency": j.get("compensation_currency"),
                    "comp_period": j.get("compensation_period"),
                    "offers_equity": j.get("compensation_offers_equity"),
                }

    # flatten to list of role rows
    rows = []
    for oslug, rec in companies.items():
        for rk, role in rec["roles"].items():
            rows.append({
                **role,
                "company": rec["company"],
                "org_slug": oslug,
                "stage": rec["stage"],
                "head_count": rec["head_count"],
                "industry_tags": rec["industry_tags"],
                "topics": rec["topics"],
                "funds": sorted(rec["funds"]),
            })

    out = {
        "generated_at": int(time.time()),
        "funds_scanned": [GETRO_NETWORKS[k][0] for k in results],
        "errors": errors,
        "n_companies": len(companies),
        "n_roles": len(rows),
        "rows": rows,
    }
    json.dump(out, open("data/getro_exec_roles.json", "w"), indent=1)
    print(f"\nTOTAL: {len(rows)} exec roles across {len(companies)} companies "
          f"from {len(results)} funds. -> data/getro_exec_roles.json", file=sys.stderr)

if __name__ == "__main__":
    main()
