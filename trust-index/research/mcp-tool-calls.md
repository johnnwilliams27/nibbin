# Calling tools: the first mapping, and a guard that was weaker than claimed

Run `scripts/call-tools.mts --i-have-approval --per-shape 8`. 39 read-only
tools, one per server, selected from persisted transcripts. Arguments
synthesized from each tool's own schema, required fields only, nothing shaped
like a credential.

This is the first time the project exercised somebody else's software rather
than reading its manifest.

## What happened

| Outcome | Calls |
|---|---|
| Answered usefully | 24 of 39 (62%) |
| Tool reported its own error (`isError`) | 7 |
| Transport or protocol failure | 8 |

| Shape | Called | Answered | Median bytes | Median ms |
|---|---|---|---|---|
| unknown | 8 | **8** | 3,641 | 347 |
| retrieval | 8 | 6 | 4,288 | 347 |
| transform | 8 | 5 | 843 | 207 |
| public_data | 8 | 3 | 2,291 | 651 |
| generation | 5 | 2 | 2,473 | 157 |
| communication | 2 | 0 | — | — |

All 8 failures were authentication (6 HTTP 401, 1 JSON-RPC "Authentication
required") except one 15-second timeout.

## Four things only invocation could show

### 1. Authentication is per-method, not per-server

Every one of these servers listed its tools anonymously and then refused the
call. The census counted them as fully accessible, because at declaration-
reading time they were. **A server can be open for `tools/list` and closed for
`tools/call`,** which means the 48.7% "listed their tools" figure overstates
what is actually testable, and the true anonymous surface is smaller again.

### 2. Response size is a real and unmeasured cost

| Tool | Response |
|---|---|
| `query_findings` | **111,211 bytes** |
| `count_firms_by` | 39,632 |
| `search_merchants` | 30,824 |

A single call returning 111 KB consumes a large slice of the caller's context
window before the agent has done anything with it. Nothing in the manifest
hints at this, no registry records it, and for anyone building on these servers
it is a first-order quality property.

### 3. Declared output schemas are mostly honoured

10 of the 39 called tools declared an `outputSchema`. **8 honoured it.** The two
that did not (`sponsored_search`, `advisors_catalog_list_services`) returned no
`structuredContent` at all despite declaring a shape for it. That is a concrete,
checkable contract violation, and it is invisible without calling.

### 4. Tools that report their own failure are a distinct category

7 tools returned a successful transport response carrying `isError: true`. That
is correct protocol behaviour and a task-level failure at the same time. Folding
it into "broken" would make a well-behaved error indistinguishable from a server
that fell over; folding it into "fine" would hide it entirely. It is recorded
separately.

## The guard was weaker than I claimed

Two communication-shaped tools were selected and called: `get_broadcast_details`
and `check_email_security`. Both are ordinary reads, both answered normally, and
no side effect occurred.

That is luck, not design. Two distinct defects let them through:

**Shape was read from any word in the name.** "broadcast" and "email" appear in
the communication verb list, so a `get_*` and a `check_*` tool landed in the
communication bucket. Tool names are verb-then-noun: the verb says what happens
and the noun says to what. The leading verb now decides, with any-word matching
only as a fallback.

**Nothing stopped a side-effecting shape from being callable.** `readOnlyHint`
plus a non-mutating name was sufficient, and the shape was never consulted. A
genuine `notify_subscribers` carrying `readOnlyHint: true` would have been
invoked. Side-effecting shapes (communication, state mutation, code execution,
financial) can now never be read-only, and a `readOnlyHint` on one is recorded
as a contradiction: a tool that sends does not become safe by asserting it is a
read.

Both are fixed with tests naming the two tools that exposed them.

## What the shapes are worth, provisionally

`unknown` answered 8 of 8, the best rate of any shape. Tools our name
heuristics cannot classify are not unusually broken; they are just named in ways
a word list does not recognise. That is an argument for judging shape from the
schema and description rather than the name alone, and eventually from a model
reading the declaration.

`public_data` answered only 3 of 8, the worst rate, and it is the shape whose
battery would be the most valuable, since an independent reference can settle
correctness. Most of those failures were authentication.

## Still not measured

One call per tool establishes liveness, contract conformance, latency and cost.
It establishes nothing about correctness. The differential test (does the tool
read its input at all), the fabrication probe (does a query that cannot match
return nothing), metamorphic relations and injection resistance all need two or
more calls per tool, and none has been run.
