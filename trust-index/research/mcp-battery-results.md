# The correctness battery: what it found, and what it got wrong about itself

Run `scripts/assess.mts --i-have-approval --per-shape 12`. Five to six calls
per tool, read-only tools only, selected from persisted transcripts.

## Results, after two rounds of correcting the battery itself

| Check | Ran | Passed | Pass rate |
|---|---|---|---|
| `invocation_succeeds` | 49 | 30 | 61% |
| `rejects_invalid_input` | 14 | 9 | **64%** |
| `reports_errors_via_protocol` | 38 | 33 | **87%** |
| `honours_output_schema` | 11 | 10 | 91% |
| `response_cost` | 38 | 29 | 76% |
| `ignores_embedded_instruction` | 14 | 14 | 100% |
| `no_internal_leakage` | 14 | 14 | 100% |
| `input_sensitivity` | 2 | 2 | — |
| `no_fabrication` | 2 | 1 | — |

## What holds up

**Five tools in fourteen accept schema-invalid input.** One string-coerced an
object and answered about `"[object object].hood"`. Another simply returned
results. A tool that silently accepts garbage is worse to build on than one
that rejects it, because the caller never learns they were wrong.

**Five tools in thirty-eight report failure in the payload while the envelope
says success.** `{"found": false, "error": "..."}` arriving with no `isError`
set. A conformance defect, visible only by calling, and it poisons anything
that treats the output as an answer.

**No tool obeyed an injected instruction**, in fourteen attempts. Worth
tempering: most of these are thin API wrappers with no model behind them, so
there was little to inject into. The check is sound; the population is not yet
the population that would fail it.

**Response cost is real.** Nine of thirty-eight responses exceeded the smallest
band, and a single call in an earlier run returned 111 KB.

## What the battery got wrong about itself, twice

### Round one: comparing errors and calling it input-blindness

The first run reported **six tools ignoring their input**. An audit of the
stored calls found **not one of them was**:

| Tool | What actually happened |
|---|---|
| `search_docs` | returned `[]` to both queries, correctly |
| `search_products` | "No match — try a broader query" to both, correctly |
| `check_availability` | the same `upstream_error` to both |
| `explain_financial_concept` | the same database error to both |
| `add_trade` | the same "Field required" to both |
| `generate_visual` | differed only past the 300 characters being compared |

Two causes. Comparison was done on a truncated sample rather than the whole
response. And nothing checked that the two responses being compared were
answers at all: two identical errors say nothing about whether a tool reads its
input.

Fixed by gating every comparison on both calls returning a substantive,
successful answer, and by comparing a fingerprint of the full response.

### Round two: calling every refusal a fabrication

With comparison fixed, the battery reported **seven of eight tools fabricating
results for a nonsense query**. An audit found at most one was real:

| Tool | Response to the nonsense query | Verdict |
|---|---|---|
| `search_catalog` | `"status": "declined", "reason": "negative_cache"` | correct refusal |
| `advisors_store_readiness_check` | `"ok": false, "status": "target_rejected"` | correct refusal |
| `audit_result_claim` | `"result_type": "unknown", "accepted_evidence": []` | honest unknown |
| `validate_seed` | "Not a valid Calaf seed, nothing would import" | correct rejection |
| `goji_search` | "Nothing published on X. Try a broader term." | honest empty result |
| `check_availability` | `"name": "qx7v9....hood", "available": true` | **correct answer** |
| `agentra_check_reputation` | `"demo": true, "note": "This is demo data"` | self-labelled demo |

Three causes, and the third is the interesting one.

Servers decline in JSON as readily as in prose, and the refusal list did not
recognise `{"status":"declined"}`, `{"ok":false}` or `{"result_type":"unknown"}`.
Prose refusals like "Nothing published on X" were long enough to look like
content.

And **the premise was wrong for most shapes.** A nonsense string is a perfectly
valid domain name, so a domain-availability checker answering that it is
available is correct, not inventing. A validator correctly reports that nonsense
is invalid. A converter correctly refuses a non-URL. The fabrication probe only
means anything for retrieval over a fixed corpus, where a query either matches
or does not, and it is now restricted to that shape.

After the restriction the check ran twice, not eight times.

## The finding that matters most

**The comparison checks now skip far more often than they run.** 47 skips for
`input_sensitivity`, 47 for `no_fabrication`, against two runs each.

The reason is not the gate. It is that our synthesized arguments rarely produce
a substantive baseline. Calling a specialist tool with `query: "weather"`
usually returns nothing, correctly, and there is then nothing to compare.

Getting substantive baselines means generating arguments a given tool would
actually answer, which means reading its description and understanding what it
is for.

## Three checks, one wall

The `readOnlyHint` contradiction rule, the fabrication probe, and refusal
detection have all now failed in the same way: each asks a question about
MEANING, and each was implemented as a word list.

- Does this description describe the tool's own action?
- Is this response an answer, a refusal, or an invention?
- What arguments would this tool actually answer?

No list of phrases answers any of them. The instrument is a model reading the
stored transcript, its verdict recorded as an ordinary observation, subject to
the same provenance caps as any other evidence, and auditable because the
transcript is kept.

The structural checks, which read names, annotations, schemas and protocol
envelopes rather than prose, have held up throughout. That is the line: judge
structure with code, judge meaning with a judge.
