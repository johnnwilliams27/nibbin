# BSC population frame — 2026-09-09

`population-bsc-2026-09-09.ndjson.gz` — every ERC-8004 `Registered` event on BSC,
enumerated from chain logs. 342,016 rows, 119MB raw / 15MB gzipped.
One JSON object per line: `chain`, `chain_id`, `agent_id`, `owner`, `token_uri`, `block`.

Produced by:

```sh
export ARCHIVE_RPC='<keyed archive endpoint>'
pnpm --filter @trust-index/indexer exec tsx scripts/build-population-frame.mts --chain bsc
```

**10.8 minutes, ~7,700 requests, no third-party index.** Check the endpoint first with
`scripts/check-archive-rpc.mjs` — 36 public BSC endpoints were tested and none serve
historical `eth_getLogs`, so a keyed archive provider is required.

## The funnel

| stage | count | of total |
|---|---|---|
| registered (highest minted id) | ~342,000 | — |
| **enumerated** (a log we decoded) | **342,016** | 100% |
| distinct owners | 276,143 | — |
| **declares an agentURI** | **330,764** | 96.7% |
| ├ `data:` — document inline, no fetch | 159,042 | 46.5% |
| ├ `http(s)` — needs one fetch | 165,517 | 48.4% |
| ├ `ipfs` | 1,023 | 0.3% |
| ├ other scheme | 5,182 | 1.5% |
| └ empty | 11,252 | 3.3% |
| inline documents decoded | 158,868 | 99.98% of `data:` |

## What the inline documents contain

Decoded from the 158,868 `data:` URIs — no network requests:

| count | field |
|---|---|
| 13,715 | `x402Support: true` |
| 1,622 | service type `web` |
| 408 | service type `MCP` / `mcp` |
| 345 | service type `A2A` |
| 301 | service type `OASF` |
| 235 | `email` |

**2,642 distinct endpoints across 158,868 documents.** That concentration is a finding in
its own right, and it is consistent with the duplicate structure seen elsewhere in this
project (2,711 identities on one endpoint; 105 on one owner). Treat 342,016 registrations
as ~2,642 distinct callable services until proven otherwise.

---

# Resolved registration documents — 2026-09-09

Two artifacts, both derived from one 20-minute crawl of the 165,518 `http(s)` `agentURI`s
in the frame above. They answer different questions and are kept apart on purpose.

| file | rows | gz | what it is for |
|---|---|---|---|
| `resolved-uris-bsc-2026-09-09.ndjson.gz` | 165,518 | 7.7MB | **what each agent declares** — the funnel |
| `registration-docs-bsc-2026-09-09.ndjson.gz` | 155,351 | 8.7MB | **the documents themselves** — descriptions, categories |

## resolved-uris — one row per registration

`agent_id`, `owner`, `uri`, `host`, `fetch_error`, `http_status`, `name`, `x402`,
`machine[]`, `social[]`.

**Keyed by `agent_id`, not by URL.** 2,484 URLs are shared by more than one agent, so
deduping by `uri` drops those agents entirely. The row count equalling the frame's
`http(s)` count exactly is the check that it is lossless.

**Built from the response CACHE, not from the crawl's ndjson output.** This matters and it
cost a wrong artifact to learn. Rows were appended per pass; the cache was refilled by
later retries (notably after a purge of cached 429s), and those retries' successes never
reached every output file. Assembled from the outputs, the first version of this file
recorded **24,077 fetch failures where the cache holds a readable document for 14,697 of
them** — nine per cent of the population reported as OUR gap when we had in fact read it.
Rule 1 cuts both ways: over-reporting our own failure is the safe direction, but it is
still a wrong number and it understates what the index covers. Rebuild from the cache.

## registration-docs — one row per distinct URL

`{ uri, doc }`, where `doc` is the registration document verbatim as served.

The funnel artifact keeps only what the funnel needed and throws the document away.
Descriptions, images, attributes, external URLs — everything categorisation runs on —
live nowhere else once the 651MB response cache is gone. This is that cache reduced to its
successes: **155,351 distinct URLs**, the 7,683 that returned no readable document omitted
rather than emitted empty.

Keyed by URL rather than by agent because a document is a property of the URL; join it back
to agents through `resolved-uris`.`uri`. The cache stores no URL of its own (entries are
named `sha256(url)`), so the mapping is rebuilt by re-hashing each URI from the funnel
artifact — an entry that cannot be attributed to a URI is skipped and counted, never
emitted under a guess.

Produced by:

```sh
node scripts/resolve-agent-uris.mjs population-bsc-2026-09-09.ndjson \
  --out resolved.ndjson --cache .uri-cache --per-host 3
```

**~20 minutes.** Per-host concurrency is the whole design, not a tuning knob: one host
(`metadata.evoevo.ai`) carries 119,619 of the 163,034 distinct URLs, and a naive 64-way
fetcher is a denial of service aimed at a single operator who did nothing but register
agents. Responses are cached on disk by URL, so the run is resumable and a rerun costs
nothing. The 651MB cache is not committed; these two files are its distillate.

## What was read, and what we failed to read

| | count | |
|---|---|---|
| registrations resolved | 165,518 | 100% |
| **documents read** | **156,138** | 94.3% |
| **our fetch failures** | **9,380** | 5.7% |

The failures are OURS and carry their reason on every row, never recorded as an agent that
declares nothing. They are not evidence about any subject:

| count | what happened |
|---|---|
| 7,208 | HTTP 200 with a non-JSON body (an SPA catch-all serving `index.html`) |
| 1,256 | HTTP 404 |
| 668 | HTTP 429 — we called too fast. Our defect, retryable, see `GOTCHAS.md` |
| 223 | 502 / 503 / 526 / 530 — upstream 5xx, says nothing about the agent |
| 17 | transport failure or timeout |
| 8 | 400 / 401 / 403 — answered and declined us; a known state, not a dead endpoint |

The 7,208 non-JSON 200s are the largest remaining gap and they are not all ours: a site
that serves its own homepage at its registered `agentURI` has published something that is
not a registration document, which is a finding about the registration. Distinguishing the
two requires reading the bodies, which are in the cache and not here.

## What the fetched documents declare

**35,399 of 156,138 read documents (22.7%) declare a machine interface:**

| count | service type |
|---|---|
| 30,515 | `a2a` |
| 4,921 | `mcp` |
| 10 | `x402` |
| 6 | `api` |
| 2 | `oasf` |

Only **54** carry `x402Support: true`, against 13,715 in the inline half — the two halves
of the population are not alike, and neither one's rates may be projected onto the other.

## Reading this with the inline half

The frame's `data:` URIs (158,868 documents, decoded with no network) and these files
(156,138 documents, one fetch each) together cover 315,006 of the 330,764 registrations
that declare an `agentURI`. Interface counts quoted for "the population" must add both and
say so; either half alone is a biased sample, and the tables above show why — inline
documents are 47× more likely to declare x402, fetched ones are dominated by two
platforms' bulk registrations.

A machine interface is not a distinct service. `scripts/battery-targets.mjs` reduces these
declarations to the endpoints actually worth dialling, excluding the specification's own
example URL (registered verbatim by 103 agents), source repositories, and unexpanded URL
templates, then groups by host so a shared backend is sampled rather than exhausted.
