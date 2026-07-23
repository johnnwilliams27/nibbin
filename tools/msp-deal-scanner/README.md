# MSP Deal Scanner

Evaluate MSP / IT-services businesses for sale — starting with Texas — against a valuation
model. It doesn't just pull listings; for each deal it classifies the business type, picks the
right basis (SDE vs EBITDA) and size tier, computes the implied multiple, compares it to the
market band (with an MRR premium where warranted), reads quality/risk signals from the listing
text, and produces a 0–100 screening score with a plain-English verdict. When a price is
withheld but earnings are shown, it back-solves the asking-price range those earnings would
support.

Zero dependencies. Node ≥ 18.

```
node tools/msp-deal-scanner/scan.mjs
```

Writes three self-contained files next to the script:

- `report.md` — ranked table + methodology (read this first)
- `report.csv` — same data, for a spreadsheet / your CRM
- `report.html` — open in a browser; scored, color-coded, mobile-friendly

## The three files you edit

| File | What it is |
|---|---|
| `listings.json` | The deals. Refresh this to run a new search (see below). |
| `benchmarks.json` | The valuation model — multiple bands by size/basis, the MRR premium, and the keyword signals. Edit as the market moves. |
| `scan.mjs` | The engine. Reads the two files above, writes the three reports. |

## Running a fresh search ad hoc

The tool scores whatever is in `listings.json` — it does not scrape live (marketplaces block
automated fetches and gate financials behind an NDA). To refresh the deal set:

1. **Pull current listings.** Search the sources you care about — BizBuySell (`/texas/it-and-software-service-businesses-for-sale/`), DealStream, broker sites (Synergy, CT Acquisitions), your own inbox / broker network. In this repo the pulls were done with the assistant's web tools; you can also paste from a marketplace export.
2. **Drop each deal into `listings.json`** using this shape (use `null` for anything undisclosed):

   ```json
   {
     "id": "unique-slug",
     "headline": "Established Managed IT Services Provider",
     "city": "Austin, TX",
     "askingPrice": 2500000,
     "grossRevenue": 3200000,
     "sde": null,
     "ebitda": 520000,
     "realEstate": { "included": true, "value": 800000, "note": "office building, owned" },
     "notes": "80% MRR, 12-year history, one owner full-time",
     "source": "https://…",
     "capturedOn": "2026-07-23",
     "verified": false
   }
   ```

3. **Re-run** `node tools/msp-deal-scanner/scan.mjs`.

Widen the search to another state by changing the listings and the `notes`/sources — the model
in `benchmarks.json` is national, not Texas-specific (the Texas notes are just where the
benchmarks were sourced).

## How a deal is scored

- **Basis**: EBITDA if disclosed, otherwise SDE (BizBuySell "Cash Flow" = SDE).
- **Band**: the size tier's multiple range from `benchmarks.json`, shifted up by the MRR premium when recurring-revenue language is present.
- **Position**: below / in / above the band drives most of the score; signals (recurring, tenure, government contracts vs. break/fix, offshore, hardware resale, franchise/startup, hype) adjust it.
- **Score is screening priority, not quality.** *Below the band is not automatically good* — for a healthy MSP it usually signals owner dependence, customer concentration, churn, or one-off earnings. The verdict says so on each row. Use the score to decide what earns a signed NDA and a real diligence pass.

## Data honesty

Everything captured from a public listing carries `"verified": false`. The figures are
first-pass extractions from listing summaries and **must be confirmed against the actual
listing / CIM before they inform a decision.** This is a screening aid, not investment advice,
and not a substitute for a quality-of-earnings review.
