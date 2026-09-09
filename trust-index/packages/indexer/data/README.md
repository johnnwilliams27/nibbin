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

## What is NOT here

The 165,517 `http(s)` URIs have not been fetched. Their services are unknown, and the MCP
and A2A counts above therefore describe **only the inline half** — they are not the
population's interface counts and must not be quoted as such. Resolving them is the next
stage (`resolvable` in the funnel), and it parallelises freely because the URIs point at
thousands of independent hosts rather than one metered API.
