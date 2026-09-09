# What is actually in the BSC ERC-8004 registry

Measured 2026-09-09 against the full enumeration (`packages/indexer/data/population-bsc-2026-09-09.ndjson.gz`,
342,016 rows swept from chain logs).

**A note on what this can and cannot tell you.** Everything below is *shape* — what a
registration declares about itself. None of it is evidence that an agent works, and this
document must never be cited as if it were. A registration is a self-description written by
its owner, provenance `self_reported`, weight 0.15. Whether any of these agents actually
answer is the question the probe exists to settle, and it is not settled here.

---

## The funnel

| stage | count | of total |
|---|---|---|
| Registrations on BSC | **342,016** | 100% |
| Distinct owner addresses | 276,143 | — |
| Distinct `agentURI` strings | 193,149 | 56.5% |
| — registrations whose doc is byte-identical to another's | **139,905** | **40.9%** |
| Registration doc readable now (inline `data:`) | 158,868 | 46.5% |
| Registration doc behind an `http(s)` link (unread) | 165,517 | 48.4% |
| Empty or other scheme | 17,631 | 5.2% |
| **Of the 158,868 readable: declare any callable URL** | **1,990** | **1.25% of readable** |
| Distinct callable URLs among them | 2,299 | — |
| **Distinct protocol endpoints, placeholders removed** | **481** | — |

## The 40.9% that share a document

Three platforms account for most of the registry, and none of their documents declare an
endpoint of any kind:

| registrations | distinct owners | document |
|---|---|---|
| **119,038** | 116,756 | `Ave.ai Trading Agent` |
| 9,684 | 9,609 | `Debot Trading Agent` |
| 582 | 568 | `MevX Trading Agent` |

```json
{ "type": "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
  "name": "Ave.ai Trading Agent",
  "description": "AI-driven multi-chain trading agent with on-chain reputation.",
  "image": "https://www.iconaves.com/logo/pro.ave.ai.png",
  "active": true,
  "supportedTrust": ["reputation"] }
```

Note the owner spread: 119,038 registrations across 116,756 *different* addresses. This is not
one actor minting in bulk. It is a platform issuing an identical identity token to each of its
users — closer to an account badge than to a distinct agent. There is nothing improper about
it, but counting it as 119,038 agents is a category error, and any headline "agents on BSC"
figure that does so is wrong by about a third on this cluster alone.

Bulk same-block minting, by contrast, is negligible: 25 blocks carry ≥20 registrations,
totalling 1,146 (0.3%). The duplication is spread thin across many owners over time, which is
exactly why a per-owner concentration check misses it and a per-document check finds it.

## Owner concentration, separately

24,559 owners hold more than one agent, accounting for 90,432 registrations (26.4%). The
largest single owner holds **13,419**. So there are two distinct duplication mechanisms and
they need separate treatment: platform-issued identical docs across many owners, and
individual owners holding many registrations.

## What declares a callable interface

Of the 158,868 documents readable without a network request, **1,990 (1.25%) declare any URL
at all.** Deduplicated by protocol, with obvious placeholders removed:

| protocol | distinct endpoints | placeholder-free |
|---|---|---|
| A2A | 326 | **320** |
| MCP | 151 | **144** |
| x402 | 14 | 12 |
| OASF | 5 | 5 |
| api | 3 | 2 |
| **union** | | **481** |

695 registrations point at those 481 endpoints.

Declared service types overall (counting declarations, not endpoints): 1,613 `web`, 383
`chat`, 345 `A2A`, 300 `OASF`, 291 `MCP`, 229 `twitter`, 228 `telegram`, 102 `api`, 28 `x402`.
Most of what is declared is a website or a social link, not something callable.

13,715 documents set `x402Support: true` — but only 12 distinct x402 endpoints exist among
them, so the flag is overwhelmingly set without a corresponding endpoint.

### One detail worth keeping

`https://api.example-agent.ai/v1` appears **103 times**. That is the placeholder URL from the
specification's own example, registered verbatim by 103 separate agents. Any pipeline that
treats a declared endpoint as a real one will dial it 103 times and draw conclusions.

## So how many are real?

**Unknown, and deliberately so.** What can be said from shape alone:

- **342,016** registrations exist.
- **~200,000** are plausibly distinct *identities* once byte-identical platform documents are
  collapsed — though "distinct document" is a weak proxy for "distinct agent".
- **481** distinct endpoints are declared with a protocol we could speak, from the readable
  half of the population.
- **0** have been shown to work by this document. Shape is a claim, not evidence.

The gap between 342,016 and 481 is the single most useful fact we have measured about this
ecosystem, and it is a finding worth publishing on its own — provided every stage of it is
labelled as a declaration rather than a verdict.

## The caveat that bounds all of the above

**165,517 registrations (48.4%) point at an `http(s)` document we have not fetched.** Their
services are unknown. The 481 endpoints are a floor derived from 46.5% of the population, not
a total. Resolving those URIs is the next stage of the funnel; it needs no vendor quota,
because they point at thousands of independent hosts.

Do not quote 481, 320 or 144 as population-wide interface counts. They describe the inline
half. Saying otherwise would convert our unfetched half into a fact about the ecosystem, which
is rule 1.
