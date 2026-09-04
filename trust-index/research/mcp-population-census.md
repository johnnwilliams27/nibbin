# What the MCP registry population changes about the rating design

Run `scripts/census.mts --phase list` in `packages/collectors`. Reads the
registry's public index only; no MCP server was contacted.

## The population

| | |
|---|---|
| Version rows | 90,258 |
| Distinct servers | 26,920 |
| Declaring a remote endpoint | 15,121 (56.2%) |
| Distinct endpoint hosts | 10,996 |
| Registry status active / deprecated | 15,045 / 76 |
| Declaring a repository | 9,272 (61.3%) |
| Declaring a publish date | 15,121 (100%) |

Transport is `streamable-http` for 14,548 and `sse` for 1,066.

The distinct-server figure agrees with the earlier ERC-8004-era census
(26,906), which is a useful consistency check on the paging.

## First, a parser defect that nearly became a finding

The first run reported **0 distinct servers from 40,000 rows**. The registry
nests each row as `{server: {...}, _meta: {...}}` and uses camelCase meta keys
(`publishedAt`, `isLatest`); the parser assumed a flat row with snake_case. It
returned null for every row, and the census printed the zero as though it were
a fact about the registry.

That is the ninth instance of this project's oldest error: reading "I could not
obtain the data" as "the data is not there". It is now guarded against
structurally. `listServers` records a failure when the parse rate is near zero,
and the census aborts rather than printing a population it did not actually
read.

## Four things this changes

### 1. Subject-level independence is a gap in the design

Two operators account for **16.1% of the remote population**: 1,314 servers on
`gateway.pipeworx.io` and 1,115 on `api.mcp.ai`.

They are genuinely distinct subjects. Each has its own endpoint URL, its own
description, and proxies a different upstream API. Rating them individually is
correct.

But they share infrastructure, and that has two consequences the current design
does not handle:

- **Their availability observations are correlated.** One gateway outage
  produces 1,314 simultaneous zeros. Treated as independent evidence about the
  population, that is badly wrong.
- **A per-server cohort prior hands two operators 16.1% of the weight**, so
  "typical MCP server" would substantially mean "typical pipeworx server". A
  per-host prior would give them 0.018%, which is the opposite distortion.

`independence_group` exists on **observers** and there is no equivalent on
**subjects**. The endpoint host is the natural group, and it should apply to
cohort prior computation only, never to an individual subject's score. A server
does not become worse because its neighbours share a gateway.

### 2. The maintenance dimension is currently non-discriminating

| Publish age | Servers | Share |
|---|---|---|
| 90 days or less | 11,200 | 74.1% |
| 91 to 365 days | 3,921 | 25.9% |
| 366 to 730 days | 0 | 0.0% |
| Over 730 days | 0 | 0.0% |

`maintenanceValue` ramps from 1.0 at 90 days to 0.0 at 730. Against this
population, 74% score exactly 1.0 and the remainder score between 0.79 and 1.0.
The dimension is very nearly a constant, and a constant carrying weight in a
composite is weight doing nothing.

The cause is that the registry is young: nothing in it is older than a year.
The 90 and 730 day thresholds were reasoned in the abstract and are wrong for
the population that exists.

Options, in preference order:

1. Recalibrate to the observed distribution, so the ramp spans where the data
   actually lies.
2. Replace publish recency with a signal that varies: commit recency from the
   declared repository (available for 61%), or version count over time.
3. Drop the dimension's weight to near zero until the registry ages.

Doing nothing means shipping a dimension that looks like evidence and is not.

### 3. The registry description threshold is set too low

14,559 of 15,121 (**96.3%**) have a description of 40 characters or more. The
`registry_description` check therefore emits 1.0 for almost everyone. Same
problem as maintenance: no variance, no information, and it is the only
self-reported observation in the rubric, so the self-reported cap it was built
to exercise is exercising nothing.

### 4. Two smaller items

- **146 servers sit on ephemeral developer tunnels** (`trycloudflare.com`,
  `ngrok`, and similar), across 25 hosts. Near-certainly dead. They will
  correctly read as unavailable, but they are worth flagging as a distinct
  category rather than being scored as ordinary failures.
- **76 servers are marked `deprecated`** by the registry. Rating a withdrawn
  entry is noise. `status` is now captured; it should exclude or flag.

## What did not change

- Availability, protocol conformance and tool safety remain the dimensions that
  carry real information, and none of them can be assessed without contacting
  the servers. The case for phase 2 is unchanged.
- 100% of remote servers declare a publish date, so nothing is unassessable on
  that account. The problem is variance, not coverage.
- 61.3% declare a repository, so repository-derived signals reach most but not
  all of the population, and the shortfall is a subject property rather than a
  harness gap.

## Still unknown, and only phase 2 answers it

Everything above is read from declarations. Nothing here says how many of the
15,121 endpoints actually answer, how many list tools, what those tools look
like, or how often a declaration contradicts itself. The classifier and most of
the rubric are untested against real tool declarations.
