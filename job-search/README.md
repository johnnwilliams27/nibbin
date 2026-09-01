# VC-portfolio job sweep

Tooling that sweeps top VC portfolio job boards for a specific candidate and
produces a deduplicated, domain-fit-ranked shortlist.

Current target: **product & executive leadership roles** (Head of Product,
VP/SVP/EVP Product, CPO, CPTO, COO) for a senior product leader with a
payments / fintech / crypto / AI-agentic background (secondary healthcare edge).

## Outputs
- `product_exec_roles.csv` — full ranked table
- `product_exec_roles.md` — readable report + remote shortlist + coverage notes
- `data/getro_exec_roles.json` — raw scan output (pre-scoring)

## Run
```bash
python3 lib/getro_scan.py     # scan the 15 Getro-backed portfolios -> data/getro_exec_roles.json
python3 lib/finalize.py       # filter public cos, dedupe, score, write CSV + MD
```

## How it works
- **Transport:** `curl` through the environment's egress proxy. A headless
  browser is not viable here (the proxy resets Chromium's TLS), so we hit JSON
  APIs directly.
- **Getro API:** `POST https://api.getro.com/api/v2/collections/{network_id}/search/jobs`
  with headers `User-Agent` (browser), `Origin`, `Accept: application/json`,
  `Content-Type: application/json` and body
  `{"hitsPerPage":100,"page":P,"query":"","filters":{"seniority":["vice_president"]}}`.
  Deep pagination caps at ~420 rows, so we exhaust the small `vice_president`
  bucket and use narrow phrase queries for `director`-tagged exec titles.
- **Fund → network id map** lives in `lib/getro_scan.py`.
- **Discovery** of board backends/ids: `lib/discover.sh`.

## Coverage
15 Getro portfolios are scanned. Consider-backed boards (a16z, Sequoia,
Lightspeed, Kleiner Perkins, Bessemer, Battery, GV, Felicis, IVP, NEA) are
**not** covered — Consider gates its API behind a browser session + CSRF and the
headless browser is blocked in this environment. See the report's "Coverage &
method" section for the full breakdown.

To re-target for a different role family, edit the title regex + phrase queries
in `lib/getro_scan.py` and the scoring rubric in `lib/finalize.py`.
