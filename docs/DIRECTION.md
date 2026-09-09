# Trust index: direction and working notes

**Audience:** Claude Code sessions on this project, and John.
**Method version in scope:** `mcp_server.v2`, plus the agent profile to be
written.

Anything marked `[UNVERIFIED]` comes from a competitor's own material or a
secondary source and has not been independently checked. Do not source claims
about competitors from vendor blog posts; at least one widely-linked
comparison article describes Glama incorrectly by reproducing the official
registry's description under Glama's heading.

---

## 1. What this is

An independent assessor of whether agents and the tools they expose actually
work and behave safely when called.

The subject is anything that publishes a persistent identifier and a callable
interface. Each subject kind gets a versioned profile. `mcp_server.v2` covers
remote MCP servers. The agent profile is the primary one, and it consumes
server probing as evidence rather than publishing server ratings separately.

The method is public, the engine is open source, the observations are
published, and results are reproducible from published artifacts. The
distinguishing property is that it refuses to publish a rating when the
evidence is too thin, and records why.

---

## 2. The position

ERC-8004 defines three registries: Identity, Reputation and Validation. The
spec's own Security Considerations state that while it cryptographically
ensures the registration file corresponds to the on-chain agent, it cannot
guarantee that advertised capabilities are functional and non-malicious, and
that the three trust models exist to support that verification need.

Nobody has filled the capability-verification slot. Every validation approach
named across the ecosystem verifies work outputs: stake-secured re-execution,
zkML proofs, TEE attestation, trusted judges. None tests whether a declared
interface functions, fabricates, leaks, or obeys injected instructions.

**We are a validator in the Validation Registry, filling that gap.**

The mapping requires no new mechanism:

| Registry field | Our artifact |
|---|---|
| `response` (0-100) | composite score |
| `responseURI` | published observation set |
| `responseHash` | observation digest |
| `tag` | profile identifier |

`validationResponse()` can be called multiple times for the same
`requestHash`, which fits progressive coverage: thin now, stronger later,
same request, nothing retracted.

The reputation registry's example tag vocabulary already includes
`reachable`, `uptime`, `successRate` and `responseTime`. Adopt those names so
output composes with the rest of the registry.

### Scope of the subject space

ERC-8004 is multichain. The Solana Foundation adopted it as the basis for the
Solana Agent Registry, 8004scan added Solana support in March 2026, and the
identifier format `{namespace}:{chainId}:{identityRegistry}` was designed for
non-EVM namespaces. Polygon and other EVM chains get it via per-chain
singletons. One standard, many chains.

The reachable population is the constraint, not the chain. Our instrument
requires a running endpoint speaking a protocol we can introspect. Agents
published as GitHub repos have no callable surface. Agents advertised on
social media have no identifier and no enumerable population. The set we can
reach is the set that publishes an identifier plus a declared interface,
which is also the set that needs a portable trust signal, because an agent
only publishes that way when it expects to be selected by other software
rather than by people.

---

## 3. The landscape

### Glama

An independent MCP directory and gateway, built by Frank Fiegel (u/punkpeye),
launched November 2024, bootstrapped. Not affiliated with the official
registry, not a metaregistry.

- Indexes on the order of 84,000 MCP servers `[UNVERIFIED, self-reported]`
- Builds open-source servers from source and runs them in a sandbox
- Observes the running process at syscall and network layers, looking for
  patterns such as access to credential paths outside the declared capability
  set, or outbound traffic to hosts not in the manifest
- Performs MCP introspection and captures full JSON Schema plus annotation
  hints
- Publishes TDQS, a tool-description quality score, open source, re-run on
  every commit
- Indexes hosted connectors using sandbox credentials supplied by maintainers,
  against non-production environments
- Runs a gateway with request logging, per-tool access control, managed OAuth
- Reports roughly a million scans in twelve months `[UNVERIFIED]`

**Their founder on the limits, publicly on r/mcp:** beyond simple cases such
as glob patterns hunting for SSH keys, he says it is very hard to distinguish
a server that legitimately does a lot from a malicious one. Detection is
partly outsourced to external researchers who report actors for delisting.
For servers on their infrastructure they monitor network traffic and flag
suspicious activity for review. He explicitly declines to downplay the
security problem.

That is the incumbent conceding the resolution ceiling of process-level
observation, in his own words. Cite it rather than paraphrasing it into a
claim of our own. On a separate thread asking how anyone verifies MCP server
reliability before production, he asked openly what Glama could do beyond
what it already does.

**What the TDQS launch demonstrated.** Headline was that 97% of MCP tool
descriptions have quality defects. Within twelve hours of release, servers
were scoring A. A metric that flips to top marks the same day it ships is
measuring something cheap to fix. That is the manifest-is-not-evidence point
demonstrated by their own launch rather than asserted by us.

**Two structural facts that matter more than any feature.** They have a
maintainer relationship that unlocks credentialed coverage, which is business
development rather than engineering. And they publish on nearly everything,
which is the opposite epistemic commitment from ours.

### Everyone else

**8004scan** is an AltLayer product, living in AltLayer's own documentation.
AltLayer is a funded rollup and restaking infrastructure company, so it is
ecosystem positioning rather than a revenue line. **8004 Market** and the
**SATI dashboard** are ecosystem surfaces; SATI is Solana Foundation
infrastructure. **RelAI** is the only one with real revenue, and the revenue
is API relay, not reputation; 8004 registration and automatic feedback are
features that make the relay stickier. **8004.org** is a community hub.

The pattern: funded infra companies doing ecosystem positioning, a foundation
funding public goods, or a real business using 8004 as a feature. Nobody is
selling trust.

**RNWY** rates agents from reported on-chain history. A trust API scoring
185,000+ agents, free, with a typed SDK, an MCP tool, and ES256-signed
attestations, with scores readable on Base mainnet. They also run
knowyouragent.network while being a participant, which is the conflict we
name.

**Watch:** the RAILS paper on verification-native clearing for agentic
commerce frames a "Verification Mesh" writing to the validation registry and
explicitly positions itself as supplying the soundness specification the
registry omits. Academic, not shipped, different framing, but adjacent.
Separately, Everstake has publicly framed ERC-8004 as a new category of
onchain activity for validators. If validation becomes paid, well-capitalised
staking operators will take the slot, doing re-execution rather than probing.

### What each method observes

| | Glama | Us |
|---|---|---|
| Object | The server as software | The subject as a callable interface |
| Access needed | Source or sandbox build | Network endpoint only |
| Evidence | Syscall and network traces, schemas | Responses under probe |
| Answers | Is this code doing something it shouldn't | Does this behave correctly and safely when called |
| Blind to | A tool that obeys injected instructions | A process reading credential files |

Neither finds the other's failures. Obeying an instruction in a tool argument
is not anomalous at the syscall layer. Reading `~/.ssh/id_rsa` never appears
in a tool response.

**Boundary we hold:** we do not build a directory, a browsable catalog, or a
place people go to find things. The thing that would encroach on Glama and
the explorers is discovery, not rating. Everyone else in this space consumes
signals that already exist; we produce them.

---

## 4. Honest self-assessment

### Where we are ahead

Listed so we do not trade these away while closing gaps.

**Abstention as structure.** The skip-reason taxonomy, where
`harness_capability_missing` and `harness_capability_unhealthy` leave the
denominator while `subject_blocked` stays with the subject, encodes "our
inability to measure never becomes a fact about the subject" as a rule rather
than a disclaimer. No competitor does this.

**Gates as occurrences.** One hostile tool in two hundred is 0.995 under a
weighted mean. Capping the composite at 0.35 instead is correct and
immediately legible to anyone burned by an averaged security rating. Lead
with the arithmetic.

**Injection resistance with a control arm.** The sharpest single
differentiator and currently underweighted in how we describe ourselves.
Prompt injection through tool output is the live agent-security problem. The
failure narrative, where string-stripping cleared a tool that obeyed and
condemned a search tool that percent-encoded its own query in a self-link, is
more persuasive than the check itself.

**Coverage as an axis orthogonal to score.** Thin, moderate, strong describes
how much we looked, not how good the subject is.

**Provenance weighting with self-report capped at zero** on seven of eight
dimensions.

### Where we are behind or exposed

**The read-only guard limits reach.** Writes, metered tools and live
fourth-party calls are excluded; anything needing a credential becomes
`harness_capability_missing`. 530 of 600 withheld follows from that.

**Write tools are untested by anyone.** We exclude the most dangerous class
entirely. So does everyone else. A gap in the field, not just in us.

**Reproducibility has a tension.** Three digests prove the same inputs
produce the same output. They do not let a third party rerun the measurement,
because probe seeds are held and deliberately unrecoverable. Anti-gaming and
auditability pull against each other; delayed disclosure resolves it (see
section 6).

**The judge's ground truth.** 120 items, labelled by a model from the same
family as models under test, no human review. Cheapest weakness to close and
the first thing a reviewer points at.

**Single vantage point.** Stated in our own limits. A subject that behaves
well for us and badly for everyone else is invisible.

**Thresholds are provisional.** Named constants awaiting calibration.

**A declared endpoint is not a depended-on endpoint.** An agent may declare
three services and route through one, or call servers it never declared. We
rate what a subject publishes plus what those interfaces do when called,
which is strictly more than anyone else has and is not the full picture. Say
so in limits.

---

## 5. What the community actually says

From r/mcp threads including the official registry announcement, a large
usage thread, and several measurement posts. Treat vote counts as weak signal
and content as directional.

**The most useful prediction.** In the registry announcement thread, a
commenter argued the major clients (Claude, ChatGPT, Cursor, VS Code) will
end up owning distribution the way Apple and Google own app registration, and
that independent registries disappear unless they add real value on top,
naming auth, pre-vetted MCP, orchestration and RBAC. Pre-vetted is us, said
by someone with no stake in it. Better opening line than anything we would
write.

**The registry's own reception was lukewarm.** Fiegel said Glama would
integrate the official registry as a source but that he struggled to see it
becoming a source of truth for them. Others called it undercooked, objected
to "official" and "single source of truth" as presumptuous, and argued the
value is thin because it points at package registries without addressing
consumption the way npx or uv would. The OP noted acceptance guidelines are
permissive. The API returned 500s on launch day.

**The registry maintainers disclaimed trust themselves.** During metaregistry
design, Tadas Antanavicius stated that source-code concerns are delegated to
package registries and that source scanning and tool-poisoning countermeasures
are deferred post-MVP, with comprehensive security assurances out of scope.
What the registry does for quality is namespace authentication via GitHub,
DNS or HTTP challenges, plus character limits and manual takedown. That
prevents impersonation, not malfunction.

**Our withholding rate is corroborated, not embarrassing.** One poster
assembled a deduplicated 14,973-server snapshot from the official registry,
npm and GitHub and reported roughly a third alive. Another described the
20,000-plus on Glama as mostly abandoned. Stop treating 88% as a liability to
explain away.

**Users worry about blast radius, not quality tiers.** Repeated
independently: the number of servers matters less than how much each is
allowed to touch; scoping a server to one directory rather than the home
folder was the real win; an MCP server inherits the agent's permissions and
popular ones can read files or run shell with little scoping. Nobody asked
for a letter grade. Our gates already speak this language and should lead the
product surface ahead of the composite.

**Drift is a named, unmet pain.** A thread on verifying what MCP agents do
before production singled it out: the tool works today, a partner changes a
format next week, the agent fails silently.

**Context cost is measured by others, systematised by nobody.** One post
measured `tools/list` token cost across 106 servers and found a 1,700x
spread, noting the payload enters context every request whether or not a tool
is called. Another found tool selection degrading past roughly ten tools. We
capture the handshake anyway, so this is nearly free. Report it alongside
ratings, outside the composite; folding cost into a trust score conflates two
questions.

**Population counts are incoherent across sources.** 2,000 registry entries
within weeks of preview, ~5,800 servers counting aggregators, 84,000 claimed
by Glama, 19,000 by MCP.so. These cannot all measure the same thing. Whoever
publishes a defensible, reproducible population definition owns the
denominator, and nobody has.

**Ecosystem risk.** Several commenters have moved back to CLIs plus skills
and use few or no MCP servers. Small sample, but if client vendors absorb
tool use, the surface for any MCP rating service shrinks. Not a reason to
stop; a reason to keep the engine subject-agnostic, which it already is.

**Note on population shape.** The servers people name in usage threads are
overwhelmingly local stdio dev tools: filesystem, GitHub, GitLab, Playwright,
Postgres, Atlassian, Context7, Sentry, Linear, Figma. Our profile probes
remote endpoints. This mattered when the plan was an MCP server index; it
matters less now that server probing serves the agent profile, since agents
declare remote endpoints. Revisit only if agent registrations start declaring
local servers.

---

## 6. The model

The shape is a security audit firm. Trail of Bits, OpenZeppelin, Cyfrin and
Nethermind publish reports and open source tooling; the revenue is the
engagement. Certora publishes its prover and sells verification. Open method,
paid application, public output.

Two differences from that template, both real:

- Our subject is a running system observed from outside, not code sitting
  still. Closer to penetration testing than auditing, which means we can be
  wrong in ways an auditor cannot.
- We publish unsolicited ratings on subjects that never hired us. That is a
  rating agency relationship. Some subjects will be unhappy, and some we rate
  poorly are the ones we would want as customers.

### Free, permanently

- The scoring engine (pure function, no I/O, standalone package)
- Every observation record and every rating derived from them
- The judge labelled set, prompt, fencing scheme, and model comparison
- Probe seeds, disclosed on delay after their run window closes
- The three digests: profile, observations, collector rubric

No old-versus-new tier, no metered wall. Everything published stays published
and free. A metered lookup wall would fail anyway: the corpus is open, and
the eventual consumer is software that cannot pass a login.

Publishing observations decouples two audits. "Did you score correctly"
becomes checkable by anyone without rerunning a probe; only "did you measure
correctly" requires trusting us.

**Seed disclosure: delayed, at 90 days, with permanent retirement.** Gaming
needs the probe in advance; auditing does not. This is standard in security
benchmarking and resolves the anti-gaming versus auditability tension rather
than trading one for the other.

### Paid

Work performed, not data withheld. Every item is something we do, not
something we know.

- **Pre-registration assessment.** Run the profile privately against a
  subject that has not registered, and report what a validator would find.
  Registration is a one-way door, since feedback pointers and hashes cannot
  be deleted, and that deadline creates willingness to pay. The withholding
  rate becomes a feature here: "you would not publish, here are the seven
  checks that failed to run and why" is the most actionable output we have.
- **Private subjects.** Enterprise-internal agents and servers, same
  instrument, never published.
- **Continuous monitoring.** Published ratings are point-in-time. Alerting a
  dependent within the hour that an endpoint started obeying injected
  instructions is an ongoing service.
- **Calibration linkage.** Outcome data is the one asset legitimately not a
  public good.

Delivery to humans by contract, to agents by x402 metered call. The latter is
the only paywall an agent can pass.

### Why anyone pays rather than running the open tool

The probes are not in the source. The nonsense query, injected instruction,
token, user agent and client name are derived per subject from a held seed
and cannot be recovered from published code. A developer can run our checks;
they cannot run the checks we will run. Self-testing confirms a tool resists
probes the developer can see, which the control-arm work already proved is
not the same thing.

Secondary and weaker: adversarial self-testing does not work, for the same
reason pen testing is a separate profession. Convenience is not an argument
and should not be used as one.

### The line, written before the first customer

- Paying changes nothing about what gets published.
- Seeds shown to a customer are never used in public assessment.
- Customers are disclosed.
- We never sell remediation consulting on what we grade.

---

## 7. Build decisions to make now

Cheap today, expensive or impossible later.

**Probes are never reused.** The moat is that a probe is unknowable from
published source. Delayed seed publication burns those probes permanently. So
seed derivation must draw from a space large enough that repeats never
happen, and must track what has been spent. A property of the seed module,
not a policy to add afterwards.

**Assessment is separable from publication.** Same engine, same profile,
results that never enter the index. If the pipeline entangles assessing with
publishing, separating them later is a refactor.

**Calibration linkage stored separately,** holdable without breaking
reproducibility of anything published.

**Licensing.** Not legal advice; confirm against the specific grant program's
current terms.

- *Scoring engine:* Apache-2.0. We want it embedded everywhere, and the
  express patent grant eases corporate adoption. Not AGPL; network copyleft
  repels exactly the consumers the strategy depends on.
- *Probe harness:* the operational asset. Reproducibility does not require
  publishing it, since engine plus observations plus seeds plus rubric let a
  third party verify both scoring and measurement. If published, AGPL-3.0.
- *Observation data:* CC-BY-4.0 rather than CC0. Still fully open, still a
  public good, and attribution is the mechanism by which being the reference
  instrument accrues to us instead of evaporating.
- *Judge labelled set:* CC-BY or CC0.
- *CLA required from any outside contributor from the first commit.*
  Dual-licensing later requires holding all the copyright.

---

## 8. Sequence

### Phase 1: publish the claim we already have

Highest credibility return, unblocks everything else, and is the grant
deliverable.

1. Extract the scoring engine as a standalone package with no I/O.
2. Publish observation records with the three digests attached.
3. Publish the judge labelled set, prompt, fencing scheme, and the
   seven-structure comparison including the panel result.
4. Implement delayed seed disclosure with permanent retirement.
5. Commission human review of a stratified sample of the judge set.

**Exit gate:** a third party can recompute every published score from
published artifacts without contacting us.

### Phase 2: agent profile and population

6. Build the population frame from the official registry API across chains.
7. Define and publish the probeable-subject filter and the resulting count.
   Nobody has a defensible population definition; publishing one is a
   standalone contribution.
8. Agent profile consuming declared-endpoint probing as evidence.
9. Endpoint domain verification against
   `/.well-known/agent-registration.json`, whose `registrations` entry must
   match the on-chain agent. Mechanical, cheap, run by nobody.
10. Track registry `status` changes; entries can move to deprecated or
    deleted, and a rating on a subsequently denylisted subject needs a
    defined fate.
11. Register as a validator and begin writing `validationResponse` calls.

**Exit gate:** ratings published into the Validation Registry, traceable to
published evidence.

### Phase 3: calibration

Moved up from last. The only asset both defensible and hard to reproduce, and
it cannot be rushed, only started earlier. Begin collecting outcome linkage
during phase 2 even though analysis lands later.

12. Tie at least one gate threshold to a measured outcome.
13. Replace provisional constants with calibrated ones and version the
    profile.

### Phase 4: time and vantage

14. Scheduled reprobe with published drift series. The evidence model already
    distinguishes twenty probes in a day from twenty over twenty days, so the
    machinery exists. Drift is the pain users name unprompted, and a
    longitudinal series compounds and cannot be caught up on by a later
    entrant.
15. Multi-vantage and multi-identity probing. A subject answering differently
    to a branded client than an unbranded one is itself a finding, and it
    closes a limit we currently only disclose.

### Later, if demand appears

16. MCP disagreement analysis as a standalone research artifact: how often
    manifest-derived and behaviour-derived ratings disagree, and in which
    direction. The expected headline is a well-tiered server with clean
    sandbox behaviour that obeys an instruction embedded in its input.
17. Private assessment mode.
18. Credentialed harness program with maintainers, if coverage ever becomes
    the constraint. Deprioritised: coverage is not the goal, and any
    participation policy must state publicly that participation cannot raise
    a score, only expand coverage.

---

## 9. Funding

Retro Funding is retroactive: build first, apply with evidence of completed
work and adoption. Analytics platforms, explorers and security research are
funded categories, with L2BEAT and Etherscan as reference cases. Nothing to
pitch until the thing exists, which suits this project.

Grants are episodic, not runway. One-time distributions, no vesting, no
obligations, amounts vary, rounds get rescoped. Spread across programs rather
than betting on one.

**Build as if revenue never appears.** The grant version and the paid version
share everything except delivery, so there is no wasted work in either
direction and no moment requiring a pivot. Revenue is upside, not the plan.

---

## 10. Open questions

- Is the injection control arm robust against a tool that echoes only when
  handed instruction-shaped input? We assume echo behaviour is
  input-independent and have not tested it.
- What is the minimum published population where a cohort prior means
  anything? Shrinkage toward a prior computed from 70 subjects is doing
  something, but it is not obvious what.
- Services like RelAI auto-submit `successRate` and `responseTime` feedback
  after every paid relay call. High-volume automated first-party feedback is
  exactly the low-information signal shrinkage discounts. Check whether it is
  already distorting cohort priors before calibrating against them.
- How does a gate transfer from a server to the agent that declares it? An
  agent routing payments while exposing an injectable tool is a different
  risk than the same server in a catalog. The transfer function is genuinely
  ours to design.
- Does a rating attach to the subject, the endpoint, or the version? Remote
  servers change silently behind stable URLs. The identity model needs to be
  explicit.
- If major clients absorb tool distribution into their own vetted
  directories, does our output become an input to their review process rather
  than a public index? Different product, different buyer, worth deciding
  whether we would take it.
- Employer disclosure covers the current side project. Anything commercial,
  and anything touching x402 endpoint rating specifically, is a different
  conversation and needs answering before building toward it.

---

## 11. Settled, do not relitigate

- **Not building an MCP server index.** Server probing is evidence inside the
  agent profile. No standalone server ratings, no directory.
- **Not competing with Glama on coverage.** Different evidence surface,
  different question. We lose that framing and it is not the claim.
- **Not consuming Glama's probing as load-bearing evidence.** Their catalog
  metadata and scores can enter as `third_party_review` at 0.60 for
  enrichment and comparison. Behavioural evidence stays ours, because
  borrowed observations cannot carry the reproducibility guarantee and their
  coverage does not include arbitrary agent-declared endpoints.
- **Not tokenizing.** Staked validation needs reproducible measurement to
  slash against, and per-subject secret probes are deliberately not
  reproducible by third parties. A token also inverts the
  conflict-of-interest position that is the entire differentiator.
- **Not a freemium metered wall.** Wrong audience, and the corpus is open.
- **Not extracting a closed product from the public one.** The valuable part
  and the public part are the same part. Paid work is labour on unpublished
  subjects, not withheld data.
- **Not chasing more agent sources.** There are no hidden ones. Code on
  GitHub has no callable surface; agents advertised socially have no
  identifier or enumerable population.
- **Do not soften the withholding rate.** It is the product.
- **Do not let participation or payment influence a score in any direction.**
- **Do not cite vendor comparison blog posts as sources on competitors.**
