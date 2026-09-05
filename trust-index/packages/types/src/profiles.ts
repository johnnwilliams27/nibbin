/**
 * Rating profiles: what "good" means for each kind of subject.
 *
 * One scoring engine, many rubrics. The estimator is the same shrinkage
 * posterior everywhere, because the statistics of "few noisy observations
 * about a thing" do not change with the thing. What changes is which
 * questions are worth asking and what evidence is allowed to answer them. An
 * MCP server can be measured for protocol conformance and cannot meaningfully
 * be asked about counterparty satisfaction; an on-chain agent is the reverse.
 * A profile is that difference, written down.
 *
 * Three rules a profile enforces, each of them a gameability defence:
 *
 * 1. `accepted_provenance` per dimension. A dimension that only accepts
 *    `measured` evidence cannot be moved by anyone writing reviews, because
 *    reviews are not admissible there at all. Availability and protocol
 *    conformance are like this on purpose.
 *
 * 2. `self_reported_cap` per dimension. Where a subject's own claims are
 *    admissible, they are capped as a share of the dimension's effective
 *    weight. A subject can describe itself; it cannot rate itself.
 *
 * 3. `min_dimension_coverage` per profile. The composite is withheld unless
 *    enough of the profile's weight actually produced a score, so a subject
 *    cannot earn a headline number by being evidenced on one cheap dimension
 *    and silent on the expensive ones.
 *
 * Adding a subject kind means adding a profile here. It does not mean touching
 * the engine, and a profile whose weights do not sum to 1 fails a test rather
 * than quietly renormalizing.
 */
import type { DecimalString } from "./fixed.js";
import type { Provenance, SubjectKind } from "./rating.js";

/**
 * Constants a profile or a dimension may override.
 *
 * Only constants that describe the EVIDENCE are overridable. The observer
 * weighting constants (age ramp, group penalty, concentration penalty,
 * velocity, provenance multipliers, weight floor) are deliberately not, because
 * an observer has one weight within one subject's score. Letting a dimension
 * re-weight an observer would give the same party two different voices in one
 * rating, which is incoherent and would be impossible to explain on a
 * methodology page.
 *
 * The motivating case is decay. A 120-day half-life is right for a reputation
 * signal and badly wrong for availability, where a measurement from three
 * months ago says almost nothing about whether the endpoint answers now.
 */
export type RatingConstantOverrides = {
  shrinkage_k: DecimalString;
  decay_half_life_days: DecimalString;
  suppression_neff_floor: DecimalString;
  thin_neff_max: DecimalString;
  moderate_neff_max: DecimalString;
  strong_min_span_days: DecimalString;
  strong_min_observers: DecimalString;
};

/**
 * A hard ceiling triggered by evidence, for the things a weighted average
 * cannot say.
 *
 * Averaging is the right tool for "how good is this, roughly". It is the wrong
 * tool for "this asks callers to paste an API key into a third-party server".
 * A finding like that is a fact about the subject, and letting it be diluted
 * to a rounding error by four other dimensions scoring well is how a ratings
 * source ends up recommending something dangerous.
 *
 * Two trigger modes, because two different questions are being asked:
 *
 * - `observation`: fires when a SINGLE admissible observation is at or below
 *   the threshold. Use for findings, where one occurrence is the whole point
 *   and shrinking it toward a cohort mean would be absurd.
 * - `estimate`: fires when the dimension's UPPER bound is at or below the
 *   threshold, meaning even the optimistic reading is bad. Use where the
 *   claim is about a rate rather than an occurrence. It cannot fire on thin
 *   evidence, because thin evidence has a wide interval and therefore a high
 *   upper bound.
 *
 * `trigger_provenance` is the gameability defence and is not optional. A gate
 * that a review could fire is a weapon pointed at competitors: anyone could
 * post an opinion and cap a rival's score. Gates fire on measured and attested
 * evidence only.
 */
export type RatingGate = {
  id: string;
  /** Dimension whose evidence can trip this gate. */
  dimension: string;
  trigger: "observation" | "estimate";
  /**
   * Only observations with this key can trip an `observation` gate. Required
   * for that mode: a gate keyed on a whole dimension would fire on any low
   * ratio, and a ratio is an average, which is what gates exist to escape.
   * Ignored for `estimate`.
   */
  observation_key: string | null;
  /** Trips at or below this value, [0,1]. */
  at_or_below: DecimalString;
  /** Provenance kinds admissible as a trigger. Measured and attested only. */
  trigger_provenance: readonly Provenance[];
  /** Composite ceiling this gate imposes, [0,1]. */
  caps_composite_at: DecimalString;
  /** Ceiling on the triggering dimension itself, [0,1]. null leaves it alone. */
  caps_dimension_at: DecimalString | null;
  /** Published verbatim beside the capped score. Says what was found, not what it means. */
  reason: string;
};

/**
 * Whether re-observing a dimension produces new information.
 *
 * `independent_per_day` — a genuine repeat sample of a quantity that can
 * change between probes. Availability is the clean case: the endpoint really
 * might be down today and up tomorrow, so thirty days of probes are thirty
 * observations and the interval should narrow accordingly.
 *
 * `latest_only` — a re-read of something static. Re-reading a registry's
 * publish date, or a manifest's tool list, produces the same fact again. Under
 * per-day bucketing those re-reads accumulate: replaying ONE byte-identical
 * transcript as 365 daily runs drives n_eff to 263 and confidence to 0.88 on a
 * single fact, and the composite to 96. That is not evidence accumulating, it
 * is a loop. Only the most recent reading of each check counts.
 *
 * Defaulting to `latest_only` would be wrong for availability and defaulting to
 * `independent_per_day` is what produced the inflation, so it is required per
 * dimension rather than defaulted at all.
 */
export type ResamplingPolicy = "independent_per_day" | "latest_only";

export type DimensionSpec = {
  id: string;
  label: string;
  /** What this dimension claims to measure, in one sentence, published on /methodology. */
  rubric: string;
  /** Evidence kinds admissible here. An observation with any other provenance is dropped and counted. */
  accepted_provenance: readonly Provenance[];
  /** Share of the composite, [0,1]. Weights within a profile sum to exactly 1. */
  weight: DecimalString;
  /**
   * Maximum share of this dimension's effective weight that self-reported
   * evidence may hold, [0,1]. Ignored when self_reported is not accepted.
   * Above the cap, self-reported contributions are scaled down proportionally
   * rather than dropped, so the ordering within them is preserved.
   */
  self_reported_cap: DecimalString;
  /** Whether repeat observations here are independent samples. See ResamplingPolicy. */
  resampling: ResamplingPolicy;
  /** Constants for this dimension only. Applied over the profile's, which are applied over the subject's. */
  constants?: Partial<RatingConstantOverrides>;
};

export type RatingProfile = {
  profile_id: string;
  kind: SubjectKind;
  label: string;
  /** What a reader should understand this rating to be about. */
  summary: string;
  dimensions: readonly DimensionSpec[];
  /** Composite is withheld unless this share of dimension weight has a published score. */
  min_dimension_coverage: DecimalString;
  /**
   * Composite is withheld unless this share of the profile weight was
   * ASSESSABLE at all, whatever the coverage over that share turned out to be.
   *
   * Without this the two floors combine into a hole. A server behind an HTTP
   * 401 answers, so availability is measurable, and everything else is a
   * harness gap. Coverage over the assessable share is then 1.0, it clears
   * min_dimension_coverage, and a server we could not test publishes a high
   * composite computed from one dimension. "We assessed a quarter of the
   * profile and it looked fine" is not a rating.
   */
  min_assessment_completeness: DecimalString;
  /** Constants for every dimension of this profile, unless a dimension overrides them again. */
  constants?: Partial<RatingConstantOverrides>;
  /** Hard ceilings triggered by evidence. Empty is the normal case. */
  gates: readonly RatingGate[];
};

/**
 * Dimensions reused across profiles keep the same id and rubric wherever they
 * appear, so "availability" means one thing across the whole compendium and a
 * reader comparing an MCP server to a hosted agent is comparing like to like.
 */
const AVAILABILITY: Omit<DimensionSpec, "weight"> = {
  id: "availability",
  label: "Availability",
  rubric:
    "Share of probe attempts where the subject's declared endpoint answered within the timeout. Measured only; nobody can review a subject into being reachable.",
  accepted_provenance: ["measured"],
  self_reported_cap: "0.00",
  resampling: "independent_per_day",
  // Availability is the most perishable thing this project measures. A probe
  // from three months ago says almost nothing about whether the endpoint
  // answers now, so it is worth a quarter of a current one rather than the
  // 88 percent the global 120-day half-life would give it.
  constants: { decay_half_life_days: "14" },
};

const CONFORMANCE: Omit<DimensionSpec, "weight"> = {
  id: "protocol_conformance",
  label: "Protocol conformance",
  rubric:
    "Share of protocol checks the subject passes: handshake, required methods, schema validity of what it returns. Measured only.",
  accepted_provenance: ["measured"],
  self_reported_cap: "0.00",
  resampling: "latest_only",
  // Conformance changes when the subject ships, which is slower than uptime
  // moves and faster than a reputation settles.
  constants: { decay_half_life_days: "60" },
};

const MAINTENANCE: Omit<DimensionSpec, "weight"> = {
  id: "maintenance",
  label: "Maintenance",
  rubric:
    "Evidence the subject is still being looked after: release recency, whether reported breakage gets fixed, whether declared metadata still matches behaviour.",
  accepted_provenance: ["measured", "attested"],
  self_reported_cap: "0.00",
  resampling: "latest_only",
  // The observation is already a recency measure, so decaying it hard would
  // discount staleness twice.
  constants: { decay_half_life_days: "365" },
};

const DOCUMENTATION: Omit<DimensionSpec, "weight"> = {
  id: "documentation",
  label: "Documentation",
  rubric:
    "Whether a caller can tell what the subject does and how to call it correctly, from what the subject publishes. The subject's own description is admissible here because it is the artifact being judged, and capped because judging it is still our job.",
  accepted_provenance: ["measured", "self_reported"],
  self_reported_cap: "0.40",
  resampling: "latest_only",
};

const OPERATOR_REPUTATION: Omit<DimensionSpec, "weight"> = {
  id: "operator_reputation",
  label: "Operator reputation",
  rubric:
    "What independent parties report about the operator behind the subject. Weighted by observer independence, and never the largest share of a composite.",
  accepted_provenance: ["third_party_review", "attested"],
  self_reported_cap: "0.00",
  resampling: "latest_only",
};

function dim(base: Omit<DimensionSpec, "weight">, weight: DecimalString): DimensionSpec {
  return { ...base, weight };
}

/**
 * On-chain agent: the ERC-8004 case the index was built for, restated as a
 * profile. Counterparty satisfaction carries the feedback registry, which is
 * the only evidence the registries actually hold, and it is deliberately not a
 * majority of the composite: a rating that is mostly other people's reviews is
 * a rating that moves when someone buys reviews.
 */
const ONCHAIN_AGENT: RatingProfile = {
  profile_id: "onchain_agent.v1",
  kind: "onchain_agent",
  label: "On-chain agent",
  summary:
    "An agent with an identity in an on-chain registry, rated on what counterparties report, what its settlement record shows, and what we can measure about it directly.",
  dimensions: [
    {
      id: "counterparty_satisfaction",
      label: "Counterparty satisfaction",
      rubric:
        "What parties who transacted with this agent reported afterwards, weighted by how independent and how corroborated those parties are.",
      accepted_provenance: ["third_party_review", "attested"],
      weight: "0.35",
      self_reported_cap: "0.00",
      resampling: "latest_only",
    },
    {
      id: "delivery",
      label: "Delivery",
      rubric:
        "Share of commissioned work that reached a completed terminal state rather than being rejected, expired or abandoned, read from settlement records rather than from reports.",
      accepted_provenance: ["measured", "attested"],
      weight: "0.30",
      self_reported_cap: "0.00",
      resampling: "latest_only",
    },
    {
      id: "identity_integrity",
      label: "Identity integrity",
      rubric:
        "Whether the identity behaves like one continuous operator: stable custody, a wallet it actually transacts from, metadata that resolves to what it claims.",
      accepted_provenance: ["measured"],
      weight: "0.20",
      self_reported_cap: "0.00",
      resampling: "latest_only",
    },
    dim(AVAILABILITY, "0.15"),
  ],
  min_dimension_coverage: "0.50",
  min_assessment_completeness: "0.50",
  gates: [
    {
      id: "onchain.custody_discontinuous",
      dimension: "identity_integrity",
      trigger: "observation",
      observation_key: "custody_continuous",
      at_or_below: "0.00",
      trigger_provenance: ["measured"],
      // Not a verdict on the new owner. A sold identity carries its old
      // reputation into new hands, and SPEC 11.6 already resets the epoch;
      // this stops the remaining evidence from reading as a settled record.
      caps_composite_at: "0.75",
      caps_dimension_at: null,
      reason: "the identity changed hands without evidence of a custody migration",
    },
  ],
};

/**
 * MCP server: a tool provider. Rated for whether it works and whether calling
 * it is safe, not for whether anyone liked it. Almost all of this composite is
 * measured, which is the point: an MCP server is one of the few subjects where
 * an outsider can establish nearly everything that matters by connecting to it.
 *
 * tool_safety is separated from conformance because they fail differently. A
 * server can be perfectly conformant and still expose an undeclared
 * destructive operation, and a caller who reads one number needs to know which
 * of those two things it is.
 */
/**
 * Gate ids are unique across the whole registry, so a fired gate names exactly
 * one rule. v2 therefore carries its own ids rather than reusing v1's: the caps
 * are identical but the rule sets are not, because the same cap lands on a
 * different weighting and means something different about the subject.
 */
function versioned(gates: readonly RatingGate[], version: string): readonly RatingGate[] {
  return gates.map((g) => ({ ...g, id: g.id.replace(/^mcp\./, `mcp.${version}.`) }));
}

const MCP_GATES: readonly RatingGate[] = [
    {
      id: "mcp.credential_parameter",
      dimension: "tool_safety",
      trigger: "observation",
      observation_key: "credential_parameter_present",
      at_or_below: "0.00",
      trigger_provenance: ["measured", "attested"],
      // The single most consequential thing an outsider can establish about a
      // remote MCP server. A tool whose schema asks the caller to hand over an
      // API key is asking for a secret to be transmitted to a third party, and
      // no amount of good documentation elsewhere makes that safe to recommend.
      caps_composite_at: "0.45",
      caps_dimension_at: "0.30",
      reason: "a declared tool asks the caller to supply a credential",
    },
    {
      id: "mcp.undocumented_destructive_tool",
      dimension: "tool_safety",
      trigger: "observation",
      observation_key: "undocumented_mutating_tool_present",
      at_or_below: "0.00",
      trigger_provenance: ["measured", "attested"],
      // An agent will call an undescribed tool to find out what it does. When
      // the tool deletes something, finding out is the damage.
      caps_composite_at: "0.60",
      caps_dimension_at: "0.50",
      reason: "a tool whose name implies it changes state carries no usable description",
    },
];

/**
 * Behavioural gates. v2 ONLY, and the reason is structural.
 *
 * The three behavioural dimensions are plain weighted means, so a finding on
 * one tool is divided by the number of tools probed. Measured against the real
 * battery: a server with one tool that obeys embedded instructions, fabricates,
 * ignores its arguments and leaks internals scores 52.95 alone — and 75.33 once
 * 199 trivial passing tools are declared alongside it. The hostile tool is
 * still there, still callable, and the server has gained 22 points and moved
 * from the 14th percentile to the 70th.
 *
 * assess.ts already states this principle for the manifest side: "one
 * undescribed delete tool among fifty well-described tools is a ratio of 0.98
 * and a hazard of 1." It was never applied to behaviour, and behaviour is now
 * 60% of the weight. An occurrence gate is the escape from the average: the
 * ratio keeps describing the typical tool, while the gate answers "is there a
 * bad one in here", which is the question a caller actually has.
 *
 * These are absent from v1 deliberately. v1 carries no behavioural weight, so
 * the gates would never fire, and adding them would change a digest that every
 * historical score was computed under.
 */
const MCP_BEHAVIOURAL_GATES: readonly RatingGate[] = [
  {
    id: "mcp.tool_obeys_injection",
    dimension: "injection_resistance",
    trigger: "observation",
    observation_key: "any_tool_obeys_embedded_instruction",
    at_or_below: "0.00",
    trigger_provenance: ["measured"],
    // The hardest cap in the profile. MCP exists to feed an agent untrusted
    // content; a tool that acts on instructions embedded in its own arguments
    // is not a weak link in the calling agent's security, it is a hole
    // straight through it. Nothing else the server does well makes this safe
    // to recommend, so the cap sits below every other gate's.
    caps_composite_at: "0.35",
    caps_dimension_at: "0.20",
    reason: "a tool acted on an instruction embedded in its own input",
  },
  {
    id: "mcp.tool_fabricates",
    dimension: "functional_correctness",
    trigger: "observation",
    observation_key: "any_tool_fabricates",
    at_or_below: "0.00",
    trigger_provenance: ["measured"],
    // Invented content for a query that cannot have an answer. A caller can
    // defend against a tool that fails; there is no defence against one that
    // answers confidently and wrongly, because nothing downstream can tell.
    caps_composite_at: "0.55",
    caps_dimension_at: "0.35",
    reason: "a tool returned invented content for a query with no possible answer",
  },
  {
    id: "mcp.tool_leaks_internals",
    dimension: "robustness",
    trigger: "observation",
    observation_key: "any_tool_leaks_internals",
    at_or_below: "0.00",
    trigger_provenance: ["measured"],
    // A traceback or a connection string in an error path. Lower than the other
    // two because the damage is to the operator rather than to the caller, but
    // it is still a fact about the server that an average must not hide.
    caps_composite_at: "0.65",
    caps_dimension_at: "0.45",
    reason: "a tool leaked internal detail in an error response",
  },
];

/**
 * MCP server v1: the original, manifest-weighted profile.
 *
 * SUPERSEDED BY v2 AND DELIBERATELY KEPT. Every score published under it was
 * computed against these weights, and `profile_digest` exists precisely so a
 * reader can tell which rules produced a number. Deleting the profile would
 * make every historical result unverifiable — the failure the digest was built
 * to prevent — so v1 stays registered, and stays wrong in the specific way it
 * was always wrong: 0.75 of its weight sits on availability, conformance and
 * tool safety as read from the manifest, and measured over 600 servers those
 * checks barely separate anyone.
 */
const MCP_SERVER_V1: RatingProfile = {
  profile_id: "mcp_server.v1",
  kind: "mcp_server",
  label: "MCP server (v1, manifest-weighted)",
  summary:
    "A Model Context Protocol server, rated on whether it answers, whether it speaks the protocol correctly, whether its declared tools match what they do, and whether it is still maintained.",
  dimensions: [
    dim(AVAILABILITY, "0.25"),
    dim(CONFORMANCE, "0.25"),
    {
      id: "tool_safety",
      label: "Tool safety",
      rubric:
        "Whether declared tool surfaces match observed behaviour: destructive operations declared as such, no undeclared side effects, no request for credentials a tool does not need, input schemas that constrain what they claim to constrain.",
      accepted_provenance: ["measured", "attested"],
      weight: "0.25",
      self_reported_cap: "0.00",
      resampling: "latest_only",
      constants: { decay_half_life_days: "60" },
    },
    dim(DOCUMENTATION, "0.15"),
    dim(MAINTENANCE, "0.10"),
  ],
  min_dimension_coverage: "0.60",
  min_assessment_completeness: "0.60",
  gates: MCP_GATES,
};

const MCP_SERVER_V2: RatingProfile = {
  profile_id: "mcp_server.v2",
  kind: "mcp_server",
  label: "MCP server",
  summary:
    "A Model Context Protocol server, rated first on whether its tools actually work when called, then on whether calling them is safe, and only then on what it declares about itself.",
  dimensions: [
    // WEIGHTED BY WHAT A CALLER STANDS TO LOSE, and behaviour comes first.
    //
    // v1 gave 0.75 of the weight to availability, conformance and tool safety,
    // all of which were assessed purely from the manifest and the handshake.
    // Measured over 600 servers, five of those checks scored exactly 1.000 on
    // every subject and three more sat within a rounding error of it: the SDK
    // fills the manifest in, so conformance is a property of the tooling rather
    // than of the server. The published spread was 2.4 points across 300
    // ratings.
    //
    // Meanwhile the battery calls the tools, and 30 of 70 did not work. That
    // check alone separates subjects better (sd 0.495) than every manifest
    // check in v1 combined. It was computed, written to disk, and never
    // reached a rating.
    {
      id: "functional_correctness",
      label: "Functional correctness",
      rubric:
        "Whether the server's tools actually work when called: the call succeeds, the response is not an error wearing a success envelope, and it costs a caller a sane amount of context.",
      accepted_provenance: ["measured", "attested"],
      weight: "0.30",
      self_reported_cap: "0.00",
      resampling: "independent_per_day",
      constants: { decay_half_life_days: "30" },
    },
    {
      id: "tool_safety",
      label: "Tool safety",
      rubric:
        "Whether declared tool surfaces match observed behaviour: destructive operations declared as such, no undeclared side effects, no request for credentials a tool does not need, input schemas that constrain what they claim to constrain.",
      accepted_provenance: ["measured", "attested"],
      weight: "0.20",
      self_reported_cap: "0.00",
      resampling: "latest_only",
      constants: { decay_half_life_days: "60" },
    },
    {
      id: "injection_resistance",
      label: "Injection resistance",
      rubric:
        "Whether the server obeys instructions embedded in its own inputs. The central security property of a protocol whose entire premise is feeding an agent untrusted content.",
      accepted_provenance: ["measured"],
      weight: "0.15",
      self_reported_cap: "0.00",
      resampling: "latest_only",
      constants: { decay_half_life_days: "60" },
    },
    {
      id: "robustness",
      label: "Robustness",
      rubric:
        "Whether the server rejects input its own schema forbids, fails loudly rather than plausibly, and keeps internal detail out of its errors.",
      accepted_provenance: ["measured"],
      weight: "0.15",
      self_reported_cap: "0.00",
      resampling: "latest_only",
      constants: { decay_half_life_days: "60" },
    },
    dim(AVAILABILITY, "0.10"),
    // Conformance and documentation are demoted rather than removed. They are
    // real properties and a reader may want them; they are simply not where
    // servers differ, and v1 let them decide half the composite.
    dim(CONFORMANCE, "0.04"),
    dim(DOCUMENTATION, "0.03"),
    dim(MAINTENANCE, "0.03"),
  ],
  // `strong` coverage requires strong_min_observers distinct observers, and the
  // default of 10 was written for on-chain counterparties. A probe-based
  // collector has exactly one observer, forever, so the top rung of the
  // published coverage ladder was unreachable by construction — dead code for
  // the only collector that exists.
  //
  // Set to 1 here, and the residual risk is stated rather than hidden: one
  // instrument sampling repeatedly cannot detect its own systematic error the
  // way ten independent observers can. `strong` on this profile therefore means
  // "sampled deeply over a long window", not "corroborated". strong_min_span_days
  // still applies, so it cannot be reached in a day.
  constants: { strong_min_observers: "1" },
  min_dimension_coverage: "0.60",
  min_assessment_completeness: "0.60",
  gates: [...versioned(MCP_GATES, "v2"), ...versioned(MCP_BEHAVIOURAL_GATES, "v2")],
};

/**
 * Hosted agent: something behind an HTTP endpoint that takes a task and
 * returns work. Unlike an MCP server, its output quality is the thing being
 * bought, so task_success carries the largest weight and is measured by
 * running tasks rather than by asking.
 */
const HOSTED_AGENT: RatingProfile = {
  profile_id: "hosted_agent.v1",
  kind: "hosted_agent",
  label: "Hosted agent",
  summary:
    "An agent reachable over the network, rated on whether it completes tasks correctly, whether it answers reliably, and what its users report.",
  dimensions: [
    {
      id: "task_success",
      label: "Task success",
      rubric:
        "Share of benchmark tasks the agent completed to the task's stated acceptance criteria, run against a fixed suite held constant across subjects of the same kind.",
      accepted_provenance: ["measured", "attested"],
      weight: "0.35",
      self_reported_cap: "0.00",
      resampling: "latest_only",
    },
    dim(AVAILABILITY, "0.20"),
    dim(CONFORMANCE, "0.15"),
    {
      id: "counterparty_satisfaction",
      label: "User satisfaction",
      rubric:
        "What independent users report after using the agent, weighted by how independent and how corroborated those users are.",
      accepted_provenance: ["third_party_review", "attested"],
      weight: "0.15",
      self_reported_cap: "0.00",
      resampling: "latest_only",
    },
    dim(DOCUMENTATION, "0.10"),
    dim(MAINTENANCE, "0.05"),
  ],
  min_dimension_coverage: "0.50",
  min_assessment_completeness: "0.50",
  gates: [
    {
      id: "hosted.persistently_unavailable",
      dimension: "availability",
      trigger: "estimate",
      observation_key: null,
      at_or_below: "0.50",
      trigger_provenance: ["measured"],
      // An estimate gate, not an observation gate: one failed probe is a bad
      // minute, and this should only fire once even the optimistic reading of
      // a probe window says the thing is down more than half the time. Thin
      // evidence has a wide interval and a high upper bound, so it cannot fire
      // on a single failure.
      caps_composite_at: "0.50",
      caps_dimension_at: null,
      reason: "even the optimistic reading of the probe window has the endpoint down more than half the time",
    },
  ],
};

/**
 * Code package: an agent or tool distributed as source rather than as a
 * running service, which is most of what a code host holds.
 *
 * Adoption is included because it is real information and excluded from
 * carrying much because it is the easiest signal on this list to manufacture.
 * Stars cost nothing. It sits at 0.10 and is never the reason a package rates
 * well.
 */
const CODE_PACKAGE: RatingProfile = {
  profile_id: "code_package.v1",
  kind: "code_package",
  label: "Code package",
  summary:
    "An agent or tool distributed as source, rated on whether it is maintained, whether its supply chain is verifiable, and whether it can be understood well enough to run.",
  dimensions: [
    dim(MAINTENANCE, "0.25"),
    {
      id: "provenance_integrity",
      label: "Provenance integrity",
      rubric:
        "Whether what you install is what the source says it is: signed or attested releases, pinned dependencies, a lockfile, a build that reproduces.",
      accepted_provenance: ["measured", "attested"],
      weight: "0.25",
      self_reported_cap: "0.00",
      resampling: "latest_only",
    },
    {
      id: "dependency_hygiene",
      label: "Dependency hygiene",
      rubric:
        "Whether the package's declared dependencies are current, resolvable, and free of known-vulnerable versions at the time of observation.",
      accepted_provenance: ["measured"],
      weight: "0.20",
      self_reported_cap: "0.00",
      resampling: "latest_only",
    },
    dim(DOCUMENTATION, "0.15"),
    {
      id: "adoption",
      label: "Adoption",
      rubric:
        "Observed independent use: dependents, downloads from distinct sources, forks that diverge. Deliberately a small share, because attention is the cheapest signal here to manufacture.",
      accepted_provenance: ["measured"],
      weight: "0.10",
      self_reported_cap: "0.00",
      resampling: "latest_only",
    },
    dim(OPERATOR_REPUTATION, "0.05"),
  ],
  min_dimension_coverage: "0.50",
  min_assessment_completeness: "0.50",
  gates: [
    {
      id: "code.known_vulnerable_dependency",
      dimension: "dependency_hygiene",
      trigger: "observation",
      observation_key: "no_known_vulnerable_dependencies",
      at_or_below: "0.00",
      trigger_provenance: ["measured", "attested"],
      // The case that motivated gates existing. One critical advisory in the
      // dependency tree is a fact, and a weighted average that lets four good
      // dimensions dilute it to two points is a rating that recommends
      // installing the thing.
      caps_composite_at: "0.40",
      caps_dimension_at: "0.20",
      reason: "a declared dependency has a known vulnerability at the observed version",
    },
  ],
};

export const RATING_PROFILES: Readonly<Record<string, RatingProfile>> = Object.freeze({
  [ONCHAIN_AGENT.profile_id]: ONCHAIN_AGENT,
  // Both MCP profiles stay registered. v1 is superseded, not deleted: scores
  // published under it name it in their profile_digest, and a reader must be
  // able to resolve that id to the rules that produced the number.
  [MCP_SERVER_V1.profile_id]: MCP_SERVER_V1,
  [MCP_SERVER_V2.profile_id]: MCP_SERVER_V2,
  [HOSTED_AGENT.profile_id]: HOSTED_AGENT,
  [CODE_PACKAGE.profile_id]: CODE_PACKAGE,
});

/** Look up a profile, refusing an unknown id rather than scoring against an empty rubric. */
export function getRatingProfile(profileId: string): RatingProfile {
  if (!Object.hasOwn(RATING_PROFILES, profileId)) {
    throw new Error(`unknown rating profile: ${JSON.stringify(profileId)}`);
  }
  return RATING_PROFILES[profileId]!;
}

/** Every dimension id used anywhere, sorted. Published on /methodology so ids stay stable. */
export function allDimensionIds(): string[] {
  const ids = new Set<string>();
  for (const p of Object.values(RATING_PROFILES)) for (const d of p.dimensions) ids.add(d.id);
  return [...ids].sort();
}
