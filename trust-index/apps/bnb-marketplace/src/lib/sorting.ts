import type { Agent } from './types';

export const COVERAGE_RANK = { thin: 1, moderate: 2, strong: 3 } as const;

export type SortKey =
  | 'assessment'
  | 'coverage'
  | 'tools'
  | 'latency'
  | 'feedback'
  | 'scan_score'
  | 'name';

export const SORTS: Array<{ key: SortKey; label: string; hint: string }> = [
  { key: 'assessment', label: 'Our assessment', hint: 'Rated agents first, highest composite at the top.' },
  { key: 'coverage', label: 'How much we looked', hint: 'Strong coverage first — most evidence behind the verdict.' },
  { key: 'tools', label: 'Capabilities we enumerated', hint: 'Most callable tools or skills first.' },
  { key: 'latency', label: 'Response time', hint: 'Fastest measured response first.' },
  { key: 'feedback', label: 'Feedback count (8004scan)', hint: 'Third-party feedback volume. Not our number.' },
  { key: 'scan_score', label: 'Score (8004scan)', hint: "8004scan's own total score. Shown for contrast, not endorsement." },
  { key: 'name', label: 'Name', hint: 'Alphabetical. No ranking implied.' },
];

/**
 * Agents we cannot rank are not sorted into the list with a stand-in value —
 * they are pulled out and shown separately, so a sort never implies we know
 * something we do not.
 */
export function isSortable(agent: Agent, key: SortKey): boolean {
  switch (key) {
    case 'assessment':
      return agent.assessment?.composite != null;
    case 'coverage':
      return agent.assessment != null;
    case 'tools':
      return agent.assessment != null;
    case 'latency':
      return agent.assessment?.latency_ms != null;
    case 'feedback':
      return agent.scan_feedbacks > 0;
    case 'scan_score':
      return agent.scan_total_score != null;
    case 'name':
      return true;
  }
}

export function compareAgents(a: Agent, b: Agent, key: SortKey): number {
  switch (key) {
    case 'assessment':
      return (b.assessment?.composite ?? 0) - (a.assessment?.composite ?? 0);
    case 'coverage': {
      const diff = COVERAGE_RANK[b.assessment!.coverage] - COVERAGE_RANK[a.assessment!.coverage];
      return diff !== 0 ? diff : (b.assessment?.tool_count ?? 0) - (a.assessment?.tool_count ?? 0);
    }
    case 'tools':
      return (b.assessment?.tool_count ?? 0) - (a.assessment?.tool_count ?? 0);
    case 'latency':
      return (a.assessment?.latency_ms ?? 0) - (b.assessment?.latency_ms ?? 0);
    case 'feedback':
      return b.scan_feedbacks - a.scan_feedbacks;
    case 'scan_score':
      return (b.scan_total_score ?? 0) - (a.scan_total_score ?? 0);
    case 'name':
      return a.name.localeCompare(b.name);
  }
}

export type FilterKey = 'callable' | 'assessed' | 'rated' | 'verified' | 'feedback' | 'gates' | 'clean';

export const FILTERS: Array<{ key: FilterKey; label: string; hint: string }> = [
  { key: 'callable', label: 'Has a callable endpoint', hint: 'Declares an endpoint or speaks MCP/A2A.' },
  { key: 'assessed', label: 'We assessed it', hint: 'We called it and recorded the result.' },
  { key: 'rated', label: 'We published a score', hint: 'Assessed with enough evidence to rate.' },
  { key: 'verified', label: 'Ecosystem verified', hint: "8004scan verified the endpoint. Their check, not ours." },
  { key: 'feedback', label: 'Has any feedback', hint: 'At least one third-party feedback record exists.' },
  { key: 'gates', label: 'Safety gates fired', hint: 'Show only agents that tripped a hard safety cap.' },
  { key: 'clean', label: 'No gates fired', hint: 'Assessed, and no hard safety cap tripped.' },
];

export function passesFilter(agent: Agent, key: FilterKey): boolean {
  switch (key) {
    case 'callable':
      return Boolean(agent.endpoint) || agent.protocols.some((p) => /^(mcp|a2a)$/i.test(p));
    case 'assessed':
      return agent.assessment !== null;
    case 'rated':
      return agent.assessment?.composite != null;
    case 'verified':
      return agent.scan_endpoint_verified;
    case 'feedback':
      return agent.scan_feedbacks > 0;
    case 'gates':
      return (agent.assessment?.gates_fired.length ?? 0) > 0;
    case 'clean':
      return agent.assessment !== null && agent.assessment.gates_fired.length === 0;
  }
}
