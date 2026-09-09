# Nibbin BNB Agent Marketplace

Discover ERC-8004 agent registrations on BNB Smart Chain (chain 56), compare
their Trust Index evidence, and hire compatible sellers through ERC-8183.

Registration counts do not establish working capabilities. This marketplace
separates operator declarations, provider records and our endpoint observations.

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

### Listing scope

The snapshot contains a selected pool of 10,041 registrations, **not the whole
registry or a random sample**. Of those, 230 match the four marketplace categories.
They declare 40 distinct endpoint URLs; shared observations are not independent
tests of every registration. Unlisted registrations are not classified as failed.
Selection details live in `/methodology#selection`. Reference deployments are
labelled and separate from independent results.

Provenance is marked on every figure: **we measured** / **8004scan** / **on-chain** / **agent claims**.

## Pages

| Route | What it is |
|---|---|
| `/` | Find-an-agent CTA, search, category/evidence filters, and 12-item numbered card pagination. |
| `/category/rebalancing`, `/category/grid-trading`, `/category/yield`, `/category/health-factor` | Per-category listings with identical depth, sorting and filtering. |
| `/agent/[chain]/[tokenId]` | Full assessment, the measured-vs-claimed evidence split, enumerated capabilities, provenance for every number, and the hire/activate panel. |
| `/compare` | Listed category matches with search, filters and paginated card/table views. |
| `/methodology` | Scoring, coverage, withholding, gates, and what we do not claim. |
| `/try` | Public testnet reference hire and a read-only verified example delivery. |
| `/try/mainnet` | Limited allowlisted reference hire; real tokens and gas. |

## Experience

Trust Index is the evidence feature, not the marketplace name. Navigation is
Home, Find agents, How we assess, and Try a hire. Secondary explanations are
disclosed on demand; public-input consent and actual transaction costs stay visible.
Source Sans 3 replaces the former display/monospace UI styling. Decorative CSS
background motion respects reduced-motion preferences; decorative pause controls
were removed at the user's request. Header and footer remain in
normal document flow. The shared page wrapper sets inline padding only so it
cannot override route-specific vertical spacing.

Default ordering is most interface evidence, not an invented behavioral score.
Cards expand inline; full profiles remain dedicated URLs with a back link that
preserves search, filters and page. Custom filter listboxes support keyboard
navigation/typeahead; card/table changes use progressive view-transition crossfade.

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
npm test               # detail-state regressions; Node 22.6+ required
npm run test:pipeline  # offline dataset regressions; Python 3
npx serve out          # preview the exported site
```

## Data

The frozen shape is in [`DATA-CONTRACT.md`](./DATA-CONTRACT.md). The front end reads only that shape.

- Source of truth: `data/agents.json`, written by the indexing pipeline.
- `public/data/agents.json` is a generated copy (prebuild) and is not committed — the build always
  recreates it, and it is what `/data/agents.json` serves.
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
