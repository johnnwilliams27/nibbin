# The judge panel experiment: design, and what it is blocked on

Status: **running.** All seven models confirmed reachable; 161 tests pass.

## The design

Three cheap models vote on every item. Three premium models each adjudicate the
same votes. Claude Fable 5.1 reads the results and recommends a structure.

| Seat | Vendor | Model | $/1M in | $/1M out |
|---|---|---|---|---|
| voter_1 | Anthropic | `claude-haiku-4-5-20251001` | 1.00 | 5.00 |
| voter_2 | Anthropic | `claude-sonnet-5` | 2.00 | 10.00 |
| voter_3 | OpenAI | `gpt-5.4-mini` | 0.75 | 4.50 |
| voter_4 | OpenAI | `gpt-5.4-nano` | 0.20 | 1.25 |
| decider_1 | OpenAI | `gpt-5.5` | 5.00 | 30.00 |
| decider_2 | Anthropic | `claude-opus-5` | 5.00 | 25.00 |
| meta | Anthropic | `claude-fable-5-1` | 10.00 | 50.00 |

Each decider also answers alone, as a solo baseline, and runs in both
presentations (`votes_only`, `votes_and_evidence`).

**Generation parity is part of fairness.** An earlier roster paired current
Claude models against `gpt-5` and `gpt-5-mini`. The account's own model listing
offers up to the 5.6 family, so any accuracy gap measured that way would have
been partly a gap between release dates, with nothing in the results saying so.

**Four voters, evenly split.** Two Anthropic against two OpenAI, so neither lab
can carry a majority alone: three of four is the threshold and a two-two vendor
split is a tie the panel abstains on. That is what the even shape buys over
three voters, where one lab always had the numbers. Fable is the meta pass and
not a decider, so it never grades its own output.

**Price is not matched across the blocs** and should not be read as quality. The
OpenAI pair is cheaper per token at every seat. Ranking is on accuracy against
labels; cost is reported separately and deliberately does not enter it.

**Bloc splits: when the labs disagree, who is right?** Voters from one lab share
training data, RLHF lineage and tokenizer, so four voters are not four opinions
— they are two opinions held with varying confidence. A bloc split is an item
where each lab was internally unanimous and the labs disagreed. On an evenly
split panel these are exactly the items majority rule cannot resolve, so they
land on the adjudicator; which lab tends to be right on them says more about
what a cheaper panel should be made of than any aggregate accuracy number.

**The roster is data, not architecture.** The shape is expected to change, so
`voterSubsets` re-derives the accuracy of every smaller voter combination from
one run's stored votes — the models answered independently, so any subset's
majority is exactly computable after the fact. "Do we need all four, and which
ones" is an offline question. The limit, stated so it is not overclaimed: this
works for majority-only structures. Each decider saw all four votes, so what it
would have said given two of them is unknowable and needs its own run.

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

## Run 1 (2026-09-04): two findings, neither about model quality

The run completed all 85 items and printed a ranked winner. It should not be
read as the experiment, for two independent reasons found afterwards.

### The panel was half dead and said nothing about it

Every OpenAI call failed — 255 of them, all `HTTP 429: You have no credits
remaining`. The grid degraded from two vendors to one and still produced a
ranking, a bloc analysis reporting zero cases, and a correlation matrix
containing only Claude models.

Preflight had passed because it read each provider's model catalogue, which is
free. All seven models were listed and reachable. **A catalogue check answers
"does this model exist"; only a call answers "can we use it."** `smokeTest` now
makes one real minimal call per vendor before anything else runs — a fraction
of a cent, and it turns a wasted run into a five-second failure.

### The corpus was measuring our own truncation

Accuracy of 0.6–0.7 against the labels looked low enough to be suspicious, so
the disagreements were split by whether the stored response had hit the
300-character capture cap:

| Stored response | Items | Best model's error rate |
|---|---|---|
| Cut at the cap | 40 | **45%** |
| Stored in full | 45 | **13%** |

A 3.5× difference, and it explains the dominant confusion in the matrix
(`answer -> error`, 11 of 24 disagreements). Truncating a JSON response
mid-structure leaves a malformed fragment, and a model reading malformed output
calls it a failure — which is the correct reading of what it was shown. The
corpus was asking "can you classify a broken excerpt", not "can you classify a
tool response".

On full-text items the same model scores **0.87**, not 0.718.

Two smaller components of the disagreement are real and worth fixing separately:

- **Rubric ambiguity** (`refusal -> error`, 5 cases). "No design provided.
  Bind the user's attached image..." is a deliberate decline for missing input;
  the rubric does not cleanly separate that from an error, and both readings are
  defensible. The definitions need tightening before they can grade anyone.
- **Genuine model error** (`answer -> invention`, 5 cases), including a domain
  checker correctly reporting that a nonsense domain is available.

### What this changes

Full-text capture moves from a nice-to-have to a precondition. No model
comparison on this corpus means anything until responses are stored whole,
because the largest single driver of measured error is a decision we made about
storage.

The verdict distribution added mid-run earned itself immediately: Opus as
decider scored 0.600 seeing votes without evidence, *below* its 0.682 solo
score, and the distribution shows why — `unclear` 19 times without evidence
against 1 with it. Deprived of the underlying response it abstained rather than
guessed, which is the behaviour we asked for and the scoring rule punishes.

And the decorrelation argument held up under measurement: pairwise error
correlation among the Anthropic models ran phi 0.56–0.78. Two Claude models
agreeing really is an echo.

## Run 2 (2026-09-04): the panel does not earn its keep

120 labelled items, whole responses, tightened rubric, both vendors live.
Artifact: `runs/panel-2026-09-04T21-03-01-631Z.json`.

### The corpus fix was worth about twenty points

| Model | Run 1 (truncated) | Run 2 (whole) |
|---|---|---|
| `claude-haiku-4-5` | 0.635 | 0.742 |
| `claude-sonnet-5` | 0.694 | **0.892** |
| `claude-opus-5` solo | 0.682 | **0.892** |
| `claude-opus-5` decider + evidence | 0.718 | **0.908** |

The diagnosis is confirmed as emphatically as it could be. Nearly everything
run 1 measured as model error was our own storage decision.

### Structures, ranked

| # | Structure | acc | cov_acc | cost |
|---|---|---|---|---|
| 1 | Anthropic decider, votes + evidence | 0.908 | **0.908** | $2.17 |
| 2 | Anthropic decider, votes only | 0.900 | 0.900 | $2.17 |
| 3 | `claude-opus-5` alone | 0.892 | 0.892 | $1.43 |
| 4 | `gpt-5.5` alone | 0.907 | 0.880 | $0.85 |
| 5 | OpenAI decider, votes + evidence | 0.905 | 0.878 | $1.73 |
| 6 | OpenAI decider, votes only | 0.888 | 0.861 | $1.73 |
| 7 | **Majority of four voters, no decider** | 0.921 | **0.775** | $0.86 |

### The finding that matters: one model matches the panel

`claude-sonnet-5` ALONE scores **0.892** at $0.55 — level with Opus solo, and
1.6 points below the winning seven-model structure that costs four times as
much. The four-voter majority is the *worst* structure on the board, because it
abstains on 19 of 120 items: its 0.921 accuracy is bought by declining every
question it found hard.

This is the solo baseline doing the job it was put there to do. It was included
precisely so the experiment could return this answer, and it has.

### The decorrelation argument does not survive contact with data

The case for multiple vendors was that errors from different labs would be
independent. They are not:

| Pair | phi |
|---|---|
| `claude-haiku-4-5` vs `gpt-5.4-mini` (**cross-vendor**) | **0.635** |
| `claude-opus-5` vs `claude-sonnet-5` (same vendor) | 0.599 |
| `gpt-5.4-mini` vs `gpt-5.4-nano` (same vendor) | 0.532 |
| `claude-opus-5` vs `gpt-5.4-nano` (**cross-vendor**) | 0.529 |

The highest correlation on the board is a cross-vendor pair. Errors track ITEM
DIFFICULTY, not model lineage: the hard items are hard for everyone. Only 3 of
120 items produced a bloc split at all, and majority rule resolved none of them.

That undercuts the central rationale for the whole panel design, and it is the
sort of thing a benchmark exists to find out before the architecture ships
rather than after.

### A harness gap that was being scored as a model failure

`gpt-5.5` failed 22 of 120 calls. Nearly all were `HTTP 429` on a 3-requests-
per-minute account tier — ours, not the model's. Scored as schema failures they
disqualified it under gate G2 and dragged its coverage from 0.880 to 0.733,
moving it from fourth place to fifth.

This is the project's signature error committed against its own experiment:
reading "we could not obtain the answer" as "the model failed to give one".
`isHarnessFailure` now separates rate limits, exhausted credits, timeouts and
provider 5xx from real schema violations, and harness-blocked items leave the
coverage denominator entirely — the same rule `capability.ts` applies to
subjects. gpt-5.5's genuine schema failures are 3, not 22.

**The comparison is still not clean.** gpt-5.5 answered 97 of 120 items where
the Claude models answered all 120. Its rate limit needs lifting before the two
vendors can be ranked against each other honestly.

### Still open

- The meta pass has now declined three times as `reasoning_extraction`, through
  two different preambles. It is non-fatal and recorded as a harness gap, but
  the cause is not the framing alone.
- No confirmed `invention` items. The class the judge most exists to catch is
  still unmeasured.
- The labels remain Claude-drafted while Claude models are under test, and
  Claude models occupy the top three places. A human review pass over a sample
  is the only thing that can settle whether that ordering is real.
