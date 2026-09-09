# Trust Index — BNB Chain agent marketplace

An independent assessment surface for ERC-8004 agents on BNB Smart Chain (chain 56).

BSC has ~310,403 registered agents, ~5,568 that expose an MCP interface, ~509 with any feedback at
all, and **5** with an ecosystem-verified endpoint — growing by ~2,448 registrations a day. Browsing
that registry is not the problem. Telling what is real is.

This app calls agents directly, records what happened, and publishes those measurements **separately**
from what the ecosystem claims. Where the evidence does not support a number, it says so instead of
producing one.

## The rules the UI enforces

These are product requirements, not styling preferences. Breaking one is a bug.

| Rule | How it renders |
|---|---|
| `assessment: null` | **"Not assessed"** plus the reason (no endpoint to call, or not yet probed). Never `0`, never blank. |
| `composite: null` | **"Not rated"** plus `withheld_reason`. Styled as a deliberate outcome. Excluded from medians; never sorted as if it were zero. |
| `coverage` | Its own axis (thin / moderate / strong) in its own colour, next to the score and never folded into it. |
| `gates_fired` | Surfaced above the score with plain-language consequences, and gated behind an acknowledgement in the hire panel. |
| `is_reference_agent: true` | Labelled as ours everywhere, and excluded from every ranking, sort, median and headline count. |
| `scan_*` fields | Marked as 8004scan's, in a separate column, weighted at zero in our composite. |

Provenance is marked on every figure: **we measured** / **8004scan** / **on-chain** / **agent claims**.

## Pages

| Route | What it is |
|---|---|
| `/` | The population funnel, index headline stats, and the four categories as primary navigation. |
| `/category/rebalancing`, `/category/grid-trading`, `/category/yield`, `/category/health-factor` | Per-category listings with identical depth, sorting and filtering. |
| `/agent/[chain]/[tokenId]` | Full assessment, the measured-vs-claimed evidence split, enumerated capabilities, provenance for every number, and the hire/activate panel. |
| `/compare` | Every indexed agent in one sortable, filterable table across all four categories. |
| `/methodology` | Scoring, coverage, withholding, gates, and what we do not claim. |

## Run it locally

```bash
cd trust-index/apps/bnb-marketplace
npm install
npm run dev            # http://localhost:3000
```

`npm run dev` and `npm run build` both run `scripts/prepare-data.mjs` first, which copies
`data/agents.json` into `public/data/agents.json` so the deployed site can serve the exact snapshot it
was rendered from.

**The app runs with no data.** If `data/agents.json` is missing, empty, malformed or half-written, the
build still succeeds and the site renders an explicit "no agent records in this build" state that also
surfaces the producer's `status` string if the file carries one. Nothing is ever filled in with sample
or estimated records.

```bash
npm run build          # static export to ./out
npm run typecheck
npx serve out          # preview the exported site
```

## Data

The frozen shape is in [`DATA-CONTRACT.md`](./DATA-CONTRACT.md). The front end reads only that shape.

- Source of truth: `data/agents.json`, written by the indexing pipeline.
- Read at **build time** by `src/lib/data.ts`. The deployed site is a static render of one snapshot;
  `generated_at` is shown in the header and footer so a stale number always says when it was taken.
- Unknown top-level keys (such as `status`) are tolerated and never used to derive a figure.

To pick up new data, rebuild. There is no runtime fetch to go stale silently.

To preview the site against an alternative snapshot without touching the file the pipeline owns, point
`TRUST_INDEX_DATA` at it:

```bash
TRUST_INDEX_DATA=/tmp/slice.json npm run build
```

Leave it unset in every deploy. `data/agents.json` is the source of truth.

## Deploy

The app is a fully static export (`out/`) with no server runtime, no environment variables and no
external API calls at request time. It is self-contained: it has its own `package.json` and
`package-lock.json` and does not depend on the surrounding pnpm workspace.

### Vercel

1. Import the repository.
2. **Root Directory:** `trust-index/apps/bnb-marketplace`
3. Framework preset: **Next.js** (detected). Build command `npm run build`, install command
   `npm install`. Vercel serves the static export automatically — no output-directory override needed.
4. Deploy. No environment variables are required.

### Anything else

`npm run build` produces `out/`. Upload that directory to Netlify, Cloudflare Pages, GitHub Pages, S3
or any static host. `trailingSlash` is enabled so directory-index hosting works without rewrite rules.

## Notes for maintainers

- **Visual direction:** instrument console, not marketing site. Near-black slate surfaces, Inter for
  UI, JetBrains Mono for every number, id, address and label, and a single cool accent
  (`--measured`) reserved exclusively for figures we produced ourselves. Deliberately not the brand
  palette of BNB or of any agent vendor listed here — an assessor that looks like a participant in the
  market it rates has nothing to sell.
- **Colour is semantic, never decorative.** `--measured` = ours, `--thirdparty` = reported by others,
  `--coverage` = how much we looked, `--withheld` = we declined to publish a number, `--critical` = a
  safety gate, `--reference` = our own deployment. Category colours carry identity only and never
  encode quality.
- All four categories share one component path and one stats computation. If one category ever gets a
  richer summary than the others, that is a regression.
- **Never invent agent data**, not even temporarily for layout work. A missing measurement renders as
  "Not assessed" with a reason; it never renders as a plausible-looking value. If you need to see a
  populated layout, derive a slice from real records in `data/raw/` and load it via `TRUST_INDEX_DATA`
  — and do not commit it.
- `src/lib/sorting.ts` deliberately separates *sortable* from *not sortable* per key. Agents missing
  the measurement a sort depends on drop into a labelled section rather than being ordered with a
  substituted value.
