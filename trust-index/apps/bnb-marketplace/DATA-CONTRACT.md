# Data contract — bnb-marketplace (frozen, do not change without telling the lead)

Every producer writes this shape; the front end reads only this shape.

`data/agents.json`  ->  { "generated_at": ISO8601, "agents": Agent[] }

Agent = {
  agent_id: string            // "56:0x8004...:341788" (chain:registry:tokenId)
  chain_id: number            // 56 = BSC
  token_id: string
  name: string
  description: string
  owner_address: string
  image_url: string | null

  category: "rebalancing" | "grid_trading" | "yield" | "health_factor" | "other"
  category_confidence: number // 0..1
  category_evidence: string   // why it was categorised this way

  protocols: string[]         // ["MCP","A2A","Web",...]
  endpoint: string | null     // the callable endpoint, if declared
  x402_supported: boolean

  // AMENDED 2026-09-09 (detail-fetch gap): `endpoint: null` was ambiguous and
  // that ambiguity got published. Only the 8004scan DETAIL view carries an
  // endpoint, and the detail fetch is rate-limited to 1000/hour; when a run is
  // truncated, the agents it never reached also land with `endpoint: null`.
  // Counting those as "declares no endpoint" turned 232 measured facts into a
  // published 1,708, and put 11 agents on the site under "cannot be hired at
  // all" when the truth was that we ran out of quota. That is rule 1 exactly.
  //
  // detail_status says which kind of null this is, and MUST be checked before
  // any claim about the absence of an endpoint:
  //   "read"                 -> we hold the detail response. `endpoint: null`
  //                             is then a FACT: the agent declares none.
  //   "unread_rate_limited"  -> we never obtained the detail response. The null
  //                             is OUR gap. It is not evidence of anything and
  //                             must be excluded from the denominator of any
  //                             "has no endpoint" / "not callable" statistic,
  //                             and surfaced as unknown in the UI.
  // AMENDED 2026-09-09 (handoff review): old or invalid snapshots cannot be
  // assumed to have hit a rate limit. The presentation fallback is
  // "unread_unknown"; it never counts as a confirmed absence of an endpoint.
  // The builder still refuses to publish unexplained or non-throttle gaps.
  // A detail is "read" only after its identity and interface fields validate.
  // Invalid cached bodies reject publication, even with a historical 429.
  // Rate-limited includes queued fetches deferred after this run observed a
  // shared-quota 429; the fetch log distinguishes those from requested rows.
  detail_status: "read" | "unread_rate_limited" | "unread_unknown"

  // 8004scan-sourced (third_party_review provenance, weight 0.60)
  scan_total_score: number | null
  scan_feedbacks: number
  scan_endpoint_verified: boolean

  // OUR assessment. null = not assessed; NEVER invent a value.
  assessment: null | {
    // AMENDED 2026-09-09 (scoring): agents in this snapshot declaring the SAME
    // endpoint, this one included. A composite measures a SERVICE. 229
    // registrations share one endpoint here and all inherit its score; writing
    // that onto 229 rows silently turns 13 measured services into "239 rated
    // agents", which is the one-thing-counted-many-times inflation that fills
    // this registry, reproduced by us. Render it wherever a shared score shows.
    endpoint_shared_with: number
    // AMENDED 2026-09-09 (probe sweep): widened from `boolean` to
    // `boolean | null`. null = WE COULD NOT MEASURE — a timeout, a 5xx or a
    // hostname that does not resolve. Writing that as `false` would publish our
    // blind spot as the agent's downtime, which rule 1 forbids. `false` is now
    // reserved for an endpoint that settles it: a non-HTTP scheme, or a private
    // or loopback host nobody could call.
    reachable: boolean | null
    protocol_spoken: "mcp" | "a2a" | null
    tools_or_skills: string[]      // enumerated capability names
    tool_count: number
    latency_ms: number | null
    // Coverage is orthogonal to score (thin/moderate/strong)
    coverage: "thin" | "moderate" | "strong"
    // null composite = WITHHELD. Show "not rated" + reason, never a fake number.
    composite: number | null
    withheld_reason: string | null
    gates_fired: string[]
    checked_at: string
  }

  // Reference agents WE deployed. Excluded from all rankings and leaderboards.
  is_reference_agent: boolean
}

RULES (these are the product, not decoration):
1. A missing measurement is `null` + a reason. Never a zero, never a guess.
2. `is_reference_agent: true` => excluded from rankings/sorting/leaderboards. Label visibly.
3. Never present 8004scan's score as ours. Separate columns, separate provenance.
4. Recording a gap is only half of rule 1 — every CONSUMER of the null has to carry it.
   Before counting a null as an absence, check the field that says whether we looked
   (`detail_status` for `endpoint`, `assessment: null` for a score). A gap recorded
   faithfully in one file and then counted as a fact in another is still a violation;
   that is precisely how the 1,708 above happened.
