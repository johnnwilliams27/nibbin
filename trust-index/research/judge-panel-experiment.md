# The judge panel experiment: design, and what it is blocked on

Status: **built and tested; cannot run.** Three vendor credentials are missing.
Everything else is in place and 158 tests pass.

## The design as specified

Three cheap models from three labs vote on every item. Three premium models each
adjudicate the same votes. A final Claude pass reads the results and recommends
a structure.

```
                  ┌──────────────┐
   item ─────────►│ cheap OpenAI │──┐
        ─────────►│ cheap Claude │──┼──► anonymised A/B/C votes
        ─────────►│ cheap Grok   │──┘         │
                  └──────────────┘            │
                                              ├──► premium OpenAI ──┐
                                              ├──► premium Claude ──┼──► meta pass
                                              └──► premium Grok  ───┘   (Claude)
```

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
makes self-preference *measurable*: the sharp form is, on items where its own
lab's voter was wrong and the others were right, how often did it follow the
sibling anyway.

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

Preflight refuses to start on a partial roster, because a two-vendor panel is
not a smaller version of this experiment but a different one whose agreement
numbers would be compared against three-vendor expectations.

| Capability | Needed for | How to provide |
|---|---|---|
| `judge_model_openai` | cheap + premium OpenAI legs | OpenAI platform account, key in `OPENAI_API_KEY`, billing enabled |
| `judge_model_anthropic` | cheap + premium Claude legs, meta pass | Anthropic Console key in `ANTHROPIC_API_KEY` (a host-managed CLI session is not a usable key) |
| `judge_model_xai` | cheap + premium Grok legs | xAI console account, key in `XAI_API_KEY`, billing enabled |

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
