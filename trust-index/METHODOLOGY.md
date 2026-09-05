# How the Trust Index rates things

This describes the method. It names no product and publishes no scores — those
are a separate decision with a separate standard of evidence, and this document
has to stand on its own first.

The subject matter is AI systems: agents, tools, MCP servers, on-chain and off.
The premise is that they are about to be depended on by other software, at
machine speed, by callers who cannot read a README first, and that "this one
seems fine" does not survive contact with that.

---

## The failure this is built around

Rating anything has one dominant failure mode: **you measure what is easy to
read rather than what matters.**

We know because we shipped it. An early version of this system ran nineteen
checks. Every one of them read a *manifest* — the names a server declares, the
descriptions it writes, the schemas it publishes, when it last released. Not one
of them called a tool. The ratings looked plausible. They ranged over 2.4 points
across eight distinct values on a population of six hundred, which is a constant
wearing a dimension's clothes.

Then we called the tools. Nearly half did not work — dead endpoints, stubs that
ignored their arguments, tools that invented answers to questions that had none.
None of that was visible in any manifest, and all of it was visible on the first
call.

The lesson generalises past our case, and it is the reason for most of what
follows: **a declaration is not a measurement, and treating one as the other is
how a rating system manufactures signal it does not have.**

---

## Principles

### 1. A gap is never evidence

The single most important rule, and the one most often broken by systems like
this.

If we could not obtain data, that is a fact about *us*. It is never a fact about
the subject. A missing credential, an exhausted quota, a model that declined to
answer, a check we have not built yet — none of these may be published as a
finding, and none may lower anyone's score.

Every unrun check is recorded with a cause, and the causes are not
interchangeable:

| Cause | Meaning | Effect on the score |
|---|---|---|
| `harness_capability_missing` | We have no credential or account for this | Dimension leaves the denominator |
| `harness_capability_unhealthy` | We have it and it is broken | Dimension leaves the denominator |
| `subject_blocked` | The subject prevented the check | Dimension stays; the subject bears it |
| `not_applicable` | The check does not apply here | Excluded, no implication either way |

Only the two harness causes excuse the subject, and that asymmetry is
load-bearing. Without it, a subject that makes itself hard to measure scores the
same as one that is genuinely unmeasurable — and better than one that answered
and failed.

This is also the rule we have broken most often. Our own review log has more than
a dozen instances of the same mistake in different clothes: rate limits scored as
schema failures, our own response truncation scored as a model error, a bug in our
handshake reported as a hundred unreachable servers. Each time, the shape was
identical — *I could not obtain the data* silently became *the data is not there*.

### 2. Provenance is priced, and self-report is nearly worthless

Not all evidence is equal, and the difference is arithmetic rather than
rhetorical. Each observation carries how it was obtained, and that multiplies its
weight:

| Provenance | Weight | What it is |
|---|---|---|
| `measured` | 1.00 | We observed it directly |
| `attested` | 0.85 | A third party we can verify stated it |
| `judged` | 0.70 | A model read the evidence and concluded it |
| `third_party_review` | 0.60 | Someone else's published opinion |
| `self_reported` | 0.15 | The subject said so |

Self-report is additionally capped per dimension, usually at zero. A subject
cannot improve its safety score by describing itself as safe, however much
description it provides.

### 3. Withholding is a result

Most subjects get no score. On our first full population, 530 of 600 were
withheld, and that is the system working rather than failing.

A rating is published only when enough of the profile could actually be assessed
and enough of what was assessed produced a usable estimate. Below either floor
the answer is not a low score — it is no score, with the reason stated and the
gaps listed. A confident number computed from two observations is worse than
silence, because silence cannot be quoted.

### 4. Averages hide hazards, so gates escape them

A dimension score is a weighted mean, and a mean is exactly the wrong instrument
for "is there something dangerous in here".

One tool that obeys instructions embedded in its own input, sitting among two
hundred well-behaved ones, is a ratio of 0.995 and a hazard of 1. The caller does
not experience the average; they experience the one tool when they call it.

So findings of that kind are recorded in *occurrence* form — "at least one tool
did this" — and matched by gates that impose a hard ceiling on the composite
regardless of how much good behaviour surrounds them. We measured the difference:
a server with one hostile tool scored 52.95 alone and 75.33 once 199 trivial
passing tools were declared alongside it. The hostile tool was still there. Gates
are what stop that from being a strategy.

### 5. Anything that decides a number is versioned and hashed

Three digests travel with every result: the profile that defines the dimensions
and weights, the observations that fed it, and the collector rubric that turned
raw evidence into those observations.

The third was missing for a long time and its absence was instructive. We retuned
one normalisation curve — how a publish date becomes a maintenance value — and
every maintenance score in the compendium moved, while no digest anywhere changed.
Two results agreeing on inputs and profile had still not been produced by the same
rules. The step that *produces* the observations is where the judgement lives, and
it has to be in the envelope.

### 6. We do not spend other people's money to rate them

Probing is done to systems that did not ask to be probed. That imposes a duty,
and the duty is stricter than "do not break anything".

We call read-only tools. "Read-only" is decided by three independent guards, and
we arrived at all three the hard way:

- **Never a write.** The guard used to be a denylist of mutating verbs. A tool
  named `add_trade` — "attach a trade execution record to a finding you
  published" — passed it, because "add" was not on the list. We called it four
  times before noticing. Nothing was written, but only because that server
  required a field its own schema did not declare. That was luck, not a control.
  The rule is now an allowlist: the leading verb must affirmatively read as a
  read. Its failure mode is declining to probe something harmless.
- **Never metered.** A tool that reads but charges per call spends someone's
  money when we probe it. A tool that runs a model per call spends real compute
  to tell us that a proxy proxies.
- **Never a second hop.** A tool that makes a live request to a fourth party on
  our behalf reaches someone who never appeared in any registry and cannot be
  asked.

The last two are not writes and pass every mutation check honestly. They are
excluded anyway, and — per principle 1 — their exclusion is *our* gap, recorded
as `not_applicable`, never a mark against the subject.

### 7. The probe must not be recognisable

If the rating can be obtained by detecting the rater, it is not a rating.

Every distinguishing feature of our probe was once a constant in a public
repository: the nonsense query, the injected instruction and the token it asked
for, the user agent, the client name, even a fixed delay between calls. An
operator wanting a good score did not need a good server. They needed to read our
source and write about thirty lines of special-casing, and it was worth 17.5
points immediately — widening to more than 44 under a daily schedule, with the
fake reaching our highest confidence tier.

Those values are now derived per subject from a secret we hold. The method stays
public and auditable; the specific strings do not. Two subjects never see the same
probe, and neither can be learned by reading the code.

This raises the cost of gaming from "grep and special-case" to "detect the rater
by other means". It does not eliminate it, and the limits are stated rather than
implied: an operator who logs what arrives can still collect the values aimed at
them; traffic analysis still works; and nothing here detects a server that
behaves well for us and badly for everyone else. That last one needs a second
vantage point, and we do not have one.

---

## How a rating is built

Everything reduces to one shape, which is what lets the same engine rate an MCP
server and an on-chain agent without a parallel universe of code for each:

```
Subject  ──has──▶  Observation { dimension, provenance, value, key, timestamp }
```

Observations roll up per dimension through a shrinkage estimator, which pulls a
sparse estimate toward the cohort prior in proportion to how little evidence
supports it. Three observations cannot look like thirty. An effective sample size
travels with every dimension, and below a floor the dimension is not published at
all.

Repeated observation is not the same as corroboration, and the estimator is
careful about the difference. Probing the same server twenty times in one day is
one instrument sampling repeatedly — it is bounded by a volume cap keyed to the
observer and the day, so a subject cannot be flooded into confidence. Probing it
once a day for twenty days is twenty samples of a thing that could have changed,
and counts as such. Which of the two a check is gets declared per dimension, not
inferred.

---

## The judge, and why there is one

Some questions have no structural answer. "Did this tool invent that content, or
is it correctly reporting that nothing matched?" is the central one, and a word
list gets it wrong: ours called seven of eight honest refusals fabrications,
including a domain checker correctly reporting that a nonsense domain was
available.

So a model reads the response. Three constraints on it:

**It cannot authorize anything.** No verdict can cause a tool to be called. The
judge reads outputs and returns a verdict from a fixed vocabulary; the call
decision was made before it ran and cannot be revisited by it.

**Its input is fenced and its output is bounded.** Subject content is attacker
authored by definition — the entire premise of the protocol we are rating is
feeding untrusted content to an agent. Content is wrapped with a per-call random
delimiter, travels in a separate channel from the instruction, and the verdict is
constrained to an enum at the API level with no repair pass. Content that tries
to instruct the judge is reported as a finding about the subject, because a tool
returning text aimed at the rater is not a tool with a quality problem.

**"I cannot tell" is a real verdict.** It resolves to a skip, not a guess. A
guess here is precisely the error principle 1 exists to prevent.

Which model does this was decided by measurement, not preference. We built a
120-item labelled benchmark and compared seven structures: four cheap models
voting, two premium models adjudicating those votes, each premium model alone,
and every smaller combination re-derived from the stored votes.

**The voting panel lost.** It scored 0.775 against 0.892 for the best single
model, and it lost for a specific reason: majority rule abstained on 19 of 120
items, declining exactly the questions that were worth asking. Its flattering raw
accuracy was bought by not answering. The top five structures then sat inside the
resolution of the test — at that sample size a gap under 5.4 points is not a
difference — so the cheapest of them won on cost alone.

One model. No panel. The panel harness is kept, because this decision expires when
the models change.

---

## We attack our own rating

An adversarial review of this system found twelve ways to score well without
being good. All twelve are fixed and each is now pinned by a test that fails
without its fix. Five were serious:

| Attack | What it was worth |
|---|---|
| Obey an injected instruction, then quote the query back — the check read it as a search tool echoing | +12.5 |
| Pad 440 bytes of banner before the payload, past the 300 characters the check actually read | passes silently |
| Surround one hostile tool with 199 trivial ones | +22.4 |
| Rename a credential parameter from `api_key` to `auth_token` | +30.5 |
| Special-case the probe's published constants | +17.5, growing to +44 over a year |

A sixth was worse than any of them, because it inverted principle 1. An unhandled
error from the judge escaped before the remaining checks ran, so the subject got
no result at all — and with no result, the harness reported *three gaps of its
own*, published under our name, saying we had never looked. A subject that
anticipated a bad score could withhold itself on demand and have the withholding
attributed to us.

Two things are worth saying about this list rather than quietly fixing it.

The first is that **most of these were mistakes of the same family as the one in
principle 1** — we recorded what we could easily read rather than what we meant
to measure. The injection check read 300 characters because that field existed.
The credential check compared strings because comparison is easy.

The second is that **reading and testing did not find the worst one.** The
`add_trade` call in principle 6 was caught by watching a live run's fourth line
of output. A test tells you a rule behaves as written. Only a dry run tells you
what the rule admits on today's data, which is a different question, and it is
the one that was wrong.

---

## What this does not claim

- **It is not a security audit.** We probe a handful of tools per server for a
  few specific behaviours. A clean rating means those checks passed, not that a
  system is safe.
- **There is one vantage point.** A server that behaves well for us and badly for
  everyone else is invisible to this method.
- **The judge's ground truth was drafted by a model** of the same family as
  models under test. We bounded the exposure — flipping every disputed label
  leaves the structural conclusions intact — but no human has yet reviewed a
  sample, and that remains open.
- **Thresholds are provisional.** They were chosen by reasoning and are meant to
  be replaced by calibration against outcomes. They are named constants in one
  place so that a calibration run can move them, and they should never be moved
  to taste.
- **Confidence describes evidence, not truth.** A high-confidence rating means we
  sampled deeply over a long window. It does not mean many independent observers
  agree, because on a single-instrument profile there are none.

---

## Why publish this at all

Two reasons, neither of them modest.

A rating nobody can check is an assertion. If the method is not legible, the only
thing on offer is that we say so — which is the `self_reported` row of our own
provenance table, weighted 0.15, and we would not accept it from anyone else.

And a rating system's own failures are the most useful thing it knows. The list
above is not a confession; it is the specification. Anyone building something
similar will meet all twelve, and most of them do not announce themselves — they
look like a working system producing plausible numbers, which is exactly what we
had when nineteen checks read manifests and half the tools did not work.
