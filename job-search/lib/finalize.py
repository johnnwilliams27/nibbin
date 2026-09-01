#!/usr/bin/env python3
"""
Assemble the final ranked list from the Getro scan:
  - drop publicly traded companies (and those owned by a public parent)
  - dedupe roles
  - apply domain-fit scores (1-5) tuned to John Williams' profile
    (payments / fintech / crypto / billing core; AI-native/agentic frontier;
     healthcare-payer as secondary edge)
  - emit product_exec_roles.csv + product_exec_roles.md
"""
import json, csv, datetime, re

import os
# --- load & merge all scan sources ----------------------------------------
SOURCES = ["data/getro_exec_roles.json", "data/consider_exec_roles.json"]
raw_rows = []
funds_scanned = []
scan_errors = []
for src in SOURCES:
    if not os.path.exists(src):
        continue
    s = json.load(open(src))
    raw_rows.extend(s.get("rows", []))
    funds_scanned.extend(s.get("funds_scanned", []))
    scan_errors.extend(s.get("errors", []))

# A job is uniquely its apply URL. Group by URL (falling back to
# company+title) so the same role surfaced by multiple funds/sources becomes
# ONE row with all backing funds unioned (dedupes e.g. Trifacta==Alteryx,
# Green Places==Greenplaces).
def _ckey(name):  # alphanumeric-only company key
    return re.sub(r"[^a-z0-9]", "", (name or "").lower().split("|")[0])

_groups = {}
for r in raw_rows:
    if not r.get("company"):
        continue
    url = (r.get("url") or "").strip().lower()
    key = url if url else (_ckey(r.get("company")), r.get("title", "").strip().lower())
    g = _groups.setdefault(key, {"funds": set(), "row": r})
    g["funds"].update(r.get("funds", []))
    # keep the row with the richer company name / more fields
    if len(str(r.get("company", ""))) and not g["row"].get("company"):
        g["row"] = r

merged_rows = []
for key, g in _groups.items():
    rr = dict(g["row"])
    rr["funds"] = sorted(g["funds"])
    merged_rows.append(rr)

d = {"rows": merged_rows, "funds_scanned": sorted(set(funds_scanned)), "errors": scan_errors}

# --- publicly traded OR majority-owned by a public parent -> DROP -----------
DROP_PUBLIC = {
    "crowdstrike": "NASDAQ:CRWD",
    "okta": "NASDAQ:OKTA",
    "flywire": "NASDAQ:FLYW",
    "square": "Block, NYSE:XYZ",
    "xero": "ASX:XRO",
    "sentinelone": "NYSE:S",
    "airkit": "acq. by Salesforce (NYSE:CRM) / MuleSoft",
    "webroot": "owned by OpenText (NASDAQ:OTEX)",
    "volterra": "acq. by F5 (NASDAQ:FFIV)",
    "monolith ai": "acq. by CoreWeave (NASDAQ:CRWV)",
    "lilac cloud": "acq. by F5 (NASDAQ:FFIV)",
    "ionq": "NYSE:IONQ",
    "sprinklr": "NYSE:CXM",
    "rakuten": "TSE:4755",
}

# ownership notes for kept companies that were acquired/PE (still private)
OWNERSHIP = {
    "alteryx": "private (PE: Clearlake, 2024)",
    "trifacta": "private (Alteryx company; PE Clearlake)",
    "tessian": "private (acq. by Proofpoint; PE Thoma Bravo)",
    "lilac cloud": "private (acquired; unknown parent)",
}

# --- domain-fit scores (company_lower -> (score, justification)) ------------
# 5 payments/fintech/crypto/billing/banking core | 4 AI-native/agentic OR
# healthcare-payer/benefits OR insurtech/lending | 3 horizontal B2B SaaS /
# commerce / general healthtech / analytics | 2 other vertical/consumer/security
# | 1 no overlap
SCORES = {
    "rippling":          (5, "Rippling Finance = spend/bill-pay/payments inside the HR platform — direct money-movement match to PayPal/Block/Google Payments."),
    "thunes":            (5, "Global cross-border payments & remittance network — squarely his PYUSD off-ramp/FX/remittance work."),
    "n26":               (5, "Digital bank; Head of Product, Core Banking maps to his payments-platform depth (note: Berlin-based)."),
    "skeps":             (5, "Embedded point-of-sale lending/BNPL fintech — payments-adjacent core (note: India-based)."),
    "nymbus":            (5, "Banking-as-a-service / core & digital banking SaaS for financial institutions — direct fintech-platform fit; role is remote."),
    "maven clinic":      (4, "Care-navigation & family-health benefits sold to health plans/employers — payer/benefits-adjacent (his health edge) and remote."),
    "healthverity":      (4, "Real-world health-data platform sold to payers & pharma — health-data economics, payer-adjacent."),
    "onetrust":          (4, "AI Governance product line maps to his agent-identity / Know-Your-Agent (VCX) work; large private SaaS."),
    "mimica automation": (4, "AI process-mining / agentic automation — his AI-native/agent-runtime frontier."),
    "viz.ai":            (3, "Clinical AI care-coordination (some payer/reimbursement angle); CPO title + remote, but not payments."),
    "avant-garde health":(3, "Value-based-care cost analytics for providers — healthcare economics, transferable."),
    "workstream":        (3, "Hourly-workforce hiring + payroll SaaS (payments-adjacent); COO is an operating-leadership match."),
    "stord":             (3, "Commerce/fulfillment & logistics SaaS — echoes his eCommerce-platform background; remote."),
    "veho":              (3, "Last-mile delivery/logistics for eCommerce — commerce-platform adjacency."),
    "nuitee":            (3, "Travel-booking API with embedded payments — commerce/payments adjacency (Europe/Africa)."),
    "nuitée":            (3, "Travel-booking API with embedded payments — commerce/payments adjacency (Europe/Africa)."),
    "neurotrack":        (3, "Digital-health / cognitive-assessment — general healthtech, transferable."),
    "unlearn.ai":        (3, "AI-native clinical-trial platform — his AI frontier, biotech vertical (role posted 2025-05)."),
    "alteryx":           (3, "Analytics/automation platform — horizontal B2B SaaS, transferable PM leadership; remote."),
    "trifacta":          (3, "Data-wrangling analytics (Alteryx company) — horizontal B2B SaaS; remote."),
    "green places":      (2, "Carbon-accounting/ESG SaaS — horizontal SaaS, light finance flavor; remote."),
    "glossier":          (2, "Beauty DTC/eCommerce — consumer goods; some commerce overlap."),
    "flock safety":      (2, "Public-safety AI + hardware — vertical, limited overlap."),
    "tessian":           (2, "AI email/data security — security SaaS with agentic angle."),
    "pentera":           (2, "Automated security-validation — cybersecurity vertical (Israel)."),
    "lilac cloud":       (2, "Edge/CDN infrastructure — infra SaaS, limited domain overlap."),
    "formation bio":     (2, "AI-enabled pharma/biotech — vertical, limited overlap."),
    "alloy therapeutics":(1, "Antibody/biotech CPO — deep life-science, no overlap with his domain."),
    "ripple foods":      (1, "Food & beverage product innovation — no domain overlap."),
    "medeloop":          (2, "Clinical-research AI — healthtech (non-payer); CCO is commercial not product."),
    "mimica":            (4, "AI process automation / agentic — his AI-native frontier."),
    # --- Consider-sourced additions ---
    "mercury":           (5, "Digital banking for startups; Head of Product, Business Lending = money-movement/credit — dead-center his PayPal/Google-credit work; remote."),
    "revolut":           (5, "Neobank; Head of Product, Wealth & Trading — core fintech/money-movement; remote."),
    "brigit":            (5, "Consumer fintech (cash advance / financial health) — payments/credit core; remote."),
    "narmi":             (5, "Digital-banking platform for banks & credit unions — fintech infrastructure."),
    "nitra":             (5, "Fintech spend/credit card for healthcare providers — payments + his healthcare edge."),
    "upvest":            (5, "Investment/trading API (fintech infra) — money-movement platform (EU)."),
    "spoton":            (5, "SMB payments & POS (a Square/Block peer) — direct payments-product match."),
    "worldcoin":         (5, "Crypto/Web3 identity + wallet — his crypto/stablecoin domain (note: Device role is hardware-leaning)."),
    "fetcherr":          (4, "AI-native dynamic-pricing (Large Market Model) — his applied-AI frontier."),
    "sixfold":           (4, "Generative-AI underwriting for insurance — AI-native + insurtech (fintech-adjacent)."),
    "leona health":      (3, "AI clinical documentation — healthtech (his AI + healthcare adjacency)."),
    "roger":             (3, "Digital-health navigation SaaS — healthtech; remote."),
    "roebling":          (3, "AI application company — his AI frontier, vertical unclear."),
    "odyssey":           (3, "AI product company — his AI frontier, vertical unclear."),
    "deepl":             (3, "AI/ML translation platform — AI-native, but the role is growth-focused."),
    "archive resale":    (3, "Resale/recommerce platform — echoes his eCommerce-platform background; remote."),
    "sprinklr":          (2, "Social/CXM SaaS — horizontal, limited overlap (also public)."),
    "bluefish ai":       (2, "AI for marketing/advertising — adtech vertical."),
    "freenome":          (2, "Cancer-diagnostics / biotech — vertical, limited overlap."),
    "normalyze":         (2, "Data-security posture management — cybersecurity vertical."),
    "ionq":              (1, "Quantum-computing hardware — no domain overlap (also public)."),
    "endurosat":         (1, "Satellite hardware — no domain overlap."),
}

def norm(name):
    n = name.lower().split("|")[0].strip()
    n = re.sub(r"\s+", " ", n)
    return n

def score_for(name):
    n = norm(name)
    if n in SCORES:
        return SCORES[n]
    # loose contains match
    for k, v in SCORES.items():
        if k in n or n in k:
            return v
    return (2, "Domain not individually assessed — default vertical-SaaS score.")

def comp_str(r):
    lo, hi, cur = r.get("comp_min_cents"), r.get("comp_max_cents"), r.get("comp_currency") or "USD"
    if lo or hi:
        f = lambda c: f"{cur} {int(c)//100:,}" if c else "?"
        return f"{f(lo)}–{f(hi)}".replace("USD ", "$")
    return "n/a"

def datestr(ca):
    return datetime.date.fromtimestamp(ca).isoformat() if ca else "n/a"

rows_out = []
dropped_public = []
seen = set()
for r in d["rows"]:
    cname = norm(r["company"])
    if cname in DROP_PUBLIC:
        dropped_public.append((r["company"], r["title"], DROP_PUBLIC[cname]))
        continue
    key = (cname, r["title"].strip().lower())
    link_key = (r.get("url") or "").strip().lower()
    if key in seen or (link_key and link_key in seen):
        continue
    seen.add(key)
    if link_key:
        seen.add(link_key)
    score, note = score_for(r["company"])
    display_company = r["company"].split("|")[0].strip()
    rows_out.append({
        "fit_score": score,
        "funds": "; ".join(r["funds"]),
        "company": display_company,
        "role_title": r["title"].strip(),
        "seniority": r.get("seniority") or "",
        "remote_scope": r.get("work_mode") or "unspecified",
        "posted_date": datestr(r.get("created_at")),
        "comp_range": comp_str(r),
        "stage": r.get("stage") or "",
        "ownership": OWNERSHIP.get(cname, "private (VC-backed)"),
        "location": "; ".join((r.get("locations") or [])[:2]),
        "domain_note": note,
        "ats_link": r.get("url") or "",
    })

# sort: fit desc, then posted date desc
rows_out.sort(key=lambda x: (-x["fit_score"], x["posted_date"]), reverse=False)
rows_out.sort(key=lambda x: (x["fit_score"], x["posted_date"]), reverse=True)

# --- CSV -------------------------------------------------------------------
cols = ["fit_score","funds","company","role_title","seniority","years_req",
        "remote_scope","posted_date","comp_range","stage","ownership",
        "location","domain_note","ats_link"]
with open("product_exec_roles.csv","w",newline="") as f:
    w = csv.DictWriter(f, fieldnames=cols)
    w.writeheader()
    for r in rows_out:
        r = dict(r); r["years_req"] = "10+ (exec)"
        w.writerow({k: r.get(k,"") for k in cols})

# --- Markdown --------------------------------------------------------------
with open("product_exec_roles.md","w") as f:
    f.write("# Product & Executive Leadership Roles — VC-Portfolio Sweep\n\n")
    f.write(f"_Generated {datetime.date.today().isoformat()} for John Williams. "
            f"Scanned {len(d['funds_scanned'])} top VC portfolios (Getro + Consider boards)._\n\n")
    f.write(f"**Totals:** {len(rows_out)} open exec roles at "
            f"{len({r['company'] for r in rows_out})} private companies · "
            f"{len(dropped_public)} roles dropped as public-company · "
            f"{len(d['funds_scanned'])} funds scanned.\n\n")
    f.write("Fit: **5** payments/fintech/crypto/billing core · **4** AI-native/agentic or healthcare-payer · "
            "**3** horizontal SaaS/commerce/healthtech · **2** other vertical/consumer/security · **1** no overlap.\n\n")
    f.write("| Fit | Fund(s) | Company | Role | Remote | Posted | Comp | Stage | Domain note | Link |\n")
    f.write("|:--:|---|---|---|---|---|---|---|---|---|\n")
    for r in rows_out:
        link = f"[apply]({r['ats_link']})" if r['ats_link'] else ""
        f.write(f"| {r['fit_score']} | {r['funds']} | {r['company']} | {r['role_title']} | "
                f"{r['remote_scope']} | {r['posted_date']} | {r['comp_range']} | {r['stage']} | "
                f"{r['domain_note']} | {link} |\n")
    # remote, high-fit shortlist
    shortlist = [r for r in rows_out if r["remote_scope"] == "remote" and r["fit_score"] >= 3]
    if shortlist:
        f.write("\n## Remote + high-fit shortlist (fit ≥ 3, remote)\n\n")
        for r in shortlist:
            f.write(f"- **{r['company']} — {r['role_title']}** (fit {r['fit_score']}, "
                    f"{r['comp_range']}) — [apply]({r['ats_link']})\n")

    f.write("\n## Dropped as publicly traded / public-owned\n\n")
    for c,t,tk in sorted(set(dropped_public)):
        f.write(f"- **{c}** — {t} ({tk})\n")

    f.write("\n## Coverage & method\n\n")
    f.write(f"**Scanned {len(d['funds_scanned'])} VC portfolios** across two board platforms:\n\n")
    f.write("- **Getro** (15) via `POST api.getro.com/api/v2/collections/{id}/search/jobs`: "
            "General Catalyst, 8VC, Accel, Thrive, Insight, Menlo, Craft, Oak HC/FT, Venrock, "
            ".406, Khosla, Redpoint, Founders Fund, Radical, Flare. We pull the full "
            "`vice_president` seniority tier (Getro caps deep pagination at ~420, so the small VP "
            "bucket is exhaustively pageable) plus narrow phrase queries to catch `director`-tagged "
            "exec titles.\n")
    f.write("- **Consider** (10) via `POST {board_host}/api-boards/search-jobs` with a per-page "
            "`X-CSRF-Token` scraped from the board HTML: a16z, Sequoia, Lightspeed, Kleiner "
            "Perkins, Bessemer, Battery, GV, Felicis, IVP, NEA. We filter server-side to the "
            "`Product Management` job function and paginate the cursor, plus text queries for "
            "operating titles.\n\n")
    f.write("Titles are filtered to Head of Product / VP-SVP-EVP Product / CPO / CPTO / COO / CxO, "
            "excluding Director-and-below, product-marketing/design/ops, product-engineering/"
            "security, communications/assurance, and EA/chief-of-staff roles. Public companies "
            "(and those owned by a public parent) are dropped; a role surfaced by multiple funds/"
            "platforms is merged into one row (deduped by apply URL) with all backing funds listed.\n\n")
    f.write("**Still unresolved, with reason:**\n")
    f.write("- *Coatue* & *Greylock* — run Getro's newer Next.js build that resolves the numeric "
            "collection id server-side (not embedded in HTML, `_next/data`, JS chunks, or any "
            "hostname/slug lookup); the headless browser that could capture it is reset by this "
            "environment's proxy.\n")
    f.write("- *a16z crypto* — a Consider board whose interactive API is session-walled; only an "
            "~8-job server-rendered teaser is reachable, not the full portfolio.\n")
    f.write("- *Benchmark*, *Spark Capital*, *Conviction* — no public aggregator board found "
            "(listed only on third-party sites like LinkedIn/Built In/Wellfound).\n")
    f.write("Portfolio overlap is heavy, so many of these firms' companies still surface via the "
            f"{len(d['funds_scanned'])} funds above.\n\n")
    f.write("_Comp shown where the ATS exposed it; `n/a` otherwise. `posted_date` is the "
            "ATS-reported creation date._\n")

print(f"private roles: {len(rows_out)} | companies: {len({r['company'] for r in rows_out})} | "
      f"dropped public: {len(dropped_public)}")
print("wrote product_exec_roles.csv and product_exec_roles.md")
