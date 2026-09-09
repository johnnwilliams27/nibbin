# What 200 real MCP servers say about the design

Run `scripts/census.mts --phase classify --i-have-approval --limit 200 --per-host 5`.
Handshake and `tools/list` only. No tool was called.

Sample: 200 servers, capped at 5 per endpoint host so the classifier met
variety rather than one gateway's template 32 times.

## What came back

| | |
|---|---|
| Listed their tools | 83 (41.5%) |
| Tools declared | 937 |
| Declaration contradictions found | 34 |
| Tools per server | p25 3, p50 6, p75 11, p90 20, **max 152** |

| Failure before we saw any tools | Servers |
|---|---|
| **HTTP 401** | **96** |
| fetch failed | 7 |
| HTTP 503 | 4 |
| tools/list HTTP 401 | 3 |
| HTTP 404 | 2 |
| HTTP 400 | 2 |
| timeout, 403, unparseable URL | 3 |

| Annotation and schema adoption | Tools |
|---|---|
| Carry any annotations | 437 of 937 (46.6%) |
| Declare `readOnlyHint: true` | 286 |
| Declare `destructiveHint: true` | 87 |
| Declare an `outputSchema` | 163 (17.4%) |

| Tool shape | Tools | | Target binding | Tools |
|---|---|---|---|---|
| retrieval | 401 | | operator_bound | 622 |
| unknown | 265 | | read_only | 265 |
| state_mutation | 129 | | substitutable | 50 |
| public_data | 88 | | | |
| communication | 17 | | | |
| generation | 14 | | | |
| financial | 9 | | | |
| code_execution | 8 | | | |
| transform | 6 | | | |

| Declaration contradiction | Tools |
|---|---|
| declares `readOnlyHint` but its description describes a change | 21 |
| mutating tool has no required parameters, so an empty call is valid | 12 |
| declares `destructiveHint` but is named and described like a read | 1 |

## Three errors in our own design, exposed by the run

### 1. HTTP 401 is being recorded as unavailability. It is a harness gap.

**48% of the sample returned HTTP 401.** Those servers are up, working, and
correctly refusing an anonymous client. The rubric currently records a failed
handshake as `availability: 0`, so half the population would be rated as down
when in fact we simply have no account.

This is precisely the failure the AssessmentGap model was built to prevent, and
the collector walks straight into it because the gap model was wired into the
scoring engine and never into the probe. An unauthenticated 401 must produce
`harness_capability_missing`, not an availability observation.

It also means the real testable population before credentials is about 41%, not
the 56% that declare a remote endpoint.

### 2. The provisioning queue cannot see the biggest gap

The queue ranks capabilities by servers unlocked and reports `object_store_sandbox`
at 6, `exec_sandbox` at 6, `testnet_wallet` at 5. Those numbers are real but
they are the wrong headline, because **a server behind a 401 never reaches
classification at all**, so the 96 servers needing authentication contribute
nothing to the report that exists to rank what to provision.

The largest provisioning need by an order of magnitude is invisible in the
provisioning report. Failures have to be attributed to a capability at the
point of failure, not only after a successful handshake.

### 3. The classifier is too conservative to be useful

`read_only` requires an affirmative `readOnlyHint` with nothing contradicting
it. But **53% of tools carry no annotations at all**, so no amount of
name and description evidence can ever classify them read-only, and they fall
through to `operator_bound`.

Result: 622 of 937 tools are operator-bound and 50 are substitutable, when 401
tools are retrieval-shaped. A tool named `search_documents(query)` with a
read-shaped description and no mutating signal anywhere is being treated as
untouchable because it lacks an annotation the protocol added recently.

The rule was written to avoid trusting a single unverified hint. Requiring that
hint as the *only* path to read-only is a different thing and it makes the
product not work. Multi-signal agreement across name, description and schema is
the same standard of evidence, and it is what the classifier already applies
everywhere else.

## A principle we wrote down and then broke

`transcript.ts` says a stored transcript can be re-judged under a new rubric
without re-probing anyone's server. **The census did not save the transcripts.**
So the 34 contradictions above cannot be re-examined for false positives, and
checking them means contacting those servers again.

The `readOnlyHint` contradiction is the one most in need of that check: the
description regex matches `creat`, so "creates a report" may be counted as a
mutation when it is not. Until the transcripts are persisted, the 21 figure
should be treated as an upper bound.

## What held up

- **Contradiction detection finds real things at a meaningful rate.** 34 in 937
  tools, of which the 21 `readOnlyHint` conflicts are exactly the class of
  finding that justifies the product, subject to the false-positive check above.
- **Annotation adoption is better than expected**: 47% carry annotations, 286
  declare read-only, 87 declare destructive. The gate design that reads them is
  sound.
- **`outputSchema` at 17.4%** means contract conformance is checkable for a
  real minority of tools today.
- **Tool count sanity is warranted.** One server declares 152 tools, and p90 is
  20. A 152-tool server is a context-window problem before it is anything else.

## What is still unknown

Nothing here calls a tool, so functional correctness, injection resistance,
undeclared side effects and response cost remain entirely unmeasured. The 41%
of servers that answer anonymously is the population those tests could run
against today.
