# 600 servers: what the fixes bought, and one finding that did not survive audit

Run `scripts/census.mts --phase classify --i-have-approval --limit 600 --per-host 3`.
Handshake and `tools/list` only. No tool was called. Transcripts persisted.

## The population actually answers

| Outcome | Servers | Share |
|---|---|---|
| Sampled | 600 | |
| **Answered** | **559** | **93.2%** |
| ...of which required authentication | 259 | 43.2% |
| Completed a handshake | 297 | 49.5% |
| Listed their tools | 292 | 48.7% |
| Never answered | 41 | 6.8% |

583 distinct hosts sampled, 253 of them requiring authentication.

The 200-server run reported 41.5% usable and read as a mostly-dead population.
That framing was wrong, and it was wrong because of our bug: HTTP 401 was
counted as unreachable. **Only 6.8% of servers never answered at all.** The
population is alive; most of it is simply behind a login.

## What the fixes bought, measured

| Fix | Before | After |
|---|---|---|
| Auth in the provisioning queue | invisible | `mcp_account` at 259 servers, 7x the next entry |
| Classifier inference | 931 read-only tools | 1,397 (931 declared + **466 inferred**), +50% callable surface |
| Availability framing | 41.5% "usable" | 93.2% answering, 43.2% needing an account |

| Target binding | Tools | Share |
|---|---|---|
| operator_bound | 1,533 | 49.4% |
| read_only (declared) | 931 | 30.0% |
| read_only (inferred) | 466 | 15.0% |
| substitutable | 173 | 5.6% |

## The sandbox investment is worth less than I claimed

I argued the substitutable class would be large, because a tool is usually
dangerous precisely because it acts on a target and a target is a parameter.
**It is 5.6% of tools.** The provisioning queue makes the consequence plain:

| Capability | Servers unlocked |
|---|---|
| `mcp_account` | 259 |
| `reference_data` | 37 |
| `exec_sandbox` | 19 |
| `object_store_sandbox` | 11 |
| `testnet_wallet` | 9 |
| `mailbox` | 9 |
| everything else | 8 or fewer |

Two things follow, and neither matches the plan I proposed:

- **`reference_data` is the best sandbox investment by ratio.** One
  provisioning job, 37 servers, and it is the only capability that buys
  ground-truth correctness rather than side-effect observation.
- **`mcp_account` dominates by volume but is 253 separate signups**, not one
  account. It needs its own strategy, not a line in the same queue.

The mailbox, wallet and repo sandboxes we discussed at length are worth 9, 9
and 3 servers respectively in this sample.

## A finding that did not survive its own audit

The 200-server run reported "declares readOnlyHint but its description
describes a change" as the most common contradiction, and I flagged it as
possibly false-positive-heavy. Persisting transcripts made that checkable
without touching anyone's server again. It was checkable, and the rule fails.

138 tools matched. Reading them:

| Tool | Matched on | Actual description |
|---|---|---|
| `search_concepts` | `writ` | "...the vocabulary of the stack, **written** for practitioners" |
| `get_concept` | `writ` | "**Written** by a named human editor" |
| `list_freelance_platforms` | `creat` | "the subset of the directory where a consultant can **create a profile**" |
| `get_price` | `creat` | live crypto price lookup |
| `list_esim_plans` | `creat` | lists data plans |
| `get_order_status` | `creat` | polls order state |

The rule was asking a question about grammar: is this change verb the TOOL'S
action, in the active voice, describing what the tool itself does. A word list
cannot answer that, and tightening it will not make it able to.

**It is deleted rather than tightened.** A false positive here is not a missed
opportunity; it is a published accusation that a named operator's tool lies
about being read-only. The bar for that is higher than a regex can reach, and
this class of judgement needs a model reading the persisted transcript, with
its verdict recorded as an ordinary observation subject to the same caps as any
other evidence.

The same pattern is **kept** as a guard on whether we will call a tool, and
only there. The two uses fail in opposite directions: a false positive in a
published finding costs an operator their reputation, while a false positive in
our own caution costs us coverage. Over-caution about what we send is the right
bias.

### What the contradiction rate actually is

Removing the failed rule leaves the structural checks, which read names,
annotations and schemas rather than prose:

| Contradiction | Tools |
|---|---|
| mutating tool has no required parameters, so an empty call is valid | 52 |
| declares `readOnlyHint` but is named like a mutation | 12 |
| declares `destructiveHint` but is named and described like a read | 1 |

**65 of 3,103 tools, or 2.1%**, down from a claimed 6.1%. Smaller, and
trustworthy.

## Other measurements

| | |
|---|---|
| Tools declared | 3,103 |
| Carry any annotations | 1,483 (47.8%) |
| Declare `readOnlyHint: true` | 1,064 |
| Declare `destructiveHint: true` | 161 |
| Declare an `outputSchema` | 642 (20.7%) |
| Tools per server | p25 2, p50 4, p75 9, p90 21, **max 302** |

A server declaring 302 tools against a population median of 4 is a
context-window problem before it is anything else, and confirms the tool-count
check is worth having.

## Still unmeasured

No tool has been called. Functional correctness, injection resistance,
undeclared side effects and response cost remain entirely unknown. The 292
servers that listed tools anonymously, holding 1,397 read-only tools, are the
population those tests could run against today with no credentials at all.
