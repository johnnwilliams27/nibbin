# FP&A / Strategic Finance role scan — VC portfolios

Sweep of top-VC portfolio companies for **currently-open, remote (US), mid-senior
(~5–8 yrs) FP&A / Strategic Finance / Corporate Finance** roles at **private** companies,
scored 1–5 for fit to a candidate with a **health-insurance payer / PE-backed healthcare
services** FP&A background.

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
2. **Healthcare-priority funds** (Oak HC/FT, .406 Ventures) are on Getro, which blocks
   non-browser access. Fallback: enumerate companies from each fund's **public portfolio
   page**, then probe each company's **Greenhouse / Lever / Ashby** public JSON board
   directly (`data/hc_all.json` = 159 companies; 64 resolved to a live ATS).
3. Filter → dedupe (merge funds backing the same role) → score domain fit → emit CSV+MD.

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
