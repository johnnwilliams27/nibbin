# Re-earning the judge headline, and what the misses turned out to be

**2026-09-06. Model `claude-sonnet-5`, corpus v1, 120 labelled items.**

    coverage-adjusted accuracy   0.858   [0.785, 0.910]
    correct                      103
    wrong                         17
    abstained                      0
    harness-blocked                0

The previous headline was **0.892 [0.836, 0.948]**. That number was measured on
whole responses while the production call site was passing the judge a
300-character slice with no truncation marker — the configuration separately
measured at 45% error against 13% on whole ones. The headline described a system
we were not running. The call site was fixed, `truncated` became a required
field in the untrusted block, and this run re-measures the judge as it now runs.

**The drop is not statistically meaningful.** 0.892 sits inside this run's
interval and 0.858 sits inside the previous one. At n=120 these two runs are not
distinguishable, and anyone reporting "the judge got worse" from this pair is
reading noise. What is worth reporting is 0.858, because it is the number
measured on the configuration we actually ship.

Zero abstentions and zero harness-blocked items, so the denominator is the whole
corpus and nothing was quietly excluded.

## By label

    answer     33/47      ← every systematic problem is here
    error      35/36
    refusal    35/37

## The 17 misses are not 17 independent mistakes

They are two clusters and one genuine defect.

### Cluster 1 — seven `answer` → `refusal`, on a boundary the rubric defines twice, differently

The rubric in `src/judge/index.ts` says both of these:

    line 286   answer  - ... A negative or empty-handed finding still counts: a
                         validator reporting a document is invalid, or an
                         availability check saying 'not registered', has
                         answered the question it was asked.

    line 291   refusal - ... an empty result set; an explicit 'no match' or
                         'nothing found'; or a request for input it needs and
                         was not given.

A search that runs and returns `no_match` satisfies both readings. So does an
empty result set from a price lookup. **This is not the judge being wrong and
not the labeller being wrong — it is the rubric contradicting itself**, and it
accounts for seven of seventeen errors, 41% of all measured error, on its own.

Three of the seven are not ambiguous even so, and on these the judge is right
and the label is wrong. Line 292 is explicit that "a request for input it needs
and was not given" is a refusal, and three items are exactly that: three
`audit_result_claim` responses returning `insufficient_evidence` and asking for
a missing `metric_hint`, labelled `answer`.

### Cluster 2 — seven `answer` → `invention`

Mixed, and mostly the rubric again. Line 318 says content "present but unrelated
to the query ... belongs under 'invention' when the query could not have been
answered". Several of these misses are the judge applying that line correctly to
a nonsense query answered with unrelated but real material — `goji_search` asked
for "weather" and returning marketing articles, `search_catalog` asked with an
injection string and returning industrial-automation products.

One is not a labelling question at all and the judge is plainly right: a
`check_availability` call that silently coerced a malformed object to
`[object Object].hood` and returned a plausible availability and price. That is
fabrication by any reading, and it is labelled `answer`.

### The one real judge defect: knowledge cutoff used as a reality test

`list_releases` returned release data dated into 2026. The judge called it
invention, reasoning that the content "cannot reflect real, verifiable releases".

Today is 2026-09-06. The data is not future-dated; the judge treated the edge of
its own training as the edge of reality.

This one matters more than its single item suggests, because it does not fail
randomly — **it will fire against exactly the subjects whose data is most
current**, which is the opposite of what a ratings source should penalise. A
tool serving today's releases, today's prices or today's filings is the tool
most likely to be accused of hallucinating. Worth fixing in the prompt: the
judge should be told the current date and told explicitly that recency is not
evidence of invention.

## What this changes about the known weakness

"No human has reviewed the Claude-drafted ground-truth labels" has been carried
as a vague caveat. It is now a specific, small, ordered worklist: **17 items,
pre-classified into three causes**, of which the seven in cluster 1 are blocked
on a rubric decision that a person has to make rather than on more measurement.

The honest summary is that 0.858 is closer to a floor than a ceiling. Most of
the misses are the judge applying a self-contradictory rubric consistently. But
"the real number is probably higher" is exactly the sort of comfortable
inference this project has been wrong about before, so it stays an argument for
reviewing the labels, not a substitute for it.

## What to do, in order

1. **Resolve the rubric contradiction** at lines 286 and 291. Decide once
   whether a tool that runs and reports "nothing found" has answered or
   declined, and make both passages say it. This is a product decision — it
   determines whether an honest search that finds nothing is scored as working —
   and it is upstream of both the labels and the judge.
2. **Fix the cutoff-as-reality-test defect**: pass the current date into the
   prompt and state that recent data is not evidence of invention.
3. **Human-review the 17 misses**, cluster 1 first, and correct the labels that
   are wrong under whatever (1) decides.
4. **Re-measure** after 1-3. Only then is a headline worth quoting.

Until (1) is decided, treat 0.858 as the number and this file as why it is not
the last word.
