import type { Agent, CategorySlug } from './types';
import { evidenceSummary } from './evidence.ts';
import { CATEGORIES } from './categories.ts';

export const COVERAGE_RANK = { thin: 1, moderate: 2, strong: 3 } as const;

export type SortKey =
  | 'evidence'
  | 'assessment'
  | 'coverage'
  | 'tools'
  | 'latency'
  | 'name';

export const SORTS: Array<{ key: SortKey; label: string; hint: string }> = [
  { key: 'evidence', label: 'Most evidence', hint: 'Confirmed protocol exchanges first, retrieved cards or descriptors next, then recorded responses. Unknowns last; ties A–Z. This is not a quality rating.' },
  { key: 'assessment', label: 'Our assessment', hint: 'Rated agents first, highest composite at the top.' },
  { key: 'coverage', label: 'How much we looked', hint: 'Strong coverage first — most evidence behind the verdict.' },
  { key: 'tools', label: 'Declared capabilities', hint: 'Most tool or skill names retrieved first. A declaration is not proof that a capability works.' },
  { key: 'latency', label: 'Response time', hint: 'Fastest measured response first.' },
  { key: 'name', label: 'Name A–Z', hint: 'Alphabetical, not a quality ranking. Open a profile to compare declarations with our evidence.' },
];

// Evidence ordering buckets, not numeric agent scores. A card and descriptor are
// declarations; an auth wall/rate limit proves a response, not working skills.
// Repeated registrations sharing an endpoint receive no volume or recency boost.
const EVIDENCE_ORDER = {
  protocol_confirmed: 3,
  card_retrieved: 2, descriptor_read: 2,
  auth_walled: 1, response_received: 1, rate_limited: 1,
  unmeasured: 0, unsupported_transport: 0,
} as const;

function evidenceOrder(agent: Agent): number {
  return EVIDENCE_ORDER[evidenceSummary(agent).state];
}

/**
 * Agents we cannot rank are not sorted into the list with a stand-in value —
 * they are pulled out and shown separately, so a sort never implies we know
 * something we do not.
 */
export function isSortable(agent: Agent, key: SortKey): boolean {
  switch (key) {
    case 'evidence':
      return evidenceOrder(agent) > 0;
    case 'assessment':
      return agent.assessment?.composite != null;
    case 'coverage':
      return agent.assessment != null;
    case 'tools':
      return agent.assessment != null;
    case 'latency':
      return agent.assessment?.latency_ms != null;
    case 'name':
      return true;
  }
}

export function compareAgents(a: Agent, b: Agent, key: SortKey): number {
  switch (key) {
    case 'evidence':
      return evidenceOrder(b) - evidenceOrder(a);
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
    case 'name':
      return a.name.localeCompare(b.name);
  }
}

export type FilterKey = 'callable' | 'assessed' | 'rated' | 'gates' | 'clean' | 'protocol_confirmed' | 'auth_walled' | 'mcp' | 'a2a' | 'x402';

export const FILTERS: Array<{ key: FilterKey; label: string; hint: string }> = [
  { key: 'callable', label: 'Endpoint declared', hint: 'A connection URL is present. We have not necessarily connected to it.' },
  { key: 'protocol_confirmed', label: 'Protocol responded', hint: 'We completed a protocol handshake. This does not prove its tools work.' },
  { key: 'assessed', label: 'Has probe evidence', hint: 'An assessment record exists, including gaps and unsupported transports.' },
  { key: 'auth_walled', label: 'Needs credentials', hint: 'The observed interface requires authentication.' },
  { key: 'mcp', label: 'MCP declared', hint: 'The registration declares MCP support.' },
  { key: 'a2a', label: 'A2A declared', hint: 'The registration declares A2A support.' },
  { key: 'x402', label: 'x402 declared', hint: 'The registration declares machine payments. Not a payment test or endorsement.' },
  { key: 'rated', label: 'We published a score', hint: 'Assessed with enough evidence to rate.' },
  { key: 'gates', label: 'Safety gates fired', hint: 'Show only agents that tripped a hard safety cap.' },
  { key: 'clean', label: 'No recorded gates', hint: 'No safety gate recorded in an existing assessment. This is not a safety clearance.' },
];

export function passesFilter(agent: Agent, key: FilterKey): boolean {
  switch (key) {
    case 'callable':
      return Boolean(agent.endpoint);
    case 'protocol_confirmed':
      return agent.assessment?.evidence_state === 'protocol_confirmed';
    case 'auth_walled':
      return agent.assessment?.evidence_state === 'auth_walled';
    case 'mcp':
      return agent.protocols.some((p) => /^mcp$/i.test(p));
    case 'a2a':
      return agent.protocols.some((p) => /^a2a$/i.test(p));
    case 'x402':
      return agent.x402_supported;
    case 'assessed':
      return agent.assessment !== null;
    case 'rated':
      return agent.assessment?.composite != null;
    case 'gates':
      return (agent.assessment?.gates_fired.length ?? 0) > 0;
    case 'clean':
      return agent.assessment !== null && agent.assessment.gates_fired.length === 0;
  }
}

export interface ExplorerState {
  query: string;
  filters: FilterKey[];
  categories: CategorySlug[];
  sort: SortKey;
  view: 'grid' | 'table';
}

const DISCOVERY_CATEGORIES: CategorySlug[] = CATEGORIES.map(category => category.slug);

/** URL parameters are untrusted input. Unknown values cannot create invisible filters. */
export function readExplorerState(search: string, defaultView: 'grid' | 'table' = 'grid', allowCategories = true): ExplorerState {
  const params = new URLSearchParams(search);
  const filters = [...new Set((params.get('filter') ?? '').split(','))]
    .filter((key): key is FilterKey => FILTERS.some((f) => f.key === key));
  const categories = allowCategories ? [...new Set((params.get('category') ?? '').split(','))]
    .filter((key): key is CategorySlug => DISCOVERY_CATEGORIES.includes(key as CategorySlug)) : [];
  const sort = SORTS.find((s) => s.key === params.get('sort'))?.key ?? 'assessment';
  const view = params.get('view');
  return { query: params.get('q') ?? '', filters, categories, sort, view: view === 'grid' || view === 'table' ? view : defaultView };
}

export function writeExplorerState(state: ExplorerState, existingSearch = ''): string {
  const params = new URLSearchParams(existingSearch);
  const values = { q: state.query, filter: state.filters.join(','), category: state.categories.join(','), sort: state.sort, view: state.view };
  for (const [key, value] of Object.entries(values)) {
    if (value) params.set(key, value);
    else params.delete(key);
  }
  return params.toString();
}

/** Each word may match a different field; absent values never become the searchable word "null". */
export function matchesSearch(agent: Agent, query: string): boolean {
  const haystack = [agent.name, agent.description, agent.token_id, agent.owner_address, agent.endpoint,
    ...agent.protocols, ...(agent.assessment?.tools_or_skills ?? [])].filter(Boolean).join(' ').toLowerCase();
  return query.trim().toLowerCase().split(/\s+/).every((word) => haystack.includes(word));
}

export function discoverAgents(agents: Agent[], state: ExplorerState): { ranked: Agent[]; unranked: Agent[] } {
  const pool = agents.filter((agent) => !agent.is_reference_agent
    && (state.categories.length === 0 || state.categories.includes(agent.category))
    && state.filters.every((filter) => passesFilter(agent, filter)) && matchesSearch(agent, state.query));
  const byName = (a: Agent, b: Agent) => a.name.localeCompare(b.name) || a.agent_id.localeCompare(b.agent_id);
  return {
    ranked: pool.filter((a) => isSortable(a, state.sort)).sort((a, b) => compareAgents(a, b, state.sort) || byName(a, b)),
    unranked: pool.filter((a) => !isSortable(a, state.sort)).sort(byName),
  };
}
