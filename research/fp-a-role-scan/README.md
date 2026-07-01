# FP&A / Strategic Finance role scan — VC portfolios

Sweep of top-VC portfolio companies for **currently-open FP&A / Strategic Finance /
Corporate Finance / Financial-Analyst** roles with a **minimum requirement under 8 years**,
that are either **Remote (US-eligible)** OR in the **Dallas–Fort Worth metro** (Dallas/
Fort Worth/Plano/Irving + suburbs; in-office or hybrid OK). **Public and private**
companies both in scope. Roles are scored 1–5 for fit to a candidate with a
**health-insurance payer / PE-backed healthcare services** FP&A background.
Director/VP/Head/CFO-level titles are excluded.

## Deliverables
- **`fp_a_remote_roles.csv`** — machine-readable results.
- **`fp_a_remote_roles.md`** — readable summary + totals + coverage/method notes.

## How it works (browserless)
1. **Consider-backed boards** (a16z, Sequoia, Lightspeed, Greylock, Bessemer, Kleiner
   Perkins, Battery, GV, Felicis) expose a same-origin JSON API:
   `POST /api-boards/search-jobs` with
   `{board:{id,isParent:true}, query:{jobFunctions:["Finance"]}, meta:{size:600}}`.
   One call per board returns every portfolio finance posting pre-structured (title,
   company, remote/hybrid, salary, seniority, `minYearsExp`/`maxYearsExp`, posted date,
   ATS apply URL). Raw dumps land in `scratch raw/<fund>.json` (regenerable; not committed
   due to size).
2. **Getro-backed & non-Consider funds** (Oak HC/FT, .406, Venrock, General Catalyst,
   Accel, Khosla, 8VC, Menlo, Craft, Founders Fund, Index, IVP, NEA) block non-browser
   access to their job boards. Fallback: enumerate companies from each fund's **public
   portfolio page** (`data/hc_all.json`, `data/pc_companies.json`), then probe each
   company's **Greenhouse / Lever / Ashby** public JSON board directly and parse the JD
   for remote policy + years (`scripts/pc_probe.py` → `scripts/extract_v2.py`).
   ~628 companies enumerated, ~327 resolved to a live ATS.
3. `extract_v2.py` classifies each role's remote status **confident** (location/JD
   explicitly confirms remote-US) vs **verify** (ATS flags remote but lists an office HQ
   and the JD doesn't confirm — e.g. Ramp/OpenAI are actually hybrid). Only *confident*
   roles enter the main list; *verify* roles go to a separate appendix in the MD.
4. Filter → dedupe (merge funds backing the same role) → drop public companies →
   score domain fit → emit CSV+MD.

## Re-run
```bash
# (1) refresh Consider boards into ./raw/<fund>.json  — see scripts header for the curl call
# (2) healthcare ATS probe + extract:
python3 scripts/probe2.py        # writes hc_all_scan.json
python3 scripts/extract_ats.py   # writes hc_roles.json
# (3) assemble outputs:
python3 scripts/finalize.py      # writes fp_a_remote_roles.csv / .md
```

## Fit scale
`5` payer/PBM/claims/health-insurance core · `4` healthcare/health-tech (non-payer) ·
`3` fintech/payments/insurtech · `2` other vertical/horizontal SaaS · `1` no overlap.

## Known coverage gaps (see the MD "Coverage & method" section)
Getro-backed boards (General Catalyst, Accel, Insight, 8VC, Khosla, Craft, Thrive, Coatue,
Menlo, plus healthcare Venrock & Flare) block non-browser access and couldn't be JS-rendered
in this environment (egress proxy drops headless-Chrome TLS). They overlap heavily with the
Consider funds already swept, so net-new roles are limited but nonzero — extend via the same
portfolio→ATS fallback when browser access is available.
