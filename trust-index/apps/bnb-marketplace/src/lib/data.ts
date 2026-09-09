import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { CATEGORIES } from './categories';
import type { Agent, CategorySlug, Coverage, Dataset } from './types';
import { routeTokenId } from './routes';
import { normaliseDetailStatus, isCallable, isEndpointUnknown, isNotCallable } from './detail-state';

export { routeTokenId, agentHref } from './routes';
export { isCallable, isEndpointUnknown, isNotCallable } from './detail-state';

// Read at build time. Static export means the deployed site is a snapshot, so we
// carry generated_at through to the UI and label it — a stale number that says
// when it was taken beats a live-looking number that does not.
// TRUST_INDEX_DATA lets a maintainer render the site against an alternative
// snapshot (e.g. a slice derived from data/raw/) without touching the file the
// pipeline owns. Unset in every deploy; data/agents.json is the source of truth.
const DATA_PATH = process.env.TRUST_INDEX_DATA
  ? resolve(process.env.TRUST_INDEX_DATA)
  : resolve(process.cwd(), 'data/agents.json');

let cached: Dataset | null = null;

/**
 * The pipeline writes data/agents.json in parallel with this build. Missing,
 * empty, half-written or malformed are all normal states, not failures: we
 * return an empty dataset and the UI says so. We never fabricate rows.
 */
export function loadDataset(): Dataset {
  if (cached) return cached;

  let dataset: Dataset = { generated_at: null, agents: [], status: null };

  if (existsSync(DATA_PATH)) {
    try {
      const raw = readFileSync(DATA_PATH, 'utf8');
      if (raw.trim().length > 0) {
        const parsed = JSON.parse(raw) as Partial<Dataset>;
        if (parsed && Array.isArray(parsed.agents)) {
          dataset = {
            generated_at: typeof parsed.generated_at === 'string' ? parsed.generated_at : null,
            agents: parsed.agents.filter(isUsableAgent).map(normalise),
            ...(parsed.source?.kind === 'erc8004_registered_events' && Number.isSafeInteger(parsed.source.enumerated_records)
              ? { source: parsed.source } : {}),
            status: typeof parsed.status === 'string' && parsed.status.trim() ? parsed.status.trim() : null,
          };
        }
      }
    } catch {
      // Half-written file mid-run. Fall through to the empty dataset.
      dataset = { generated_at: null, agents: [], status: null };
    }
  }

  cached = dataset;
  return dataset;
}

/**
 * A row without an agent_id cannot be linked to or named honestly, so it is
 * dropped. token_id is deliberately NOT required: an agent can genuinely exist
 * without an ERC-8004 registration (registration costs gas that is not
 * sponsored), and silently dropping those would hide real agents — including our
 * own reference agent, which is precisely the row we must never hide.
 */
function isUsableAgent(a: unknown): a is Agent {
  if (!a || typeof a !== 'object') return false;
  const candidate = a as Partial<Agent>;
  return typeof candidate.agent_id === 'string' && candidate.agent_id.length > 0;
}

/**
 * Derived from CATEGORIES rather than listed again.
 *
 * This was a hand-written copy of the four original slugs, and normalise()
 * coerces anything not in it to `other`. Adding eight categories upstream while
 * this list stayed at four would have silently reverted all 7,362 newly
 * classified agents — the data right, the site showing the old answer, nothing
 * erroring.
 */
const KNOWN: CategorySlug[] = [...CATEGORIES.map((c) => c.slug), 'other'];

/** Defensive defaults only for presentation-safety. No score is ever invented here. */
function normalise(a: Agent): Agent {
  return {
    ...a,
    name: a.name?.trim() || (a.token_id ? `Agent #${a.token_id}` : 'Unnamed agent'),
    chain_id: typeof a.chain_id === 'number' ? a.chain_id : 0,
    token_id: typeof a.token_id === 'string' && a.token_id.length > 0 ? a.token_id : null,
    description: a.description ?? '',
    category: KNOWN.includes(a.category) ? a.category : 'other',
    category_confidence: typeof a.category_confidence === 'number' ? a.category_confidence : 0,
    category_evidence: a.category_evidence ?? '',
    protocols: Array.isArray(a.protocols) ? a.protocols : [],
    endpoint: a.endpoint ?? null,
    detail_status: normaliseDetailStatus(a.detail_status),
    x402_supported: a.x402_supported === true,
    is_reference_agent: a.is_reference_agent === true,
    assessment: a.assessment
      ? {
          ...a.assessment,
          tools_or_skills: Array.isArray(a.assessment.tools_or_skills) ? a.assessment.tools_or_skills : [],
          tool_count:
            typeof a.assessment.tool_count === 'number'
              ? a.assessment.tool_count
              : (a.assessment.tools_or_skills?.length ?? 0),
          gates_fired: Array.isArray(a.assessment.gates_fired) ? a.assessment.gates_fired : [],
          // Defaults to 1 = "this agent alone". An older snapshot carries no
          // fan-out, and claiming a shared measurement is exclusive would be
          // the inflation this field exists to expose.
          endpoint_shared_with:
            typeof a.assessment.endpoint_shared_with === 'number' ? a.assessment.endpoint_shared_with : 1,
          composite: typeof a.assessment.composite === 'number' ? a.assessment.composite : null,
          withheld_reason: a.assessment.withheld_reason ?? null,
        }
      : null,
  };
}

// ---------------------------------------------------------------------------
// Derived views
// ---------------------------------------------------------------------------

/** Every row in the snapshot, including rows that did not classify. */
export function allAgents(): Agent[] {
  return loadDataset().agents;
}

/**
 * The four categories this marketplace lists. Everything else in the registry is
 * indexed and counted, but not listed: an agent we cannot even place in a
 * category is not something we can help anyone hire, and padding the listings
 * with 9,800 unclassifiable rows would be the exact behaviour this site exists
 * to criticise. The count is reported on the landing page as a finding.
 */
const MARKETPLACE: CategorySlug[] = [
  'rebalancing', 'grid_trading', 'yield', 'health_factor',
  'payments', 'security', 'research', 'content',
  'development', 'automation', 'trading', 'staking',
];

/**
 * A listed category, OR an agent we actually called and scored.
 *
 * The category is a regex match against an agent's own self-written
 * description — self_reported, weight 0.15. Letting it decide visibility meant
 * agents we had dialled, exercised and SCORED were invisible while unmeasured
 * rows containing the word "yield" were listed. Ranking a measured agent below
 * an unmeasured one because a keyword missed is the inversion this product
 * exists to correct. `composite: null` still keeps a row out, so this cannot
 * pad the listings.
 */
export function listedAgents(): Agent[] {
  if (loadDataset().source?.kind === 'erc8004_registered_events') return allAgents();
  return allAgents().filter(
    (a) => MARKETPLACE.includes(a.category) || (a.assessment?.composite ?? null) !== null,
  );
}

/** Indexed but not placed in any of the four categories. Never silently dropped. */
export function unclassifiedCount(): number {
  return allAgents().length - listedAgents().length;
}

/**
 * Everything a ranking, sort, leaderboard or "top agent" claim is allowed to see.
 * Reference agents are ours; ranking our own deployments against third parties
 * would make every number on the site suspect. Contract rule 2.
 */
export function rankableAgents(): Agent[] {
  return listedAgents().filter((a) => !a.is_reference_agent);
}

export function referenceAgents(): Agent[] {
  return allAgents().filter((a) => a.is_reference_agent);
}

export function agentsInCategory(slug: CategorySlug): Agent[] {
  return pageableAgents().filter((a) => a.category === slug);
}

export function findAgent(chainId: string, tokenId: string): Agent | undefined {
  return pageableAgents().find((a) => String(a.chain_id) === String(chainId) && routeTokenId(a) === tokenId);
}

/** Agents that get their own page: the four categories, plus our reference agents. */
export function pageableAgents(): Agent[] {
  const listed = listedAgents();
  const seen = new Set(listed.map((a) => a.agent_id));
  return [...listed, ...referenceAgents().filter((a) => !seen.has(a.agent_id))];
}

export function isAssessed(a: Agent): boolean {
  return a.assessment !== null;
}

export function isRated(a: Agent): boolean {
  return a.assessment !== null && a.assessment.composite !== null;
}

export function hasGates(a: Agent): boolean {
  return (a.assessment?.gates_fired.length ?? 0) > 0;
}

export interface HeadlineStats {
  /** Every row in the snapshot, classified or not. */
  indexed: number;
  unclassified: number;
  total: number;
  callable: number;
  /** Read the detail, it declares no way in. A fact. */
  notCallable: number;
  /** Never read the detail — our rate-limit gap, not a fact about them. */
  endpointUnknown: number;
  assessed: number;
  rated: number;
  /** Distinct endpoints behind `rated`. Lower when registrations share a service. */
  ratedEndpoints: number;
  withheld: number;
  gatesFired: number;
  referenceCount: number;
}

/** Headline stats describe the third-party population, so reference agents are out. */
export function headlineStats(): HeadlineStats {
  const agents = rankableAgents();
  return {
    indexed: allAgents().length,
    unclassified: unclassifiedCount(),
    total: agents.length,
    callable: agents.filter(isCallable).length,
    notCallable: agents.filter(isNotCallable).length,
    endpointUnknown: agents.filter(isEndpointUnknown).length,
    assessed: agents.filter(isAssessed).length,
    rated: agents.filter(isRated).length,
    // Distinct ENDPOINTS behind those rated rows. A composite measures a
    // service, and 229 of the rated rows share one endpoint, so quoting the row
    // count alone turns 13 measured services into "239 rated agents". The
    // headline states both.
    ratedEndpoints: new Set(agents.filter(isRated).map((a) => a.endpoint).filter(Boolean)).size,
    withheld: agents.filter((a) => a.assessment !== null && a.assessment.composite === null).length,
    gatesFired: agents.filter(hasGates).length,
    referenceCount: referenceAgents().length,
  };
}

export interface CategoryStats {
  total: number;
  callable: number;
  notCallable: number;
  endpointUnknown: number;
  assessed: number;
  rated: number;
  withheld: number;
  gatesFired: number;
  strongCoverage: number;
  medianComposite: number | null;
  medianToolCount: number | null;
  referenceCount: number;
}

/** Same computation for all four categories. No category gets a richer summary. */
export function categoryStats(slug: CategorySlug): CategoryStats {
  const inCategory = pageableAgents().filter((a) => a.category === slug);
  const ranked = inCategory.filter((a) => !a.is_reference_agent);
  const composites = ranked
    .map((a) => a.assessment?.composite)
    .filter((c): c is number => typeof c === 'number');
  const toolCounts = ranked
    .map((a) => a.assessment?.tool_count)
    .filter((c): c is number => typeof c === 'number');

  return {
    total: ranked.length,
    callable: ranked.filter(isCallable).length,
    notCallable: ranked.filter(isNotCallable).length,
    endpointUnknown: ranked.filter(isEndpointUnknown).length,
    assessed: ranked.filter(isAssessed).length,
    rated: ranked.filter(isRated).length,
    withheld: ranked.filter((a) => a.assessment !== null && a.assessment.composite === null).length,
    gatesFired: ranked.filter(hasGates).length,
    strongCoverage: ranked.filter((a) => a.assessment?.coverage === 'strong').length,
    medianComposite: median(composites),
    medianToolCount: median(toolCounts),
    referenceCount: inCategory.filter((a) => a.is_reference_agent).length,
  };
}

export function allCategoryStats(): Array<{ meta: (typeof CATEGORIES)[number]; stats: CategoryStats }> {
  return CATEGORIES.map((meta) => ({ meta, stats: categoryStats(meta.slug) }));
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export const COVERAGE_RANK: Record<Coverage, number> = { thin: 1, moderate: 2, strong: 3 };

/** Every distinct gate name in the dataset — used to build the gate filter honestly. */
export function knownGates(): string[] {
  const seen = new Set<string>();
  for (const a of allAgents()) {
    for (const g of a.assessment?.gates_fired ?? []) seen.add(g);
  }
  return [...seen].sort();
}
