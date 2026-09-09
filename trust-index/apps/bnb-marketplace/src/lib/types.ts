// Mirrors DATA-CONTRACT.md exactly. The contract is frozen; if a producer adds a
// field, add it here first and only then read it in the UI.

export type CategorySlug = 'rebalancing' | 'grid_trading' | 'yield' | 'health_factor' | 'other';

export type Coverage = 'thin' | 'moderate' | 'strong';

export interface Assessment {
  reachable: boolean;
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
  token_id: string;
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
