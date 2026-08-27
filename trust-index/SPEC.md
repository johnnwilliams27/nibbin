# Agent Trust Index - Build Specification

**Status:** v0.1 draft spec for implementation
**Target executor:** Claude Code
**Author:** John Williams
**Domain:** nibbin.* (confirm disposition of the prior project before naming)

---

## 0. How to use this document

This is a build spec, not a wish list. Sections 1–6 are context you need to make
correct decisions while implementing. Sections 7–17 are the actual build.
Section 18 defines the execution model: **five parallel tracks built by
subagents, converging through serial gates.**

Parallelize aggressively where the dependency graph allows it - the scoring
engine, contracts, API surface, and frontend all build against fixture data and
type contracts, not against the live index. Do not parallelize through a gate:
anything downstream of real chain data (calibration, tuning, comparative
analysis, on-chain publishing) is serial by nature and stays serial. A gate that
fails stops its track; it does not stop the others.

---

## 1. Open decisions (confirm before Stage 3)

These change the implementation. Defaults are marked; override in this file
before starting.

| Decision | Options | Default |
|---|---|---|
| Comparative analysis posture | Internal / published | **Published.** Accuracy and true comparison are the point. Section 11A. |
| Chains at launch | Base only / phased multi-chain | **All chains, phased serially.** Base first and fully verified, then Arbitrum, Optimism, Polygon, BNB, then the long tail. Section 18. |
| Index hosting | Local Postgres / hosted (Neon, Supabase) + Vercel / VPS | **Hosted Postgres + Vercel.** Matches existing stack, avoids ops burden. |
| License | MIT / Apache-2.0 / CC0 | **Apache-2.0** for code, **CC0** for data dumps and methodology. |
| On-chain publication | Anchor only / anchor + oracle | **Anchor + oracle.** Merkle root daily, plus a read-only score oracle on Base. Section 20. |
| Public attribution | Named / project-only | **Named.** Employer disclosure complete. |
| Project name | nibbin / new name | **Unresolved - blocks npm scope, contract names, whitepaper title.** Only the author can settle this. Check npm scope and domain availability before committing. |

---

## 2. Thesis

Agent reputation scores are unfalsifiable claims.

Seventeen-plus providers publish trust numbers for ERC-8004 agents, each computed
by private methodology from feedback that is measurably fabricated at scale. Every
one publishes a bare point estimate. None publishes uncertainty. None has ever
validated its scores against outcomes.

A consumer gating on `minimum_score: 80` cannot distinguish an 80 backed by 400
independent paying counterparties from an 80 backed by two wallets created the
same afternoon. Both render as 80.

**What we build:** a scoring system that treats low-information agents correctly
rather than pretending they are comparable to well-evidenced ones - via shrinkage
toward a prior, continuous reviewer weighting, and published confidence intervals
- and that is calibrated against real commerce outcomes so the claim that it works
is testable rather than asserted.

**Four differentiators, in order of strength:**

1. **Calibration.** Backtested against Olas and Virtuals ACP job outcomes with a
   published Brier score and reliability curve. No competitor has done this.
2. **Confidence as a first-class output.** Interval and effective sample size
   shipped with every score, on chain and off.
3. **Continuous reviewer weighting** instead of binary sybil flags. Low-quality
   reviewers dilute rather than trigger a threshold.
4. **Reproducible by construction**, including a published reviewer-quality graph
   that improves every other scorer rather than competing with them.

## 3. Problem evidence

Cite these in the whitepaper. Verify each independently against our own index
before publication - do not repeat any claim we have not reproduced.

### 3.1 Sybil feedback erases baselines rather than inflating them

Source: *"Can Trustless Agents Be Trusted? An Empirical Study of the ERC-8004
Decentralized AI Agent Ecosystem"* (arXiv 2606.26028, July 2026).

- Removing Sybil-flagged feedback causes the reputation baseline to disappear,
  not shift.
- 86.8% of affected agents on BSC retain **zero** valid feedback after removal.
- Ethereum shows median/mean inflation around 5.2 points among mixed cases.
- Paper recommends registries distinguish a **reserved placeholder identity**
  from a **live agent**; most registrations are placeholders.

**Implication for design:** most agents' evidence cannot support a confident
estimate, so uncertainty must be carried in-band and low-information evidence
must be down-weighted continuously (§11.0). Placeholder classification is a
prerequisite for honest coverage.

### 3.2 Reviewer wallets cluster in ways single-score systems hide

Claims published by an existing provider, **unverified - reproduce before citing**:

- An agent with ~1,500 five-star reviews where ~998 reviewer wallets were created
  the same day.
- A single wallet that reviewed 10,000+ agents at ~510/day.

These are falsifiable from public chain data. Reproducing or refuting them is
Stage 4's primary output.

### 3.3 Identity is transferable, so reputation is purchasable

ERC-8004 identities are standard ERC-721 tokens. An aged, clean-history agent
identity can be bought on a secondary market and immediately weaponized. Current
scores treat wallet age as uncheatable; **transfer history breaks that
assumption** and must be a separate signal from address age.

### 3.4 The spec itself concedes the gap

From EIP-8004 Security Considerations: Sybil attacks are possible and can inflate
the reputation of fake agents; the ERC cannot cryptographically guarantee that an
agent's advertised capabilities are functional or non-malicious.

A QuillAudits review of ERC-8004 recommends registration bonds with probationary
periods, **reputation aggregators that score reviewers as well as agents**, and
zk-proof identity uniqueness for high-stakes use.

### 3.5 Consumers are already gating money on single scores

Observed pattern in a production agent-wallet policy engine:

```json
{ "type": "REPUTATION_THRESHOLD",
  "rules": { "minimum_score": 80, "minimum_interactions": 100 } }
```

The caveats that appear on a provider's web UI ("limited data available") are not
present in the API response the policy engine consumes. **Our API must carry
confidence in-band, not in the docs.**

---

## 4. Competitive landscape

Seventeen-plus projects occupy the scoring slot. None publishes uncertainty,
and none has validated its scores against outcomes. Summary of the field:

| Project | Approach | Notable |
|---|---|---|
| RNWY | 0–100 trust, wallet age, reviewer clustering, soulbound identity | Largest index (~185K claimed). Free keyless API. Published weights. Numbers inconsistent across own pages (544K / 1.7M / 4.5M commerce jobs). No independent adoption found. Unretouched LLM edit instructions published in live ToS. |
| Verity Protocol | Brier Skill Scores across Economic/Solver/Governance verticals; writes back via `giveFeedback`; EAS-anchored | Closest to deterministic recompute-and-post model |
| 8k4 Protocol | IGGY-Score, ~107K agents, x402 pay-per-query | Paid access may carry usage rights |
| DJD Agent Score | 0–100 behavioral, 7 dimensions, sybil + velocity checks | Open source scoring engine, 298 tests |
| Agent Veil | Off-chain EigenTrust, graph-based, collusion resistance | CrewAI/LangGraph/AutoGen integrations |
| Helixa | 11-factor Cred Score, five tiers, $CRED staking | Token-coupled |
| Assay | Algorithmic 0–1000, stake-backed | Small index (~59 agents) |
| Mintware | EIP-712 gasless oracle, 100+ chains | Leaderboard-driven |
| ORIGIN | "Proof of Agency" 5-challenge gauntlet, soulbound certs | Cognitive challenges, not behavioral data |
| UFX / ERC-8183 | ReputationHook auto-writes job outcomes; AI evaluators | 208 Solidity tests, live on Base |

**Structural observation:** every one of these produces a score. The ERC-8004
community FAQ explicitly argues *against* single aggregate scores - that they
create monopolistic behavior, oversimplify context-dependent trust, and that trust
is a vector from one agent to another rather than a universal value. The field
built the thing the spec authors warned against.

**Our position:** we do publish a score - but ours carries its uncertainty,
its constants are tuned against real commerce outcomes, and every number is
recomputable by a stranger. We also publish the reviewer-quality graph as open
data, which improves the other seventeen rather than merely competing with them.
Where the community warned against single aggregate scores, our answer is
context-scoped scores with confidence, not no score at all.

---

## 5. Design principles

1. **Weight, do not gate.** Low-information evidence reduces influence
   continuously. Hard suppression applies only at the true floor (`n_eff < 0.5`
   or `placeholder`).
2. **Confidence in-band.** Every response carries interval and `n_eff` in the same
   object as the score, on chain and off. A consumer reading only `score` must
   still be handed its uncertainty.
3. **Calibrate, do not assert.** Every constant traces to a measured optimization
   against real outcomes. No hand-tuned magic numbers survive to production.
4. **Reproducible by construction.** Ship a `recompute` CLI that prints the full
   derivation for any agent from a locally built index.
5. **Describe conditions, not intent.** Emit `reviewer_cohort_same_day: 0.66`,
   never "sybil attack detected."
6. **No proprietary inputs in the serving path.** Third-party APIs are used for
   research comparison only, isolated in `/apps/jobs/comparison`. Nothing we
   publish may break when someone else changes their schema.
7. **Versioned methodology.** Every score carries `methodology_version`. Historical
   scores remain queryable at the version that produced them, and anchored roots
   are never rewritten.

## 6. Use cases

Each maps to a specific finding in Section 3.

### UC-1 - The escrow gate that shouldn't have fired
*Maps to 3.1, 3.5*

An ERC-8183 job poster sets `minimum_score: 80` for providers. Agent #X returns
82 from an existing provider. Under our index, Agent #X has six reviews from two
wallets, both created within 48 hours of each other, and zero commerce history.

- **Existing behavior:** returns 82. Job funds. Client has no signal.
- **Our behavior:** returns `score: 61, score_low: 44, score_high: 78,
  confidence: 0.11, n_eff: 1.4, coverage_tier: "thin"` - the two same-cohort
  reviewers are down-weighted, and the estimate shrinks hard toward the
  population prior rather than resting on their claim.
- **Value:** the client sees a plausible estimate *and* that it is nearly
  worthless. `meetsThreshold(minScore: 80, minConfidence: 0.5)` returns false on
  confidence, not on score. They can still proceed - but knowingly.

### UC-2 - The purchased identity
*Maps to 3.3*

Agent #Y has a wallet 800 days old and 40 positive reviews spanning nine months.
Age-weighted scoring rates it highly. Our transfer-history signal shows ownership
changed 11 days ago.

- **Our behavior:** `score` computed on post-transfer history only.
  `ownership_transferred_at`, `pre_transfer_reputation_excluded: true`,
  `effective_history_days: 11`.
- **Value:** reputation laundering via secondary-market identity purchase becomes
  visible without accusing anyone of anything.

### UC-3 - The reviewer nobody checked
*Maps to 3.2, 3.4*

A wallet has reviewed 10,000+ agents. Every agent it touched carries its
contribution in their score.

- **Our behavior:** publish the **reviewer graph** as a first-class dataset.
  Any consumer, including competing scorers, can query reviewer quality and
  exclude or downweight.
- **Value:** this is shared infrastructure. It improves every scorer rather than
  competing with them, which is the correct posture for a public good and the
  strongest grant narrative.

### UC-4 - The placeholder that looks like a business
*Maps to 3.1*

Most registered identities are reserved placeholders, not live agents. Nothing in
the registry distinguishes them, so directories and leaderboards count them as
participants and coverage statistics are inflated ecosystem-wide.

- **Our behavior:** classify `lifecycle_state` as `placeholder | registered |
  live | dormant` from metadata resolvability, endpoint liveness, and on-chain
  activity. Publish ecosystem statistics with placeholders excluded.
- **Value:** the arXiv authors recommended exactly this to the spec. Nobody has
  built it. It is small, cited, and a prerequisite for every honest coverage
  metric downstream.

### UC-5 - The agent defending itself
*Maps to 3.4*

Fake reviews can be directed *at* an honest agent by a third party. An agent
targeted by negative sybil reviews currently has no recourse.

- **Our behavior:** flags attach to the reviewer cohort, not the agent. Agent view
  shows "this agent's reviews include a cohort exhibiting X" - explicitly noting
  the agent may be beneficiary, victim, or uninvolved.
- **Value:** correctness, and it removes the largest defamation surface.

### UC-6 - The methodology audit
*Maps to 3.5*

A researcher or grant reviewer wants to verify our numbers.

- **Our behavior:** `npx agent-trust recompute --agent 1171 --chain base`
  prints every input, weight, intermediate value, and the final output, from a
  local index they built themselves.
- **Value:** "shows the math" as an executable claim rather than a marketing one.

---

## 7. Architecture

```
┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│  Chain RPC   │──▶│   Indexer    │──▶│  Postgres    │
│ (Base, etc.) │   │  (backfill + │   │  (canonical  │
└──────────────┘   │   poller)    │   │   store)     │
┌──────────────┐   └──────────────┘   └──────┬───────┘
│ IPFS gateway │──────────┘                  │
└──────────────┘                              ▼
                          ┌─────────────────────────────┐
                          │  Scoring engine (pure fns)  │
                          │  deterministic, versioned   │
                          └──────────┬──────────────────┘
                                     │
                ┌────────────────────┼────────────────────┐
                ▼                    ▼                    ▼
        ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
        │  REST API    │   │  Next.js UI  │   │ Data dumps   │
        │  + MCP       │   │              │   │ (CC0, JSON)  │
        └──────────────┘   └──────────────┘   └──────────────┘
```

**Stack:** TypeScript throughout. Next.js (App Router) + Postgres. `viem` for
chain access. No ORM heavier than Drizzle. **Foundry** (forge + anvil) for the
contracts and their tests. Scoring engine is a pure library with zero I/O so it
is unit-testable and publishable as a standalone npm package.

**`/packages/types` is built first and is the coordination contract for the
parallel tracks (§18):** `AgentSnapshot`, `ScoreResult`, API response envelopes,
and the oracle struct layouts live there. Every track imports it; no track
redefines it.

**Critical constraint:** the scoring engine must not read from the network. It
takes a materialized `AgentSnapshot` and returns a `ScoreResult`. This is what
makes third-party reproduction possible.

---

## 8. Contracts and chain data

ERC-8004 registries are per-chain singletons at identical addresses:

- **Identity Registry:** `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` (mainnets)
- **Reputation Registry:** `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` (mainnets)
- Testnet identity registry uses the `0x8004A818...` vanity prefix.

Deployed on Ethereum, Base, Arbitrum, Optimism, Polygon, Linea, Scroll,
Avalanche, BNB Chain, Celo, Gnosis, Monad, Abstract, Mantle, Soneium, Taiko, and
others. Confirm current addresses against `github.com/erc-8004/erc-8004-contracts`
at build time - do not hardcode from this document without verifying.

### Key interfaces

**Identity:** `register()`, `setAgentURI()`, `getMetadata()`, `setMetadata()`,
`getAgentWallet()`. Token URI resolves to a registration file (JSON, typically
IPFS) containing `name`, `description`, `services[]` (web/A2A/MCP/ENS/DID),
`x402Support`, `active`, `supportedTrust[]`.

**Reputation:** `giveFeedback(agentId, value int128, valueDecimals uint8, tag1,
tag2, endpoint, feedbackURI, feedbackHash)`, `revokeFeedback()`,
`appendResponse()`, `readFeedback()`, `readAllFeedback()`, `getSummary()`,
`getClients()`, `getLastIndex()`.

Note feedback is a **signed fixed-point value** (`int128` + decimals), not a
fixed 0–100 scale. Normalization is a methodology decision that must be
documented, not assumed.

**Validation:** `validationRequest()`, `validationResponse()`,
`getValidationStatus()`, `getSummary()`, `getAgentValidations()`,
`getValidatorRequests()`. **Note:** the Validation Registry is under active
revision with the TEE community. Index it, but do not build scoring dependencies
on its current shape.

---

## 9. Data model

```sql
-- Chains
chains(chain_id, name, rpc_url_env_key, identity_registry, reputation_registry,
       validation_registry, first_block, enabled)

-- Agents
agents(chain_id, agent_id, owner_address, agent_wallet, token_uri,
       registered_block, registered_at, last_seen_block,
       metadata_cid, metadata_resolved_at, metadata_status,
       name, description, services_json, supported_trust_json,
       x402_support, active_flag,
       lifecycle_state,               -- placeholder|registered|live|dormant
       PRIMARY KEY (chain_id, agent_id))

-- Ownership transfers (ERC-721 Transfer events) - critical for UC-2
agent_transfers(chain_id, agent_id, from_address, to_address, block, ts, tx_hash)

-- Feedback
feedback(chain_id, agent_id, client_address, feedback_index,
         value_raw, value_decimals, value_normalized,
         tag1, tag2, endpoint, feedback_uri, feedback_hash,
         block, ts, tx_hash, is_revoked, revoked_block,
         PRIMARY KEY (chain_id, agent_id, client_address, feedback_index))

-- Responses to feedback
feedback_responses(chain_id, agent_id, client_address, feedback_index,
                   responder, response_uri, response_hash, block, ts)

-- Validation records
validations(chain_id, request_hash, validator_address, agent_id,
            response, response_uri, response_hash, tag, last_update_block)

-- Reviewer wallets - the shared-infrastructure dataset (UC-3)
reviewer_wallets(chain_id, address,
                 first_seen_block, first_seen_ts, first_seen_source,
                 total_reviews, distinct_agents_reviewed,
                 max_reviews_single_day, repeat_review_rate,
                 funder_address, funder_cluster_id,
                 score_variance, mean_score_given,
                 last_computed_at)

-- Score outputs, versioned and immutable
scores(chain_id, agent_id, methodology_version, computed_at,
       score numeric NULL,             -- NULL is a valid, meaningful output
       suppression_reason text NULL,
       coverage_tier text,             -- none|thin|moderate|strong
       signals_json jsonb,             -- every input, for reproduction
       PRIMARY KEY (chain_id, agent_id, methodology_version, computed_at))

-- Indexer bookkeeping
index_cursors(chain_id, contract, last_processed_block, updated_at)
```

**Indexes:** `feedback(client_address)`, `feedback(chain_id, agent_id)`,
`agent_transfers(chain_id, agent_id)`, `reviewer_wallets(address)`,
`scores(chain_id, agent_id, computed_at DESC)`.

---

## 10. Indexer

### 10.1 Backfill

- Chunk `getLogs` by block range. Start at 2,000 blocks and halve on provider
  error until it succeeds; most free tiers cap log ranges.
- Persist `index_cursors` after every chunk. The backfill must be resumable
  after a crash without reprocessing.
- Rate-limit outbound RPC calls with a token bucket. Expect the Base backfill to
  take hours, not minutes.
- Cache every raw log to disk before parsing. Re-parsing must never require
  re-fetching.

### 10.2 Metadata resolution

- Token URIs are commonly `ipfs://<cid>`. Resolve via a configured gateway with
  a timeout and record failures rather than retrying indefinitely.
- `metadata_status` values: `resolved | unreachable | malformed | absent`.
- **Do not treat unreachable metadata as a negative signal about the agent.**
  It is a coverage signal. Record it as such.

### 10.3 Ownership transfers

Index ERC-721 `Transfer` events on the Identity Registry. This is what makes UC-2
possible and is absent from every competitor we surveyed.

### 10.4 Reviewer first-seen

For each distinct reviewer address, determine first activity. Use the earliest of:
first outbound transaction, first inbound transfer, or contract creation block.
Cache aggressively - this is the most expensive lookup in the system and the
value never changes.

### 10.5 Continuous polling

- Poll head every 30s. Process with a configurable confirmation depth (default
  20 blocks on Base) to tolerate reorgs.
- On reorg detection (parent hash mismatch), rewind the cursor by the
  confirmation depth and reprocess.
- Emit structured logs and a `/health` endpoint reporting per-chain lag in blocks
  and seconds.

**Gate:** total agents and feedback counts must match an independent source
(a block explorer's event count, or `getSummary()` calls sampled across 50 random
agents) within 0.1% before proceeding to Stage 4.

---

## 11. Scoring engine

Pure functions. No I/O. Input `AgentSnapshot`, output `ScoreResult`.

### 11.0 Core model: confidence-weighted estimation, not suppression

**Superseded design note:** an earlier draft made binary suppression the primary
output. That was wrong. Suppression is the degenerate case of the correct
estimator, not an alternative to it.

The right model is **shrinkage toward a prior**, fed by **continuous reviewer
weighting**.

```
posterior_score = (Σ wᵢ · vᵢ + k · prior) / (Σ wᵢ + k)
```

- `vᵢ` - normalized feedback value from reviewer `i`
- `wᵢ` - reviewer weight in `[0, 1]` from reviewer information quality (11.2)
- `prior` - cohort prior for the relevant context/tag. **The prior must be
  computed from high-weight evidence only** (weighted mean, or commerce-
  corroborated feedback where available). A naive population mean over a
  sybil-inflated pool poisons the very prior that thin agents shrink toward -
  the estimator would launder the attack it exists to resist.
- `k` - shrinkage constant, tuned by calibration (Section 12), never by taste

An agent with 2 low-weight reviews shrinks almost entirely to the prior. An agent
with 400 high-weight reviews barely moves. No threshold, no cliff.

**Suppression survives only at the true floor:** effective sample size
`n_eff = Σ wᵢ < 0.5`, or `lifecycle_state = placeholder`. Below that we have not
scored low, we have observed nothing, and `null` is the honest output.

### 11.1 Confidence is a first-class output

Every score ships with its uncertainty. No surveyed competitor does this.

```
n_eff       = Σ wᵢ                        # effective sample size
ci_95       = posterior interval width     # Beta/Normal posterior
confidence  = monotone transform of interval width, in [0,1]
```

**Confidence is derived from the posterior, not blended from a second ad-hoc
formula.** Diversity, time span, and commerce corroboration already act through
the weights; letting them act again through confidence double-counts them and
makes the number impossible to defend. One model, one uncertainty.

`72 ± 3 (n_eff 431)` and `72 ± 22 (n_eff 1.8)` share a point estimate and are
completely different facts. Competitors publish both as "72".

**API contract:** a consumer reading only `score` still receives `score_low`,
`score_high`, and `confidence` in the same object. `confidence` is never optional.

### 11.2 Reviewer weighting (continuous, not binary)

Reviewer weight replaces sybil flagging. Each signal yields a multiplier in
`(0, 1]`; weight is their product, floored at 0.01 rather than 0.

| Signal | Effect on weight | Rationale |
|---|---|---|
| Address age | Ramps 0.2 → 1.0 over 365 days | Time cannot be purchased |
| Cohort concentration | Down-weight by fraction of this agent's reviewers sharing a creation window | Coordinated cohorts dilute, not disqualify |
| Common funder | Strong down-weight when reviewers share a first funding source | Cheapest sybil tell |
| Review velocity | Down-weight reviewers exceeding plausible throughput | Bulk reviewers carry less signal each |
| Repeat interaction | Up-weight reviewers who returned to the same agent | Repeat business is expensive to fake |
| Commerce corroboration | Strong up-weight when the reviewer has an on-chain transaction with the agent | A review backed by a paid job is the best signal available |
| Portfolio diversity | Down-weight reviewers clustering on a single funder's agents | Detects review rings without naming them |

**Why weighting beats flagging:** no threshold to defend, graceful degradation,
handles the ambiguous middle, and it describes evidence quality rather than
asserting intent.

### 11.3 Context-scoped scores (trust is a vector)

The ERC-8004 community position is explicit: trust is a vector from one agent to
another, varying by domain. Feedback carries `tag1` and `tag2`. **Score per tag
cohort; the global score is a derived rollup, not the primary output.**

```
scores_by_context: { "code-review": {...}, "data-feed": {...} }
score_global: {...}   // rollup, always shown with the per-context breakdown
```

The one place where following the spec's stated preference is also the
differentiated product decision.

### 11.4 Time decay

Feedback from prior ownership epochs is excluded entirely (11.6). Within an epoch,
apply exponential decay with a half-life tuned by calibration. Do not pick 90 days
because it sounds right.

### 11.5 Coverage tiers (reported, not gating)

```
none      : n_eff < 0.5, or lifecycle_state = placeholder → score is null
thin      : n_eff < 5     → score present, wide interval, prominent in UI
moderate  : 5 ≤ n_eff < 25
strong    : n_eff ≥ 25, ≥ 90 days span, ≥ 10 distinct counterparties
```

### 11.6 Ownership epochs

Reputation does not survive a transfer. Any ERC-721 `Transfer` starts a new epoch.
Scores compute on the current epoch only. Prior-epoch history is retained and
displayed as labeled history - visible, not credited.

**Known limitation:** an operator moving an agent between their own wallets
(custody migration) is reset like a sale. Detect the benign case where cheaply
possible - destination wallet funded by the same funder, or bidirectional
transfer history with the source - and preserve the epoch with the linkage
recorded in `signals`. Otherwise accept the false reset and document the appeal
path; resetting an honest migrant is recoverable, crediting a laundered identity
is not.

### 11.7 Lifecycle classification

```
placeholder : metadata unresolvable/absent, no endpoints, zero feedback,
              zero outbound activity from agent wallet
registered  : metadata resolves, endpoints declared, no interaction history
live        : feedback, validations, or commerce activity within 90 days
dormant     : previously live, no activity in 180 days
```

Placeholders are excluded from ecosystem statistics and reported separately.
Their prevalence is itself a headline finding.

### 11.8 Cold start

A new legitimate agent is statistically indistinguishable from a placeholder.
Treating them identically is the most likely way this system is unfair.

Mitigations, strongest first:
- Validation Registry records (TEE attestation, zkML proof) substitute for
  reviewer volume and carry high weight when present.
- Owner-wallet reputation transfers partially: an operator with other well-scored
  agents lends prior weight to a new one.
- Declared, resolvable, live endpoints move an agent from `placeholder` to
  `registered` immediately - a zero-cost path out of the worst bucket.

Publish the cold-start path prominently. An agent that cannot see how to earn a
score will assume the system is rigged.

### 11.9 Adversarial robustness

Publishing the methodology means it can be optimized against. Real cost of
reproducibility, accepted, mitigated by signal selection.

**Prefer signals expensive to fake:** address age, ownership continuity, distinct
counterparty count, repeat interaction, commerce-corroborated reviews.
**Avoid signals cheap to fake:** raw review counts, raw averages, metadata
completeness, social follows.

Every signal in 11.2 must be justifiable on cost-to-forge grounds, documented per
signal on `/methodology`. Where a cheap signal is included, cap its contribution.

### 11.10 Feedback normalization

Feedback is a signed fixed-point value (`int128` + `uint8` decimals), **not a
fixed 0–100 scale**. Clients use different scales. Normalization is a documented
decision, not an assumption:

- Detect scale per `(client_address, tag)` pair from observed range.
- Normalize to `[0, 1]` within detected scale.
- Where scale cannot be inferred, exclude the feedback and count it in coverage as
  unusable rather than guessing.

### 11.11 Output shape

```ts
type ScoreResult = {
  methodology_version: string;
  computed_at: string;
  as_of_block: number;

  score: number | null;          // posterior point estimate
  score_low: number | null;      // 95% lower bound
  score_high: number | null;     // 95% upper bound
  confidence: number;            // [0,1], always present
  n_eff: number;                 // effective sample size

  coverage_tier: "none" | "thin" | "moderate" | "strong";
  lifecycle_state: "placeholder" | "registered" | "live" | "dormant";
  suppression_reason: string | null;

  scores_by_context: Record<string, ContextScore>;
  ownership_epoch: number;
  effective_history_days: number;

  signals: Record<string, number | string | null>;
  reviewer_weights: Array<{ address: string; weight: number }>;
  inputs_hash: string;
};
```

---

## 11A. Comparative analysis (apples-to-apples)

Goal is apples-to-apples accuracy, so use whatever source produces the most
faithful comparison.

**Two tracks, kept separate:**

1. **Methodology reproduction.** Implement published third-party formulas against
   our own index. Known published constants: sybil weights common funder 6×,
   inhuman velocity 5×, sweep pattern 3×, score clustering 1×; wallet age linear
   0→100 over 365 days; velocity threshold >50 agents/day; sweep threshold >100
   agents with negligible repeat rate.

2. **Live output comparison.** Pull third-party scores via their public APIs for
   the comparison set. Faster and truer than inferring their outputs.

**Engineering constraints (not legal ones):**
- Third-party API calls live only in `/apps/jobs/comparison`. Nothing in the
  serving path may depend on an external provider - their schema changes and
  their uptime must never affect our API.
- Snapshot every fetched value with a timestamp and their `methodology_version`
  if exposed. Their methodology can change retroactively; a diff without a
  timestamp is meaningless.
- Respect their rate limits. Cache aggressively; never re-fetch a snapshotted
  value.
- Comparison outputs are research artifacts in `/research`, never served from
  `/api/v1`.

**Report contents:** correlation, mean absolute difference, rank correlation,
disagreement set (where we suppress and they score, and vice versa), and
per-tier agreement. Then the decisive one: **which system's scores better predict
commerce outcomes** (Section 12). That is the only comparison that establishes
who is right rather than who is different.

---

## 12. Calibration

**Strongest differentiator in the project. No competitor has it.**

Every surveyed provider asserts a formula. None publishes evidence its scores
predict anything. We have ground truth: commerce job outcomes on Olas (Gnosis,
Base, Polygon, Optimism) and Virtuals ACP (Base) include completion, rejection,
and dispute results.

### Method

1. **Label set.** For each agent with commerce history, derive an outcome series:
   completed, rejected, disputed, abandoned.
2. **Temporal split.** Score using only data available before time `t`; evaluate
   against outcomes after `t`. Never evaluate in-sample.
3. **Metrics.**
   - Brier score for outcome prediction
   - Reliability curve: do agents scored 0.8 succeed ~80% of the time?
   - Discrimination: AUC on completed vs disputed
   - Calibration by coverage tier - are `thin` scores appropriately uncertain, or
     overconfident?
4. **Tune `k`, decay half-life, and reviewer weight curves by minimizing Brier**,
   not by intuition. Every constant in Section 11 must trace to this process.
5. **Baselines.** Report against raw mean, review count alone, wallet age alone.
   If we cannot beat "count the reviews," we have built nothing and must say so.
6. **Competitive calibration.** Run the same evaluation on third-party scores from
   11A. This is the headline result either way.

### Publication

Reliability diagram and Brier score on `/methodology`, refreshed monthly, with
evaluation code in the repo. Converts "we show the math" from a slogan into a
testable claim.

**Honest failure mode and fallback:** commerce coverage may be too sparse for
meaningful calibration on Base alone. That is a publishable finding, and it is
the primary reason multi-chain matters - more chains, more labeled outcomes.
Until calibration has adequate power, constants ship as **provisional**: chosen
by sensitivity analysis (report score stability across a swept range), labeled
`provisional: true` in the methodology page and API meta, and replaced the
moment the label set supports tuning. Never present an untuned constant as a
tuned one.

---
## 13. API

Base path `/api/v1`. JSON only. CORS open for GET.

| Endpoint | Purpose |
|---|---|
| `GET /agents/:chain/:id` | Full agent record with score object |
| `GET /agents/:chain/:id/feedback` | Paginated feedback with reviewer quality inline |
| `GET /agents/:chain/:id/recompute` | Full derivation: every input, weight, intermediate |
| `GET /reviewers/:chain/:address` | Reviewer profile - the shared dataset (UC-3) |
| `GET /reviewers/:chain/:address/agents` | Every agent this reviewer touched |
| `GET /stats/:chain` | Ecosystem stats, placeholders excluded and reported separately |
| `GET /dumps` | Index of CC0 bulk data dumps |
| `GET /health` | Per-chain indexer lag |
| `POST /mcp` | MCP server (JSON-RPC 2.0) exposing the read tools |

**Response envelope:**

```json
{
  "data": { },
  "meta": {
    "methodology_version": "0.1.0",
    "indexed_through_block": 12345678,
    "indexed_through_ts": "2026-08-27T00:00:00Z",
    "coverage_disclaimer": "..."
  }
}
```

`meta.coverage_disclaimer` is mandatory and non-empty when `coverage_tier` is
`none` or `thin`. This is the fix for the failure mode in 3.5.

### Rate limiting

- Anonymous: 60 req/min per IP, burst 20.
- Free API key: 600 req/min.
- `/recompute` and `/reviewers/:address/agents`: 10 req/min regardless of key -
  these are expensive.
- Return `429` with `Retry-After` and `X-RateLimit-*` headers.
- **Bulk data dumps are unlimited and unauthenticated.** This is what preserves
  the public-good claim: rate limits protect the hosted endpoint, dumps ensure
  nobody is gated from the data.

### Dump format

`jsonl.gz` per table per chain, plus a `manifest.json` carrying schema version,
row counts, SHA-256 checksums, `indexed_through_block`, and
`methodology_version`. The manifest hash is what gets anchored (§20.1).

### MCP tools

`get_agent_score`, `get_agent_feedback`, `recompute`, `get_reviewer_profile`,
`compare_agents`, `get_ecosystem_stats`, `get_proof`. Same envelopes as REST;
same in-band confidence rules.

### Versioning and deprecation

`/api/v1` is stable once published. Breaking changes ship as `/api/v2` with v1
maintained for 6 months and a `Deprecation` header. Methodology versions change
score values, never response shapes.

---

## 14. Frontend

Next.js App Router, server components for data fetching, minimal client JS.

### 14.1 Design process (required, not optional)

Before writing any UI code, produce a short design plan: a token system (4–6
named palette hexes, two-plus typefaces by role, layout concept, and one
signature element), then critique it against the brief below and revise anything
that reads like a generic default before building. Build only after that pass.

**Subject grounding:** this is an instrument for reading evidence about machine
counterparties. The register is metrology - a measurement instrument's honesty -
not a fintech dashboard and not a crypto landing page.

**The signature element is the interval.** Every score renders as a point
estimate inside its 95% band with `n_eff` beside it - think forest plot, not
gauge. This one element carries the entire product thesis: two agents at "72"
must look obviously different when one band is ±3 and the other is ±22. Spend
the design boldness here; keep everything around it quiet.

**Explicitly avoid:**
- Score gauges, dials, rings, and letter grades - they assert judgment.
- Green/red trust-light color semantics. Tier and confidence are encoded by
  band width, position, and a neutral tier label - never by a verdict color.
  (Also an accessibility requirement, not only a rhetorical one.)
- The stock AI-design looks: warm-cream + serif + terracotta accent; near-black
  + single acid accent; broadsheet hairline-rule pastiche. Choose a palette
  derived from the instrument register instead, and state the choice in the
  design plan.
- Decorative motion. Permitted motion: interval bands drawing in on load, and
  focus/hover states. Respect `prefers-reduced-motion`.

**Type:** numbers are the content, so the data face is chosen first - tabular
figures mandatory everywhere a number appears, including the interval labels. A
characterful display face may appear in headings only. Body face optimized for
dense technical prose.

**Quality floor:** responsive to mobile, visible keyboard focus, WCAG AA
contrast, semantic HTML for every data table, reduced motion respected.

### 14.2 Pages

- `/` - what this is, in plain language. State the thesis, show one live worked
  example of the interval rendering, link to methodology.
- `/agent/[chain]/[id]` - the interval, context scores, coverage tier, lifecycle
  state, ownership epochs, reviewer-weight breakdown, and a "recompute this"
  link to the derivation. **When suppressed (`score: null`), render the
  suppression reason and the evidence summary; no number appears anywhere on the
  page, not even greyed out.**
- `/reviewer/[chain]/[address]` - reviewer profile: weight, its component
  multipliers, agents touched.
- `/methodology` - every formula, weight curve, and constant, each marked tuned
  or provisional, with worked examples and the calibration results (reliability
  diagram, Brier score) once available.
- `/stats` - ecosystem view, placeholders separated.
- `/dumps` - downloads, schema docs, checksums.

### 14.3 Copy rules

- Words exist to make the instrument legible, not to sell it. Describe what a
  thing measures in plain terms; no superlatives, no "trust layer for the
  agentic economy" register.
- Conditions, never intent: "38 of 40 reviewer wallets were created within a
  24-hour window" - never "sybil attack detected."
- Active voice; a control names exactly what it does; the same action keeps the
  same name through the whole flow.
- Errors and empty states say what happened and what to do next, without
  apologizing and without vagueness.
- Every displayed number links to its derivation.
- All prose is proofread by a human before launch - the legal pages twice. In
  this field, shipped-unread AI copy is a documented competitor failure; reading
  like an engineer wrote it is a differentiator.

---

## 14A. Voice and anti-tell standard

Applies to every word and pixel the project ships: site copy, whitepaper,
research docs, README, methodology prose, API docs, error messages, release
notes, and social posts. In this field, machine-register prose is a documented
competitor failure; reading like a person is a differentiator, and it has to be
enforced mechanically because the content will be drafted by an AI.

### Verbal: banned outright

- Em-dashes. Use commas, colons, periods, or parentheses.
- The inflation vocabulary: delve, leverage, robust, seamless, comprehensive,
  holistic, cutting-edge, game-changing, revolutionize, unlock, empower,
  supercharge, elevate, streamline, harness, landscape (as in "the evolving
  landscape"), journey, dive deep, at its core, in essence.
- The contrast tic: "It's not just X, it's Y." "X isn't merely A; it's B."
- Rule-of-three rhythm as a default sentence shape. One triad per page maximum,
  and only when the content genuinely has three parts.
- Rhetorical questions as headers or transitions.
- Exclamation marks. Emoji anywhere, including commit messages and docs.
- Bolded-lead-in bullet lists as a substitute for paragraphs in prose pages.
  Bullets are for genuinely enumerable content: parameters, steps, tables.
- Openers that survey the world before saying anything: "In today's...",
  "As AI agents become increasingly...", "The rise of...".
- Hedging boilerplate that carries no content: "it's important to note",
  "it's worth mentioning", "generally speaking".
- Marketing self-reference: "we're excited to", "we believe", "our mission".
  State what the thing does.

### Verbal: required

- Sentence case for all headings.
- Concrete numbers over intensifiers: "indexes 41,208 agents" not "indexes a
  massive number of agents".
- Short declarative sentences. One idea per sentence. Active voice.
- Claims carry their evidence or a link to it, or they come out.
- Every page passes a read-aloud test by a human before publish; the whitepaper
  and legal pages get two passes by different sessions with fresh context.

### Visual: banned

- Purple-to-blue gradients, glassmorphism cards, floating 3D blobs, particle
  backgrounds, generated hero illustrations, mascots.
- Emoji as icons. Icon sets used at decoration density; icons appear only where
  they disambiguate an action.
- Landing-page section rhythm (hero, three-feature row, logo wall, CTA banner).
  This is an instrument with documentation, not a launch page.
- The three stock AI looks named in §14.1, plus any verdict-color semantics.

### Visual: required

- The token system from the §14.1 design plan is the only source of color and
  type values. No inline one-off hexes.
- Wordmark logo, plain type, no gradient. Favicon is the wordmark initial.
- Charts follow the same rules as prose: labeled axes, units, source and
  as-of block on every figure, no decorative 3D, no dual axes.

### Enforcement

- A lint script over site copy and docs greps for the banned vocabulary and
  em-dashes; CI warns on hits. Mechanical, imperfect, still worth having.
- The §18 lead agent reviews all public-facing prose against this section
  before any publish milestone, including the A4 early publication.

### Analytics

None, or self-hosted only. A neutrality product does not ship third-party
trackers. If usage data is needed, count requests server-side and say so on the
privacy page in one sentence.

---

## 15. Infrastructure, keys, and costs

### Required accounts and keys

| Service | Purpose | Tier | Est. cost |
|---|---|---|---|
| Alchemy **or** QuickNode | Base RPC, archive access for historical logs | Paid tier likely required for backfill | ~$50/mo |
| Basescan API key | Contract verification, supplementary lookups | Free | $0 |
| Neon **or** Supabase | Postgres | Free tier for v1, paid at scale | $0–25/mo |
| Vercel | Hosting | Hobby/Pro | $0–20/mo |
| Pinata **or** web3.storage | IPFS gateway for metadata resolution | Free tier | $0 |
| Upstash Redis | Rate limiting, first-seen cache | Free tier | $0 |
| Sentry (optional) | Error tracking | Free tier | $0 |

Add Arbiscan/Optimistic Etherscan/Polygonscan keys when those chains are added.

**Free RPC tiers will not complete the backfill.** Budget for one paid month.

### Crypto wallets and funding

The read path needs no wallet. The publish path (anchoring + oracle, §20) needs
exactly one dedicated hot signer per chain - no MPC, no custody product, nothing
that holds value.

- Create a fresh wallet per chain. Never reuse a personal wallet.
- Fund the Base signer with ~$50 equivalent: anchoring is ~$0.02/day and oracle
  batches a few dollars/day at steady state. Refill on the 14-day-runway alert.
- The signer key exists only in the jobs runner environment, with a per-day
  transaction cap and an allowlist of exactly the AnchorRegistry and ScoreOracle
  addresses (§20.4).
- Contract deployment uses a separate deployer wallet, emptied after deploy.

### Environment variables

```
DATABASE_URL=
RPC_URL_BASE=                 # pattern: RPC_URL_{CHAIN}, one per enabled chain
RPC_URL_ARBITRUM=
ETHERSCAN_API_KEY_BASE=       # pattern: ETHERSCAN_API_KEY_{CHAIN}
IPFS_GATEWAY_URL=
IPFS_GATEWAY_TOKEN=
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
CONFIRMATION_DEPTH=20
METHODOLOGY_VERSION=0.1.0

# jobs runner ONLY - never present in the web app environment
PUBLISHER_PRIVATE_KEY_BASE=
ANCHOR_REGISTRY_ADDRESS_BASE=
SCORE_ORACLE_ADDRESS_BASE=
```

Never commit `.env`. Use Vercel environment variables in production and a
`.env.example` with empty values in the repo.

---

## 16. Security

### Threat model

This is a read-only public data service. The attack surface is narrower than most
crypto projects, but not zero.

| Risk | Mitigation |
|---|---|
| RPC key exfiltration | Server-side only. Never expose to client. Rotate on any leak. Set provider-side domain allowlists. |
| SQL injection | Parameterized queries only via Drizzle. No user-supplied ORDER BY, LIMIT, or filter expressions. |
| Resource exhaustion via expensive queries | Hard caps on pagination (max 100), query timeouts (5s), separate rate limits on `/recompute` and reviewer-graph endpoints. |
| Malicious IPFS payloads | Cap response size (256KB), enforce timeouts, validate against a schema, never `eval` or render raw HTML from metadata. Treat all metadata as untrusted user input. |
| XSS via agent name/description | Escape everything. Agent-controlled strings are attacker-controlled strings. |
| Defamation exposure from flags | Language discipline (Section 13). Describe observable conditions with numbers. Never assert intent. Include the "beneficiary, victim, or uninvolved" framing. Provide a documented correction request process. |
| FCRA-adjacent exposure | Terms must prohibit use for creditworthiness, employment, insurance, or housing decisions about natural persons. State plainly that this is not a credit bureau and outputs are not credit scores. |
| Reorg-induced bad data | Confirmation depth, parent-hash validation, cursor rewind. |
| Dependency supply chain | Lockfile committed. Dependabot on. Minimal dependency surface - no ORM/framework we do not need. |
| Signer compromise (future phase only) | Isolated service, spend caps, contract allowlist, no key in the web process. |

### Legal pages required before public launch

- Terms of service (drafted or reviewed by a human, proofread)
- Privacy policy
- Methodology page with version history
- Correction request process

---

## 17. Whitepaper

Publish after Stage 6, not before. Structure:

1. **Abstract** - the thesis in 150 words: uncertainty in-band, reviewer
   weighting over flagging, and calibration against outcomes.
2. **Background** - ERC-8004 registries, what they do and do not guarantee.
3. **The measurement problem** - Section 3 findings, each independently
   reproduced against our index with our own figures. Cite the arXiv study;
   present our reproduction alongside it.
4. **Why scores fail** - the erasure result. Removing bad feedback does not lower
   scores, it removes the basis for them. Show the distribution.
5. **The estimator** - shrinkage, reviewer weighting, confidence; Section 11.
   Include the calibration results (Section 12) as the evidence it works.
6. **The reviewer graph** - publish the dataset and the analysis.
7. **Methodology** - complete, with worked examples and a link to the recompute CLI.
8. **Limitations** - what we cannot see. On-chain data does not reveal intent,
   off-chain work quality, or identity. Say so plainly.
9. **Reproduction** - exact steps to rebuild every number in the paper.

**Do not publish any claim we have not reproduced ourselves**, including the
reviewer-clustering figures in 3.2. If our reproduction contradicts a published
claim, report our figure and note the discrepancy neutrally.

---

## 18. Execution model: parallel tracks, serial gates

Five tracks run in parallel, each owned by a dedicated subagent. Tracks build
against `/packages/types` and committed fixtures, not against each other's
work-in-progress. Convergence stages are serial because their inputs are.

### 18.0 Subagent protocol

- **Lead agent** builds `/packages/types` and the fixture set first - the
  coordination contract every track imports. Types change only by lead-agent
  commit; a track needing a type change requests it, never forks it.
- **One track per subagent, one directory ownership per track.** No two agents
  edit the same package. Cross-track needs go through types and fixtures.
- **Fixtures are the interface.** Track A emits real `AgentSnapshot` fixtures as
  soon as data flows; until then, Tracks B/C/D run on synthetic fixtures
  committed at kickoff. Synthetic fixtures must include the pathological cases:
  placeholder, thin, same-day cohort, transferred identity, unparseable scale.
- **A failed gate stops its own track only.** The integration agent (lead) owns
  the convergence stages and refuses to start one until its input gates pass.
- Each subagent maintains a running `NOTES.md` in its track directory: decisions
  made, deviations from spec, things tried. The lead reads these at every
  convergence.

### 18.1 Parallel tracks

**Track A - Data spine** (`/packages/indexer`, `/packages/db`) - serial within:

| Stage | Deliverable | Gate |
|---|---|---|
| A1 | Schema, migrations, chain config | `pnpm migrate` clean |
| A2 | Base Identity backfill + ERC-721 Transfers | Count within 0.1% of independent source; resumable after `kill -9` |
| A3 | Base Reputation backfill + IPFS metadata | Reconciles against `getSummary()` for 50 sampled agents |
| A4 | Reviewer first-seen + funder resolution | §3.2 claims reproduced or refuted → `/research/reviewer-analysis.md` |
| A5 | Validation Registry indexer | Records parse; schema treated as unstable |
| A6 | Commerce ingest (Olas + Virtuals ACP) | Outcome labels joined; coverage % reported |

**→ Milestone after A4 - publish early.** The reviewer-analysis findings are the
first public artifact: post to the ERC-8004 Telegram and Farcaster with the data
and the code, before the rest of the build completes. This is simultaneously the
demand test, the distribution start, and the credibility deposit for the
whitepaper. Do not sit on it waiting for the full system.

**Track B - Scoring engine** (`/packages/scoring`) - on fixtures from day one:

| Stage | Deliverable | Gate |
|---|---|---|
| B1 | Estimator: shrinkage, reviewer weights, contexts, epochs, lifecycle | 100% branch coverage on classification |
| B2 | Golden tests + determinism harness | Byte-identical output across two machines/OSes |

**Track C - Contracts** (`/contracts`, Foundry):

| Stage | Deliverable | Gate |
|---|---|---|
| C1 | `AnchorRegistry` + tests | Inclusion proof verifies on anvil |
| C2 | `ScoreOracle` + tests | `meetsThreshold` fails closed on unknown/stale/tier-0; gas measured |
| C3 | Publish source for community review (ERC-8004 Telegram) | Posted; feedback window elapsed |

**Track D - Surface** (`/apps/web`):

| Stage | Deliverable | Gate |
|---|---|---|
| D1 | REST API + MCP + rate limiting on fixture-backed handlers | `/recompute` matches scoring library byte-for-byte on fixtures |
| D2 | Frontend per §14, on mocked API | Design plan critiqued per 14.1; suppressed agents render no number (verified by grep of rendered output); intervals render for every score |

**Track E - Ops** (CI, environments):

| Stage | Deliverable | Gate |
|---|---|---|
| E1 | CI: typecheck, lint (incl. `Date.now` ban in scoring), tests, golden diffs, secret scanning | Red build blocks merge |
| E2 | Environments per §21 | Staging serves mainnet data with auth gate |

### 18.2 Convergence (serial - real data required)

| Stage | Deliverable | Inputs | Gate |
|---|---|---|---|
| G1 | Scoring wired to live index; full Base recompute | A1–A4, B | Sampled `/recompute` output reconciles against independently fetched chain state |
| G2 | Calibration harness + report | A6, G1 | Brier + reliability curve; beats all three trivial baselines, or documented failure with provisional-constant fallback (§12) |
| G3 | Constant tuning | G2 | Every constant traces to an optimization run or is labeled provisional |
| G4 | Comparative analysis (§11A) | G1, G3 | `/research/comparative-analysis.md` incl. competitive calibration |
| G5 | Continuous poller live | G1 | Survives simulated reorg; lag under 60s for a 24h soak |
| G6 | Anchoring live on Base | C1, G3, E2 | Randomly chosen historical score verifies via published proof endpoint |
| G7 | Oracle publishing live on Base | C2, G6 | On-chain reads match API for a 100-agent sample; batch gas within budget |

### 18.3 Chain expansion (serial per chain; Track A repeats A2–A6)

| Phase | Chains | Rationale |
|---|---|---|
| X1 | Arbitrum | Second-largest EVM agent population; validates chain abstraction |
| X2 | BNB Chain | Largest agent count (~44K); highest sybil density per §3.1 - the most valuable comparison set |
| X3 | Ethereum mainnet | Highest-value agents; archive access cost is the constraint |
| X4 | Optimism, Polygon | Olas commerce lives here - directly expands the calibration label set |
| X5 | Monad, Linea, Scroll, Avalanche, Celo, Gnosis, Abstract, Mantle, Soneium, Taiko | Long tail; batch as capacity allows |

**Per-chain gate:** counts reconcile within 0.1%; cross-chain identity linkage
(same owner wallet across chains) computed and reported; oracle deployment per
chain only after its index passes.

### 18.4 Publication

| Stage | Deliverable | Gate |
|---|---|---|
| W | Whitepaper (§17) | Every figure reproducible via documented steps from a fresh index; calibration section present (tuned or provisional, stated plainly) |

---

## 19. Non-goals

Explicitly out of scope. Adding any of these expands the project past what one
person can maintain and weakens the public-good positioning.

- A token. This project does not need one and issuing one creates securities
  exposure and undermines the neutrality claim.
- A marketplace or job board.
- Writing to the Reputation Registry. We read and analyze; we do not add to the
  feedback pool we are auditing.
- Agent identity issuance or soulbound tokens.
- Payments, x402 integration, or anything touching settlement.
- LLM-based scoring. Every signal must be deterministic and reproducible.
- Index size as a marketing metric. Chains are added for calibration coverage
  and comparison power (§18), each fully reconciled before the next - never for
  a bigger number on the homepage.

---

## 20. On-chain publication

Two on-chain artifacts. Both ship.

### 20.1 Merkle anchoring (integrity)

- Daily job serializes the full scores table for a methodology version into a
  canonical, deterministically ordered dump.
- Leaves: `hash(chain_id ‖ agent_id ‖ methodology_version ‖ inputs_hash ‖
  score ‖ score_low ‖ score_high ‖ confidence ‖ n_eff)`.
- Root, dump URI, and dump SHA-256 written to `AnchorRegistry` on Base:
  `anchor(bytes32 root, string dumpURI, bytes32 dumpHash, string methodologyVersion)`.
- Public dump at `/dumps` is the preimage set. Any historical score is verifiable
  with an inclusion proof.
- `GET /agents/:chain/:id/proof?date=` returns the Merkle path.

Cost: one transaction/day, roughly $0.02 on Base.

### 20.2 Score oracle (composability)

A read-only oracle so ERC-8183 hooks and other contracts can gate on our output
mid-transaction without an API call.

**Critical design decision: the oracle must publish uncertainty, not just a
score.** An oracle returning a bare number recreates the failure mode this whole
project exists to fix.

```solidity
struct AgentScore {
    int32   score;          // fixed-point, -1 sentinel for null
    int32   scoreLow;
    int32   scoreHigh;
    uint16  confidence;     // basis points
    uint32  nEff;           // fixed-point effective sample size
    uint8   coverageTier;   // 0=none 1=thin 2=moderate 3=strong
    uint8   lifecycleState;
    uint32  ownershipEpoch;
    uint64  asOfBlock;
    uint32  methodologyVersion;
}

function getScore(uint256 chainId, uint256 agentId)
    external view returns (AgentScore memory);

function meetsThreshold(
    uint256 chainId, uint256 agentId,
    int32 minScore, uint16 minConfidence, uint8 minCoverageTier
) external view returns (bool);
```

`meetsThreshold` exists so integrators cannot accidentally read only `score`.
A threshold check requires naming a confidence floor. **Fail closed:** unknown
agent, stale data, or `coverageTier == 0` returns false.

**Staleness:** `asOfBlock` is public and every read is caller-checkable. Publish a
recommended maximum age in the integration docs. Do not enforce it on chain -
integrators own their risk tolerance.

**Write cadence:** batch. Push only agents whose score, tier, or confidence
changed materially since last publication (configurable epsilon). Full refresh
weekly. Expect a few dollars a day on Base at steady state, more during backfill.

### 20.3 Contract scope and safety

- `AnchorRegistry`: append-only, single owner-gated `anchor()`, no upgradeability,
  holds no funds. Under 100 lines.
- `ScoreOracle`: owner-gated batch writer, public reads, no funds, no
  upgradeability. Deploy a new instance on methodology major-version bumps rather
  than mutating semantics under integrators.
- Publish both contracts before deploying and invite review in the ERC-8004
  Telegram. Free, fast, and it doubles as distribution.

### 20.4 Signer

Dedicated wallet per chain, funded with ~$50 equivalent. Held in an isolated job
runner with a per-day transaction cap and an allowlist of exactly the two
contract addresses. Never in the web process. Never a personal wallet. Alert when
balance drops below 14 days of runway.

### 20.5 Explicitly not doing

Writing to the ERC-8004 Reputation Registry via `giveFeedback`. We cannot audit a
feedback pool we contribute to. This stays a non-goal permanently.

---

## 21. Environments

Three environments. Never share a database or an RPC key between them.

| | Local | Staging | Production |
|---|---|---|---|
| Chain | Base Sepolia | Base mainnet | Base mainnet |
| Registry addresses | `0x8004A818...` testnet prefix | mainnet | mainnet |
| Database | Local Postgres (Docker) | Separate Neon branch | Neon primary |
| RPC key | Free tier | Separate paid key | Separate paid key |
| Indexer | Manual runs | Continuous, may lag | Continuous, alerted |
| Public API | Off | Auth-gated | Open + rate limited |
| Anchoring | Off | Off | On |

**Rules:**
- Production database credentials never exist on a developer machine.
- Staging runs the same mainnet data so scoring changes can be diffed against
  production output before deploy. This is the single most valuable use of
  staging in this project.
- A methodology version bump requires a staging diff report showing which agents
  changed tier and why, reviewed before production deploy.

### Repository layout

```
/packages/scoring        # pure, no I/O, published to npm, the auditable core
/packages/indexer        # backfill + poller
/packages/db             # schema, migrations, query layer
/apps/web                # Next.js frontend + API routes
/apps/jobs               # scheduled: recompute, dumps, anchoring, reconciliation
/packages/types          # shared contracts: AgentSnapshot, ScoreResult, envelopes
/contracts               # AnchorRegistry + ScoreOracle (Foundry)
/research                # comparative-analysis.md, reviewer-analysis.md
/docs                    # methodology, runbook, SECURITY.md
```

---

## 22. Determinism guarantees

This is the load-bearing technical requirement. If two people cannot compute the
same score from the same data, the entire premise fails.

- **No floating point in scoring.** Use integer or fixed-point decimal arithmetic
  throughout. Define rounding explicitly (round-half-up at a stated precision).
  Never compare floats.
- **No wall-clock reads inside the engine.** Time-dependent signals take an
  explicit `as_of_block` and `as_of_ts` from the snapshot. `Date.now()` must not
  appear in `/packages/scoring`. Enforce with a lint rule.
- **No map/set iteration order dependence.** Sort explicitly before any reduction.
- **Pinned toolchain.** `.nvmrc`, exact dependency versions, committed lockfile.
- **Canonical JSON** for `inputs_hash`: sorted keys, no whitespace, explicit
  number formatting.
- **Golden tests.** A fixture directory of `AgentSnapshot` inputs and expected
  `ScoreResult` outputs, committed. CI fails on any diff. These fixtures are the
  contract with anyone reproducing our work.

**Verification gate:** the same snapshot scored on two different machines with
different OSes must produce byte-identical `ScoreResult` JSON.

---

## 23. Operations

### CI/CD

On pull request: typecheck, lint, unit tests, golden score tests, migration
dry-run, build. On merge to main: deploy staging, run scoring diff against
production, publish report as a PR comment. Production deploy is manual and
requires the diff report to be reviewed.

### Scheduled jobs

| Job | Cadence | Purpose |
|---|---|---|
| Poller | continuous, 30s | Ingest new blocks |
| Reconciliation | daily | Re-verify counts against `getSummary()` for a random 100-agent sample; alert on >0.1% drift |
| Reviewer refresh | daily | Recompute reviewer_wallets aggregates |
| Score recompute | daily | Full recompute at current methodology version |
| Dump generation | daily | CC0 bulk export + checksums |
| Anchor | daily | Merkle root to Base |
| Metadata retry | weekly | Retry `unreachable` IPFS resolutions |

### Observability

Alert on:
- Indexer lag > 5 minutes on any chain
- Reconciliation drift > 0.1%
- Reorg depth exceeding confirmation depth
- Anchor job failure
- Anchoring wallet balance below 10 days of runway
- API 5xx rate > 1%
- Sudden change in the distribution of coverage tiers (indicates a scoring bug or
  a real ecosystem event; either warrants a look)

### Backup and disaster recovery

**The chain is the backup.** A full index rebuild from genesis is the recovery
path and takes hours, not days. Still:

- Daily Postgres snapshot with 30-day retention.
- Raw log cache retained separately so a rebuild does not require re-fetching
  from RPC (this is the expensive part).
- Published dumps are themselves an off-site copy of every score ever emitted.
- Document and **actually test** the rebuild once, before launch. An untested
  restore is not a restore.

### Incident response: a wrong score

1. Suppress the affected agent(s) immediately via a manual override table -
   suppression is always safe.
2. Publish a note on `/methodology` with the date range and scope.
3. Fix, bump methodology version, recompute.
4. Historical anchors stay. Do not rewrite history; publish a correction that
   references the anchored root that contained the error.

---

## 24. Security additions

Supplements Section 16.

### Secrets

- Vercel environment variables for production, `.env.local` for development,
  never in the repo. `.env.example` with empty values only.
- Rotate RPC keys quarterly and immediately on any suspected exposure.
- Provider-side restrictions on every key: domain allowlist for browser-facing,
  IP allowlist where the provider supports it.
- The anchoring signer key lives only in the jobs runner's environment. It is
  never present in `/apps/web`.
- Pre-commit secret scanning (gitleaks or equivalent) enforced in CI.

### Repository hygiene

- `SECURITY.md` with a responsible disclosure address and a 90-day policy.
- Branch protection on main; no direct pushes.
- Dependabot enabled; review and merge weekly.
- Signed commits if practical.

### Admin surface

There is no admin UI. The only privileged operations are the manual override
table and the anchor job, both executed via CLI against production with
credentials that exist in exactly one place. Every override is a row with an
author, a timestamp, and a written reason, and the reason is published.

### Legal checkpoints

Before public launch, in order:

1. Terms of service and privacy policy drafted, **read end to end by a human**,
   and proofread. Include the non-reliance clause, the prohibition on use for
   creditworthiness/employment/insurance/housing decisions about natural persons,
   and an explicit statement that this is not a credit bureau.
2. Defamation review of all flag language. Every string that describes a wallet
   or agent must state an observable condition with a number, never intent.

### Domain and DNS

If repurposing `nibbin.*`: decide whether the prior project is retired,
redirected, or moved to a subdomain **before** the whitepaper and npm package
names are fixed. Set up DNSSEC, HSTS, and a CAA record. Register the npm scope
early.

---

## 24A. Glossary

Precise meanings for terms the codebase and prose must use consistently.

- **Agent** - an ERC-8004 identity: one ERC-721 token in one chain's Identity
  Registry. The same operator on two chains is two agents until linked.
- **Reviewer / client** - the address that submitted feedback via
  `giveFeedback`. "Reviewer" in prose, `client_address` in code.
- **Weight (wᵢ)** - a reviewer's evidence-quality multiplier in (0, 1],
  product of the §11.2 signals, floored at 0.01.
- **n_eff** - effective sample size: the sum of reviewer weights for an agent
  within the current epoch and context. The denominator of trust.
- **Prior** - the high-weight-evidence cohort mean an estimate shrinks toward.
  Never a raw population mean (§11.0).
- **Score** - the posterior point estimate. Meaningless without its interval;
  never displayed or served without one.
- **Confidence** - a monotone transform of posterior interval width, in [0, 1].
  Not a separate formula.
- **Coverage tier** - none / thin / moderate / strong; a statement about how
  much evidence exists, not about the agent's quality.
- **Lifecycle state** - placeholder / registered / live / dormant; a statement
  about whether the identity is an operating agent at all.
- **Epoch** - the span between ERC-721 ownership transfers of an agent
  identity. Scores are computed within the current epoch only.
- **Suppression** - `score: null` with a reason. Applies only below the floor
  (`n_eff < 0.5` or placeholder). Suppression is an output, not an error.
- **Provisional** - a constant not yet tuned by calibration; labeled as such
  everywhere it appears (§12).
- **Tuned** - a constant traceable to a specific calibration optimization run.
- **Anchor** - the daily Merkle root of the score dump, written on chain
  (§20.1). Anchors are never rewritten.
- **Chain slug** - lowercase canonical name used in URLs and dumps (`base`,
  `arbitrum`); maps 1:1 to an EIP-155 chain id in the chains table.

---

## 25. Notes for the implementer

- The scoring engine is the intellectual core. Build it as a separate package with
  no dependencies on the app, publish it to npm, and make it trivially auditable.
- Everything in Section 3 marked "unverified" must be treated as a hypothesis to
  test, not a fact to cite.
- When in doubt about whether to emit a score, do not emit one.
- Verify contract addresses and interfaces against the official contracts repo
  before writing ABIs. This document may be stale by the time you run.
