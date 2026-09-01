#!/usr/bin/env python3
"""
Consider (getconsider) portfolio job scanner.

Consider-backed VC boards (a16z, Sequoia, Lightspeed, ...) render client-side
and gate their data API behind a per-page CSRF token. The board host exposes:

    GET  https://{host}/jobs                      -> HTML embeds "csrfToken":"..."
                                                     and board {"id":"<slug>"}
    POST https://{host}/api-boards/search-jobs
         headers: X-CSRF-Token, Accept: application/json, Origin, Referer
         body: {"meta":{"size":N,"sequence":<cursor>},
                "board":{"id":"<slug>","isParent":true},
                "query":{"jobFunctions":["Product Management"]}}   # or a text query
         resp: {"jobs":[...], "total":N, "meta":{"sequence":<next cursor>}, ...}

Transport is curl (headless browser is reset by this environment's proxy).
Output schema matches getro_scan.py so finalize.py can merge both sources.
"""
import subprocess, json, re, sys, time, calendar
from concurrent.futures import ThreadPoolExecutor, as_completed
from getro_scan import title_is_exec   # reuse the exact exec-title filter

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"

# fund_key -> (display name, board host).  Board slug is auto-detected from HTML.
CONSIDER_BOARDS = {
    "a16z":            ("a16z (Andreessen Horowitz)", "portfoliojobs.a16z.com"),
    "sequoia":         ("Sequoia Capital",            "jobs.sequoiacap.com"),
    "lightspeed":      ("Lightspeed Venture Partners","jobs.lsvp.com"),
    "kleiner-perkins": ("Kleiner Perkins",            "jobs.kleinerperkins.com"),
    "bessemer":        ("Bessemer Venture Partners",  "jobs.bvp.com"),
    "battery":         ("Battery Ventures",           "jobs.battery.com"),
    "gv":              ("GV (Google Ventures)",       "jobs.gv.com"),
    "felicis":         ("Felicis",                    "jobs.felicis.com"),
    "ivp":             ("IVP",                        "careers.ivp.com"),
    "nea":             ("NEA",                         "careers.nea.com"),
}

# Product-function filter value + text queries for operating/exec titles the
# Product-Management function bucket may miss (COO etc.)
PM_FUNCTION = "Product Management"
TEXT_QUERIES = ["chief operating officer", "chief product officer", "head of product"]


def sh(args):
    return subprocess.run(args, capture_output=True, text=True)


def get_token_and_slug(host):
    p = sh(["curl", "-sS", "--max-time", "25", "-c", f"/tmp/cj_{host}.txt",
            "-H", f"User-Agent: {UA}", f"https://{host}/jobs"])
    html = p.stdout
    tok = re.search(r'"csrfToken":"([^"]+)"', html)
    slug = re.search(r'"board":\{"id":"([^"]+)"', html)
    return (tok.group(1) if tok else None), (slug.group(1) if slug else None)


def post(host, tok, body):
    p = sh(["curl", "-sS", "--max-time", "35", "-b", f"/tmp/cj_{host}.txt",
            "-H", f"User-Agent: {UA}", "-H", "Accept: application/json",
            "-H", "Content-Type: application/json", "-H", f"X-CSRF-Token: {tok}",
            "-H", f"Origin: https://{host}", "-H", f"Referer: https://{host}/jobs",
            "-X", "POST", "-d", json.dumps(body),
            f"https://{host}/api-boards/search-jobs"])
    for attempt in range(3):
        try:
            d = json.loads(p.stdout)
            if "jobs" in d:
                return d
        except Exception:
            pass
        time.sleep(2 * (attempt + 1))
        p = sh(["curl", "-sS", "--max-time", "35", "-b", f"/tmp/cj_{host}.txt",
                "-H", f"User-Agent: {UA}", "-H", "Accept: application/json",
                "-H", "Content-Type: application/json", "-H", f"X-CSRF-Token: {tok}",
                "-H", f"Origin: https://{host}", "-H", f"Referer: https://{host}/jobs",
                "-X", "POST", "-d", json.dumps(body),
                f"https://{host}/api-boards/search-jobs"])
    return {"jobs": [], "meta": {}, "total": 0, "_error": p.stdout[:150]}


def paginate(host, tok, slug, query, max_pages):
    jobs, seq, seen = [], None, set()
    for _ in range(max_pages):
        meta = {"size": 100}
        if seq:
            meta["sequence"] = seq
        d = post(host, tok, {"meta": meta,
                             "board": {"id": slug, "isParent": True},
                             "query": query})
        js = d.get("jobs", [])
        new = 0
        for j in js:
            jid = j.get("jobId") or j.get("url")
            if jid and jid not in seen:
                seen.add(jid); jobs.append(j); new += 1
        seq = d.get("meta", {}).get("sequence")
        if not js or new == 0 or not seq:
            break
    return jobs


def parse_ts(ts):
    if not ts:
        return None
    try:
        return calendar.timegm(time.strptime(ts[:19], "%Y-%m-%dT%H:%M:%S"))
    except Exception:
        return None


def norm_row(j, fund_name):
    sal = j.get("salary") or {}
    mn, mx = sal.get("minValue"), sal.get("maxValue")
    locs = j.get("normalizedLocations") or j.get("locations") or []
    locs = [(l.get("label") if isinstance(l, dict) else l) for l in locs][:3]
    stages = j.get("stages") or []
    stage = (stages[0].get("value") if isinstance(stages[0], dict) else stages[0]) if stages else None
    markets = [(m.get("label") if isinstance(m, dict) else m) for m in (j.get("markets") or [])]
    wm = "remote" if j.get("remote") else ("hybrid" if j.get("hybrid") else "on_site")
    return {
        "title": j.get("title", ""),
        "url": j.get("applyUrl") or j.get("url"),
        "work_mode": wm,
        "seniority": ",".join(s.get("value") for s in (j.get("jobSeniorities") or []) if isinstance(s, dict)) or None,
        "locations": locs,
        "location_details": None,
        "created_at": parse_ts(j.get("timeStamp")),
        "comp_min_cents": int(mn * 100) if mn else None,
        "comp_max_cents": int(mx * 100) if mx else None,
        "comp_currency": (sal.get("currency") or {}).get("value") if isinstance(sal.get("currency"), dict) else None,
        "comp_period": (sal.get("period") or {}).get("value") if isinstance(sal.get("period"), dict) else None,
        "offers_equity": None,
        "company": j.get("companyName"),
        "org_slug": j.get("companySlug") or j.get("companyName"),
        "stage": stage,
        "head_count": j.get("companyStaffCount"),
        "industry_tags": markets,
        "topics": [],
        "min_years_exp": j.get("minYearsExp"),
    }


def scan_board(fund_key):
    name, host = CONSIDER_BOARDS[fund_key]
    tok, slug = get_token_and_slug(host)
    if not tok or not slug:
        return fund_key, name, 0, [], f"no token/slug (tok={bool(tok)} slug={slug})"
    by_id = {}
    # 1) full Product-Management function
    for j in paginate(host, tok, slug, {"jobFunctions": [PM_FUNCTION]}, max_pages=8):
        by_id[j.get("jobId") or j.get("url")] = j
    # 2) text queries for operating/exec titles the PM bucket may miss
    for q in TEXT_QUERIES:
        for j in paginate(host, tok, slug, q, max_pages=1):
            by_id.setdefault(j.get("jobId") or j.get("url"), j)
    matched = [norm_row(j, name) for j in by_id.values() if title_is_exec(j.get("title", ""))]
    for r in matched:
        r["funds"] = [name]
    return fund_key, name, len(by_id), matched, None


def main():
    all_rows, errors, funds_ok = [], [], []
    with ThreadPoolExecutor(max_workers=5) as ex:
        futs = {ex.submit(scan_board, k): k for k in CONSIDER_BOARDS}
        for f in as_completed(futs):
            fund_key, name, npull, matched, err = f.result()
            if err:
                errors.append((fund_key, err))
                print(f"[ERROR] {name}: {err}", file=sys.stderr)
                continue
            funds_ok.append(name)
            all_rows.extend(matched)
            print(f"[{name:30}] pulled={npull:4}  exec-matches={len(matched)}", file=sys.stderr)
    out = {"generated_at": int(time.time()), "funds_scanned": funds_ok,
           "errors": errors, "n_roles": len(all_rows), "rows": all_rows}
    json.dump(out, open("data/consider_exec_roles.json", "w"), indent=1)
    print(f"\nTOTAL Consider: {len(all_rows)} exec roles from {len(funds_ok)} funds "
          f"-> data/consider_exec_roles.json", file=sys.stderr)


if __name__ == "__main__":
    main()
