# Why we indexed 10,041 and not 310,000 — measured, with a correction

Everything below was measured against live endpoints on 2026-09-09, not estimated.

---

## 0. A correction I have to make first

I have been describing the 496,976-agent census as an **enumeration** derived from
`Registered` logs, and used that wording in draft hackathon submission copy. **That is wrong,
and it is the exact class of overclaim this project exists to prevent.**

`packages/indexer/scripts/chain-census.mts` says what it actually does, in its own header:

> *"Counting agents without a full backfill: the Identity Registry is an ERC-721 whose ids come
> from a sequential counter in `register()`, and it exposes no `totalSupply`. But `ownerOf(id)`
> reverts for an id that was never minted, so an exponential probe followed by a binary search
> finds the highest minted id in roughly forty calls per chain."*

I re-ran it just now against BSC:

```
BSC highest minted agent id: 341,994
  38 eth_call requests, 1,938ms
```

Thirty-eight calls. Two seconds. It is a **count**, and a good one — but it yields **no
identities, no owners, and no agentURIs**. We know how many agents exist. We have never
enumerated who they are.

That distinction is the whole answer to the question. Do not put "enumerated" in the
submission. "Counted", or "established the population size independently", is what we did.

---

## 1. What actually gates coverage

An agent is assessable only if we know its **endpoint**. There are three ways to get one, and
they have very different costs.

### Route A — 8004scan detail view (what we used)

One request per agent, hard-capped at **1000/hour** (`x-ratelimit-limit: 1000`,
`retry-after: 3600`, both verified today).

Naively, 310,403 agents ÷ 1000/hr = **~310 hours ≈ 13 days**. That is the number I quoted, and
it is the wrong number, because **we do not need detail for all 310,403.**

The *list* view is 100 per page and carries the `has_mcp` / `has_a2a` / feedback flags. So:

| pass | requests | quota time | yields |
|---|---|---|---|
| list, whole BSC population | 310,403 ÷ 100 = **3,104** | **~3.1 h** | identity, name, description, owner, interface flags |
| detail, only agents declaring an interface | 5,568 mcp + 28,459 a2a ≈ **34,027** | **~34 h** | the endpoints |
| **total** | **~37,000** | **~1.5 days** | full endpoint coverage of every agent that declares one |

**~1.5 days, not 13.** The 276,000 agents that declare no interface at all never need a detail
call — they are unassessable by definition, and that is a fact we can establish from the list
pass alone rather than by fetching each one.

We already hold **8,590** of those ~34,027 details, so the remaining spend is ~25,400 requests
≈ 25 hours of quota. The fetch is idempotent and resumable.

### Route B — chain logs (the right answer, currently blocked)

`Registered` carries everything we need in the log itself. From `src/decode.ts:95`:

```ts
{ agentId: bigint; owner: string; agentURI: string }
```

No per-agent call. `scripts/build-population-frame.mts` already implements the chunked sweep
and documents why:

> *"ENUMERATION IS BY LOG, NOT BY CALL. Reading tokenURI(id) for half a million ids is half a
> million RPC calls; the Registered event carries agentId, owner and tokenUri in one log, so a
> chunked getLogs sweep gets the same data in a few thousand requests."*

Measured throughput on a public endpoint that would serve the request:

```
5,000 blocks -> 327 logs in 737ms
```

BSC deploy→head is ~76.8M blocks ÷ 5,000 = **15,368 requests**. At 737ms with 8–16 concurrent
that is **15–25 minutes** for the entire chain, with no vendor quota at all.

**The blocker, measured today:** free public BSC RPC will not serve historical logs.

| endpoint | historical `getLogs` |
|---|---|
| `bsc-rpc.publicnode.com` | `Archive requests require a personal token` |
| `bsc-dataseed.binance.org` | `limit exceeded` — **even at a 100-block window** |
| `bsc-dataseed1.defibit.io` | `limit exceeded` |
| `bsc-dataseed1.ninicoin.io` | `limit exceeded` |
| `1rpc.io/bnb` | `eth_getLogs is limited to 0 - 50 blocks` |
| `rpc.ankr.com/bsc` | requires auth |
| `bsc.drpc.org`, `llamarpc`, `nodies` | rate-limited or dead |

The `limit exceeded` at a 100-block window is what settles it: these are **pruned full nodes**,
not range-limited archive nodes. No amount of chunk-halving reaches old blocks.

**So Route B is blocked on one thing: an archive RPC key.** That is a $0–50/month commodity
(QuickNode, Alchemy, Ankr paid, or BNB's own archive service). It is the single highest-leverage
purchase available to this project, and it converts a 1.5-day vendor-metered crawl into a
20-minute sweep that depends on nobody.

After the sweep, resolving 341,994 `agentURI`s is 341,994 fetches — but spread across thousands
of independent hosts (IPFS gateways, GitHub, vendor domains), so it parallelises freely and is
bounded by our own concurrency, not anyone's quota. Hours, not days. Many will 404, which is
fine: that is the `resolvable` stage of the funnel, and a failure there is recorded as a stage,
not as an absence.

### Route C — the funnel that is already designed

`build-population-frame.mts` defines it, and it is the correct shape:

```
registered      highest minted id                     <- we have this (341,994)
-> enumerated   a Registered log we actually decoded  <- BLOCKED on archive RPC
-> has tokenURI the registration declares a place to look
-> resolvable   that URI returned a document
-> declares service  the document names an endpoint
-> probeable    that endpoint speaks a scheme we can speak
```

With its own note on why each stage is kept separate:

> *"A subject that falls out at any stage is recorded WITH THE STAGE, because 'we could not
> resolve its metadata' and 'it declares no service' are different facts about the world and
> collapsing them is how a denominator becomes a lie."*

The design is right. It was simply never wired into the marketplace pipeline, which went to
8004scan instead.

---

## 2. A defect, not a constraint

`apps/bnb-marketplace/scripts/fetch_candidates.py`, line 26:

```python
STREAMS = [
    ("mcp",               {"has_mcp": "true"},              None),
    ("feedback",          {"min_feedbacks": "1"},           None),
    ("endpoint_verified", {"is_endpoint_verified": "true"}, None),
    ("a2a",               {"has_a2a": "true"},              3000),   # <-- hardcoded cap
]
```

**28,459 BSC agents declare A2A. We took 3,000.** The candidate breakdown shows exactly `3000`
for that stream, which is what a cap looks like rather than a count.

This is not a rate limit and not a sampling decision. It is a hardcoded ceiling that silently
excluded ~25,459 agents, and it is recorded nowhere as a gap. Under rule 1 it must be either
removed or written down as an explicit `harness_capability_missing` with the number attached.
Removing it costs ~25,400 detail requests, which is the ~25 hours already accounted for above.

The 13 search terms are a separate matter and are honestly labelled in the source as *"recall
aids only — they do not relax categorisation."* They are fine. The cap is not.

---

## 3. So how fast can this actually go

| plan | wall time | needs | gets you |
|---|---|---|---|
| **Finish Route A** (remove cap, resume fetch) | **~25 h of quota**, unattended | nothing new | endpoints for every BSC agent declaring an interface (~34k) |
| **Route A list pass** as well | **+3 h** | nothing new | the honest denominator: which 276k declare nothing, established rather than assumed |
| **Route B** (chain sweep) | **~20 min** + hours of URI resolution | **one archive RPC key** | full independent enumeration of all 341,994, no vendor dependency |

You were right that this is faster than I said. The corrected picture:

- 13 days was wrong. It assumed detail for all 310k, when only the ~34k that declare an
  interface need it.
- The real Route A cost is **~1.5 days of unattended quota**, and we are already a quarter of
  the way through it.
- Route B is **20 minutes** and is blocked on a commodity purchase, not on engineering.

**Recommended order:**
1. Buy an archive RPC key. It is the cheapest thing on this list and it unblocks the route that
   removes the vendor dependency entirely — which is also what `DIRECTION.md` §11's Glama ruling
   requires (third-party metadata may enrich at 0.60; it may not be load-bearing).
2. Meanwhile, remove the 3,000 cap and let `fetch_details.py` run. It is idempotent and
   resumable; it costs nothing but wall time and closes the A2A hole.
3. Run the list pass so the "declares no interface" denominator is measured rather than
   inferred.
4. Then wire `build-population-frame.mts` into the marketplace pipeline and retire the
   8004scan candidate streams.

---

## 4. What to say, and not say

- **Say:** we established the population size independently, on-chain, without a third-party
  index — 341,994 on BSC today, ~497k across twelve chains.
- **Do not say:** enumerated, indexed, or crawled the full population. We counted it. The
  enumeration is the next step and it is blocked on an archive RPC key.
- **Say:** 10,041 indexed is what one vendor's hourly quota allowed in the time available.
- **Do not** present 10,041 as a designed sample. It is a triage under a rate limit, plus one
  hardcoded cap that should not have been there.
