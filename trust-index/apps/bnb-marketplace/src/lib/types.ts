// Mirrors DATA-CONTRACT.md exactly. The contract is frozen; if a producer adds a
// field, add it here first and only then read it in the UI.

/**
 * The four DeFi-position categories, plus eight derived from the corpus.
 *
 * The second group exists because 9,811 agents sat in `other` while their own
 * descriptions said plainly what they were — 5,170 of them "Gasless stablecoin
 * payment agent". Calling those unclassifiable described our taxonomy, not
 * them. Adding the eight moved 75% of the pile into a named category.
 *
 * Every one is still SELF-REPORTED (weight 0.15). A category says what an agent
 * claims to be; only an assessment says how it behaves.
 */
export type CategorySlug =
  | 'rebalancing' | 'grid_trading' | 'yield' | 'health_factor'
  | 'payments' | 'security' | 'research' | 'content'
  | 'development' | 'automation' | 'trading' | 'staking'
  | 'other';

export type Coverage = 'thin' | 'moderate' | 'strong';

export interface Assessment {
  /**
   * How many agents in the snapshot declare this same endpoint, this one
   * included. 1 means the measurement is this agent's alone.
   *
   * A score is a measurement of a SERVICE. When 229 registrations share one
   * endpoint, writing its score onto all 229 rows without saying so turns
   * eleven measured services into "239 rated agents" — the same
   * one-thing-counted-many-times inflation that fills the registry, reproduced
   * by us. Render this anywhere a shared score appears.
   */
  endpoint_shared_with: number;
  /**
   * null = WE COULD NOT MEASURE. A timeout, a 5xx or a DNS failure is our
   * failure to obtain a reading, and recording it as `false` would publish our
   * blind spot as the agent's downtime. `false` is reserved for an answer that
   * settles it — an endpoint that is not publicly dialable at all.
   */
  reachable: boolean | null;
  protocol_spoken: 'mcp' | 'a2a' | null;
  /** Enumerated capability names, as the agent itself reported them. */
  tools_or_skills: string[];
  tool_count: number;
  latency_ms: number | null;
  /** How much we looked. Orthogonal to composite — never merge the two. */
  coverage: Coverage;
  /** null = WITHHELD. Render the reason, never a number. */
  composite: number | null;
  withheld_reason: string | null;
  /** Hard safety caps that tripped. Non-empty is loud by design. */
  gates_fired: string[];
  checked_at: string;
}

export interface Agent {
  agent_id: string;
  chain_id: number;
  /**
   * null when the agent is not ERC-8004 registered. Registration costs
   * unsponsored gas, so a working agent can legitimately lack one.
   */
  token_id: string | null;
  name: string;
  description: string;
  owner_address: string;
  image_url: string | null;

  category: CategorySlug;
  category_confidence: number;
  category_evidence: string;

  protocols: string[];
  endpoint: string | null;
  x402_supported: boolean;

  /**
   * Which kind of `endpoint: null` this is. Only the 8004scan detail view
   * carries an endpoint, and that fetch is rate-limited, so an agent we never
   * reached is indistinguishable from one that declares none — unless this
   * field is checked.
   *
   * - `read`: we hold the detail response. `endpoint: null` is a FACT.
   * - `unread_rate_limited`: we never got the response. The null is OUR gap.
   *   Exclude it from any "has no endpoint" / "not callable" denominator and
   *   render it as unknown. Counting it as an absence is a rule 1 violation.
   * - `unread_unknown`: detail status is missing or invalid; the reason is
   *   unknown too. Apply the same exclusion without claiming a rate limit.
   */
  // Legacy or invalid snapshots must not acquire an invented failure reason.
  detail_status: 'read' | 'unread_rate_limited' | 'unread_unknown';

  // Third party (8004scan). Never ours.
  scan_total_score: number | null;
  scan_feedbacks: number;
  scan_endpoint_verified: boolean;

  // Ours. null = not assessed.
  assessment: Assessment | null;

  is_reference_agent: boolean;
}

export interface Dataset {
  generated_at: string | null;
  agents: Agent[];
  /**
   * Optional free-text state from the producer (e.g. "REBUILDING — ..."). Not
   * part of the frozen contract; the UI surfaces it if present and ignores it
   * otherwise. Never parsed, never used to derive a number.
   */
  status?: string | null;
}
