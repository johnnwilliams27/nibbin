# The judge panel experiment: design, and what it is blocked on

Status: **built and tested; cannot run.** The OpenAI leg is satisfied; the
Anthropic key is org-scoped and needs a workspace. 161 tests pass.

## The design

Three cheap models vote on every item. Three premium models each adjudicate the
same votes. Claude Fable 5.1 reads the results and recommends a structure.

| Seat | Vendor | Model | $/1M in | $/1M out |
|---|---|---|---|---|
| voter_1 | OpenAI | `gpt-5.4-mini` | 0.75 | 4.50 |
| voter_2 | OpenAI | `gpt-5.4-nano` | 0.20 | 1.25 |
| voter_3 | Anthropic | `claude-haiku-4-5-20251001` | 1.00 | 5.00 |
| decider_1 | OpenAI | `gpt-5.5` | 5.00 | 30.00 |
| decider_2 | Anthropic | `claude-opus-5` | 5.00 | 25.00 |
| decider_3 | Anthropic | `claude-sonnet-5` | 2.00 | 10.00 |
| meta | Anthropic | `claude-fable-5-1` | 10.00 | 50.00 |

Each decider also answers alone, as a solo baseline, and runs in both
presentations (`votes_only`, `votes_and_evidence`).

**Generation parity is part of fairness.** An earlier roster paired current
Claude models against `gpt-5` and `gpt-5-mini`. The account's own model listing
offers up to the 5.6 family, so any accuracy gap measured that way would have
been partly a gap between release dates, with nothing in the results saying so.

**Two vendors, three seats per layer.** One lab necessarily holds two seats in
each layer — that is forced by the shape, not chosen. OpenAI doubles in the
voters and Anthropic in the deciders, so neither is the majority of both
layers. Fable is the meta pass and not a decider, so it never grades its own
output.

**What doubling costs, measured rather than assumed.** Three voters look like
three opinions, but two share training data, RLHF lineage and tokenizer, so a
2-1 majority can be one family agreeing with itself and outvoting the other
vendor. `family_majority` counts exactly that: items where a same-vendor pair
agreed, the lone other-vendor voter dissented, and the dissenter was right. No
accuracy number reports this on its own — the majority's accuracy just looks
slightly lower.

## Five things added to make it answer the question

**1. Ground truth.** Three voters agreeing measures correlation, not
correctness, and a decider reviewing them inherits whatever they got wrong
together. Every item carries a hand-assigned label and every structure is scored
against it. Without this the grid ranks structures by self-consistency — the
property a confidently wrong panel maximises.

**2. The decider returns a verdict, not a choice of voter.** It may overrule all
three. A decider that can only pick A, B or C can never rescue a unanimous
panel, which is exactly the failure correlated cheap models produce.

**3. Solo baselines.** Each premium model also answers alone. If one strong
model matches voters-plus-decider, the voting layer costs money and latency to
buy nothing, and the honest recommendation is to skip it. A grid that cannot
produce that answer is a procurement exercise, not an experiment.

**4. Anonymisation, permuted per item by a seeded shuffle.** Votes reach the
decider as Judge A/B/C with no vendor named. This controls position bias and
makes self-preference *measurable*: the sharp form is, on items where every
voter from its own lab was wrong and some other vendor's voter was right, how
often did it follow the family anyway. Siblings are plural here, because a lab
holding two voter seats has two of them.

**5. Both presentations.** `votes_only` shows the decider the verdicts and
reasons; `votes_and_evidence` re-sends the original content at roughly ten times
the input tokens. The difference between them is the real price of good
adjudication and nobody knows it without measuring.

## Metrics that decide it

- **Pairwise error correlation (phi).** The whole case for three vendors is
  independent mistakes. If two voters are wrong on the same items, a majority of
  three is a majority of two. Phi rather than raw agreement, because two models
  that are each 95% accurate agree 90% of the time by arithmetic alone.
- **Rescue vs breakage, not average accuracy.** How often a decider fixes a
  wrong majority against how often it overturns a right one. A decider with a
  good average and a bad breakage rate is actively damaging.
- **Coverage-adjusted accuracy.** Correct over *all* labelled items, abstentions
  counted as misses. Plain accuracy lets a structure win by answering only the
  easy third.
- **Family majority.** How often a same-vendor pair outvoted a correct dissenter
  from the other lab. On a two-vendor panel this is the price of the third seat,
  and it is invisible in every other number here.
- **Split resolution.** Rescue and breakage only count items where the voters
  agreed. `split_resolved` / `split_missed` cover the items where they did not,
  which is where an adjudicator earns its price.
- **Schema discipline (gate G2).** Any failure to return valid structured output
  is disqualifying. No repair pass, no re-prompt, no regexing a verdict out of
  prose — a harness that silently repairs bad output cannot measure it.

## The meta pass, and its conflict of interest

A Claude model choosing between structures, one of which contains Claude, is not
a neutral question. Containment: `rankStructures` is pure and deterministic and
its winner is **authoritative**; the model reads the same table and its pick is
**explanatory**. We record whether they agree. Disagreement is a finding either
way — either about the model's bias, or about a criterion our ranking is
missing. What we never do is let the model's pick silently be the answer.

## A bug this work found

`ask()` fenced subject-authored content before calling a model. The panel calls
clients directly — voters, deciders, and the meta pass are three new routes to a
model that do not go through `ask`, all carrying attacker-influenceable text.
Fixed by moving the preamble, the permitted-verdict list and the fence into the
vendor adapter, the single point where a request becomes a message. There is now
no way to reach a real model without them.

Related: a voter's one-line reason quotes subject content, so votes go to the
decider in the **untrusted** position. Putting them in the instruction would
launder the fence off in one hop.

## The corpus

Built from 600 stored transcripts and 112 stored calls, deduplicated to 205
items across two tasks, written as one file per task.

| Task | Items | Labelled |
|---|---|---|
| response_classification | 85 | 85 (answer 41, error 25, refusal 19) |
| declaration_contradiction | 120 | 0 — second pass |

Two limits bound what the response set can conclude, and both are stated in the
labelling script rather than buried:

- **No confirmed inventions.** Every stored response is an answer, a refusal or
  an error. Invention — confident content for a query that cannot have one — is
  the class the judge exists to catch, and a corpus with none of them cannot
  measure whether any model detects it.
- **Responses stored as 300-character samples.** An invention is usually
  recognisable from a response's body, not its first lines. Same fix as above:
  full-text capture on a targeted re-probe.
- **The labels were drafted by a Claude model while Claude models are under
  test.** Most items are not borderline — "is this payload a stack trace" is not
  a matter of taste — but a human review pass over a random sample is needed
  before the Claude leg of the grid is trusted.

## What it is blocked on

Preflight refuses to start on a partial roster, because a panel missing a seat
is not a smaller version of this experiment but a different one whose agreement
numbers would be read against the full shape's expectations.

| Capability | Needed for | How to provide |
|---|---|---|
| `judge_model_openai` | voter_1, voter_2, decider_1 | **Satisfied.** All three ids confirmed against the live listing |
| `judge_model_anthropic` | voter_3, decider_2, decider_3, meta | **Blocked.** The key is org-scoped and is rejected on every request until it names a workspace: set `ANTHROPIC_WORKSPACE_ID`, or use a workspace-scoped key |

Model ids are validated against each provider's live models listing before the
run starts. The Anthropic ids come from the `claude-api` skill and are confirmed;
the OpenAI and xAI ids in `ROSTER` are marked `verified: false` and will be
checked at run time rather than trusted from source — a typo would produce a
complete, plausible, worthless result set that nothing downstream would reveal.

## Expected cost of the run itself

85 items × (3 voters + 3 deciders × 2 modes + 3 solos) ≈ 1,020 model calls.
At the roster's prices that is **under $10**, dominated by the premium legs in
`votes_and_evidence`. Adding the 120 declaration items roughly triples it and
keeps it under $30 — the figure from `judge-model-economics.md`, unchanged.
