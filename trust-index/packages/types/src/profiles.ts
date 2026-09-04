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
};

const CONFORMANCE: Omit<DimensionSpec, "weight"> = {
  id: "protocol_conformance",
  label: "Protocol conformance",
  rubric:
    "Share of protocol checks the subject passes: handshake, required methods, schema validity of what it returns. Measured only.",
  accepted_provenance: ["measured"],
  self_reported_cap: "0.00",
};

const MAINTENANCE: Omit<DimensionSpec, "weight"> = {
  id: "maintenance",
  label: "Maintenance",
  rubric:
    "Evidence the subject is still being looked after: release recency, whether reported breakage gets fixed, whether declared metadata still matches behaviour.",
  accepted_provenance: ["measured", "attested"],
  self_reported_cap: "0.00",
};

const DOCUMENTATION: Omit<DimensionSpec, "weight"> = {
  id: "documentation",
  label: "Documentation",
  rubric:
    "Whether a caller can tell what the subject does and how to call it correctly, from what the subject publishes. The subject's own description is admissible here because it is the artifact being judged, and capped because judging it is still our job.",
  accepted_provenance: ["measured", "self_reported"],
  self_reported_cap: "0.40",
};

const OPERATOR_REPUTATION: Omit<DimensionSpec, "weight"> = {
  id: "operator_reputation",
  label: "Operator reputation",
  rubric:
    "What independent parties report about the operator behind the subject. Weighted by observer independence, and never the largest share of a composite.",
  accepted_provenance: ["third_party_review", "attested"],
  self_reported_cap: "0.00",
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
    },
    {
      id: "delivery",
      label: "Delivery",
      rubric:
        "Share of commissioned work that reached a completed terminal state rather than being rejected, expired or abandoned, read from settlement records rather than from reports.",
      accepted_provenance: ["measured", "attested"],
      weight: "0.30",
      self_reported_cap: "0.00",
    },
    {
      id: "identity_integrity",
      label: "Identity integrity",
      rubric:
        "Whether the identity behaves like one continuous operator: stable custody, a wallet it actually transacts from, metadata that resolves to what it claims.",
      accepted_provenance: ["measured"],
      weight: "0.20",
      self_reported_cap: "0.00",
    },
    dim(AVAILABILITY, "0.15"),
  ],
  min_dimension_coverage: "0.50",
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
const MCP_SERVER: RatingProfile = {
  profile_id: "mcp_server.v1",
  kind: "mcp_server",
  label: "MCP server",
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
    },
    dim(DOCUMENTATION, "0.15"),
    dim(MAINTENANCE, "0.10"),
  ],
  min_dimension_coverage: "0.60",
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
    },
    dim(DOCUMENTATION, "0.10"),
    dim(MAINTENANCE, "0.05"),
  ],
  min_dimension_coverage: "0.50",
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
    },
    {
      id: "dependency_hygiene",
      label: "Dependency hygiene",
      rubric:
        "Whether the package's declared dependencies are current, resolvable, and free of known-vulnerable versions at the time of observation.",
      accepted_provenance: ["measured"],
      weight: "0.20",
      self_reported_cap: "0.00",
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
    },
    dim(OPERATOR_REPUTATION, "0.05"),
  ],
  min_dimension_coverage: "0.50",
};

export const RATING_PROFILES: Readonly<Record<string, RatingProfile>> = Object.freeze({
  [ONCHAIN_AGENT.profile_id]: ONCHAIN_AGENT,
  [MCP_SERVER.profile_id]: MCP_SERVER,
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
