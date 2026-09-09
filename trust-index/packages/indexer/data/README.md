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

`resolved-uris-bsc-2026-09-09.ndjson.gz` — the `resolvable` stage of the funnel above.
Every `http(s)` `agentURI` in the frame, fetched and read. **165,518 rows, 57MB raw /
7.6MB gzipped**, across 71 hosts.

One JSON object per line: `agent_id`, `owner`, `uri`, `host`, `fetch_error`,
`http_status`, `name`, `x402`, `machine[]`, `social[]`.

**Keyed by `agent_id`, one row per registration — not by URL.** 2,484 URLs are shared by
more than one agent, so deduping by `uri` drops those agents entirely; the row count here
equals the frame's `http(s)` count exactly, which is the check that it is lossless. Where
an agent appeared in several passes the row that READ a document wins over one recording a
failure, because a later retry often succeeded where an earlier pass hit our own 429s.

Produced by:

```sh
node scripts/resolve-agent-uris.mjs population-bsc-2026-09-09.ndjson \
  --out resolved.ndjson --cache .uri-cache --per-host 3
```

**~20 minutes.** Per-host concurrency is the whole design, not a tuning knob: one host
(`metadata.evoevo.ai`) carries 119,619 of the 163,034 distinct URLs, and a naive 64-way
fetcher is a denial of service aimed at a single operator who did nothing but register
agents. Responses are cached on disk by URL, so the run is resumable and a rerun costs
nothing. The cache itself (651MB, 163,034 responses) is NOT committed — this file is its
distillate.

## What was read, and what we failed to read

| | count | |
|---|---|---|
| registrations resolved | 165,518 | 100% |
| **documents read** | **141,441** | 85.5% |
| **our fetch failures** | **24,077** | 14.5% |

The failures are OURS and are recorded with a reason on every row, never as an agent that
declares nothing. They are not evidence about any subject and must not be counted as one:

| count | what happened |
|---|---|
| 15,379 | HTTP 429 — **we called too fast.** Our defect, retryable, see `GOTCHAS.md` |
| 7,208 | HTTP 200 with a non-JSON body (SPA catch-all serving `index.html`) |
| 1,256 | HTTP 404 |
| 209 | 502 / 503 / 526 / 530 — upstream 5xx, says nothing about the agent |
| 17 | transport failure / timeout |
| 8 | 400 / 401 / 403 — answered and declined us; a known state, not a dead endpoint |

The 15,379 rate-limited rows are the single largest recoverable gap in this dataset. They
came from a run at `--per-host 24`; 13,732 of them hit one host. Re-resolving just those
URLs at `--per-host 3` would lift documents-read above 95%.

## What the fetched documents declare

**34,434 of 141,441 read documents (24.3%) declare a machine interface:**

| count | service type |
|---|---|
| 30,515 | `a2a` |
| 3,956 | `mcp` |
| 10 | `x402` |
| 6 | `api` |
| 2 | `oasf` |

Only **54** carry `x402Support: true`, against 13,715 in the inline half — the two halves
of the population are not alike, and neither one's rates may be projected onto the other.

## Reading this with the inline half

The frame's `data:` URIs (158,868 documents, decoded with no network) and this file
(141,441 documents, one fetch each) together cover 300,309 of the 330,764 registrations
that declare an `agentURI`. Interface counts quoted for "the population" must add both and
say so; either half alone is a biased sample, and the tables above show why — inline
documents are 47× more likely to declare x402, fetched ones are dominated by two
platforms' bulk registrations.

A machine interface is not a distinct service. `scripts/battery-targets.mjs` reduces these
declarations to the endpoints actually worth dialling, excluding the specification's own
example URL (registered verbatim by 103 agents), source repositories, and unexpanded URL
templates, then groups by host so a shared backend is sampled rather than exhausted.
