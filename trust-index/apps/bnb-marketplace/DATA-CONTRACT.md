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

  // 8004scan-sourced (third_party_review provenance, weight 0.60)
  scan_total_score: number | null
  scan_feedbacks: number
  scan_endpoint_verified: boolean

  // OUR assessment. null = not assessed; NEVER invent a value.
  assessment: null | {
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
