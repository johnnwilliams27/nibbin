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
python3 lib/getro_scan.py     # 15 Getro portfolios   -> data/getro_exec_roles.json
python3 lib/consider_scan.py  # 10 Consider portfolios -> data/consider_exec_roles.json
python3 lib/finalize.py       # merge both, filter public cos, dedupe, score, write CSV + MD
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
  Fund → network id map lives in `lib/getro_scan.py`.
- **Consider API:** `POST https://{board_host}/api-boards/search-jobs`. The board
  gates this behind a per-page CSRF token, so we first `GET /jobs`, scrape
  `"csrfToken"` + the board slug from the HTML, then POST with header
  `X-CSRF-Token` and body
  `{"meta":{"size":100,"sequence":<cursor>},"board":{"id":"<slug>","isParent":true},"query":{"jobFunctions":["Product Management"]}}`,
  paginating the `meta.sequence` cursor. Fund → board host map lives in
  `lib/consider_scan.py`.
- **Discovery** of board backends/ids: `lib/discover.sh`.

## Coverage
25 portfolios scanned: 15 Getro + 10 Consider (a16z, Sequoia, Lightspeed,
Kleiner Perkins, Bessemer, Battery, GV, Felicis, IVP, NEA). Still unresolved:
Coatue, Greylock, Benchmark, Index, Spark, Conviction, a16z crypto (newer Getro
builds without an embedded numeric collection id, or non-standard boards). See
the report's "Coverage & method" section for the full breakdown.

To re-target for a different role family, edit the title regex + phrase queries
in `lib/getro_scan.py` and the scoring rubric in `lib/finalize.py`.
