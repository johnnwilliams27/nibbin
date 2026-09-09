/**
 * Commerce ingest orchestration (Track A stage A6).
 *
 * Pipeline: fetch raw jobs from a CommerceSource, map each platform state to a
 * canonical outcome, link the provider to an ERC-8004 agent identity, and emit
 * the records plus a coverage report.
 *
 * Every stage that can lose a job counts what it lost and why. The A6 gate is
 * "outcome labels joined; coverage percent reported", and a coverage number is
 * only meaningful if the losses behind it are itemized: an ingest that quietly
 * drops 80 percent of jobs and reports the surviving 20 as clean labels would
 * pass a naive gate and poison every calibration downstream.
 */
import type { CommerceSource, FetchJobsParams, RawCommerceJob } from "./commerceSource.js";
import { mapOutcome, type CanonicalOutcome } from "./outcomeMapping.js";
import { LinkageIndex, type LinkageMethod, type LinkageStrength } from "./linkage.js";

/** A job that survived mapping and linkage: a calibration label. */
export type CommerceRecordRow = {
  chain_id: number;
  agent_id: string;
  /** The requester, which is the counterparty from the agent's perspective. */
  counterparty: string;
  outcome: CanonicalOutcome;
  block: number;
  /** ISO-8601 UTC, second precision, matching the snapshot contract. */
  ts: string;
  source: string;
  tx_hash: string | null;
  /** Retained so a cohort can be filtered or weighted by linkage confidence. */
  linkage_method: LinkageMethod;
  linkage_strength: LinkageStrength;
  /** Platform-local id, for idempotent upserts. */
  job_id: string;
};

export type DropReason =
  | "unmappable_state"
  | "unlinked_provider"
  | "ambiguous_linkage";

export type CoverageReport = {
  platform: string;
  chain_id: number;
  fromBlock: number;
  toBlock: number;
  /** Jobs the source returned. */
  fetched: number;
  /** Jobs that produced a usable label. */
  ingested: number;
  dropped: Record<DropReason, number>;
  /** Distinct native states we could not map, with counts. Drives mapping-table fixes. */
  unmappedStates: Record<string, number>;
  /** Ingested labels by canonical outcome. */
  outcomes: Record<CanonicalOutcome, number>;
  /** Ingested labels by linkage method, so a weak-linkage cohort is visible. */
  linkage: Record<LinkageMethod, number>;
  /** Distinct agents that received at least one label. */
  distinctAgents: number;
  /**
   * The agent keys behind distinctAgents ("chainId/agentId"), retained so
   * merging ranges can union them. Summing distinctAgents across ranges would
   * double-count any agent active in more than one, and this number is
   * published.
   */
  agentKeys: string[];
};

export type IngestResult = {
  records: CommerceRecordRow[];
  coverage: CoverageReport;
};

function isoSeconds(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function emptyCoverage(platform: string, params: FetchJobsParams): CoverageReport {
  return {
    platform,
    chain_id: params.chain_id,
    fromBlock: params.fromBlock,
    toBlock: params.toBlock,
    fetched: 0,
    ingested: 0,
    dropped: { unmappable_state: 0, unlinked_provider: 0, ambiguous_linkage: 0 },
    unmappedStates: {},
    outcomes: { completed: 0, rejected: 0, disputed: 0, abandoned: 0 },
    linkage: { agent_wallet: 0, owner_address: 0, historical_owner: 0 },
    distinctAgents: 0,
    agentKeys: [],
  };
}

/** Map and link a batch of already-fetched jobs. Pure, so it is directly testable. */
export function processJobs(
  jobs: readonly RawCommerceJob[],
  linkage: LinkageIndex,
  platform: string,
  params: FetchJobsParams,
): IngestResult {
  const coverage = emptyCoverage(platform, params);
  coverage.fetched = jobs.length;
  const records: CommerceRecordRow[] = [];
  const agents = new Set<string>();

  for (const job of jobs) {
    const mapping = mapOutcome(job.platform, job.nativeState);
    if (!mapping.mapped) {
      coverage.dropped.unmappable_state += 1;
      const key = job.nativeState.trim().toLowerCase() || "(empty)";
      coverage.unmappedStates[key] = (coverage.unmappedStates[key] ?? 0) + 1;
      continue;
    }

    const link = linkage.link(job.provider_address, job.chain_id, job.settled_block);
    if (!link.linked) {
      // An ambiguous match is a distinct failure from no match: it means the
      // index has the agent but cannot tell which one, which is a linkage
      // problem to fix rather than a coverage gap to accept.
      if (link.reason.startsWith("ambiguous")) coverage.dropped.ambiguous_linkage += 1;
      else coverage.dropped.unlinked_provider += 1;
      continue;
    }

    records.push({
      chain_id: link.chain_id,
      agent_id: link.agent_id,
      counterparty: job.requester_address.toLowerCase(),
      outcome: mapping.outcome,
      block: job.settled_block,
      ts: isoSeconds(job.settled_ts),
      source: job.platform,
      tx_hash: job.tx_hash,
      linkage_method: link.method,
      linkage_strength: link.strength,
      job_id: job.job_id,
    });
    coverage.outcomes[mapping.outcome] += 1;
    coverage.linkage[link.method] += 1;
    agents.add(`${link.chain_id}/${link.agent_id}`);
  }

  coverage.ingested = records.length;
  coverage.agentKeys = [...agents].sort();
  coverage.distinctAgents = agents.size;

  // Deterministic order, so a rerun writes the same rows in the same sequence.
  records.sort(
    (a, b) =>
      a.block - b.block ||
      (a.agent_id < b.agent_id ? -1 : a.agent_id > b.agent_id ? 1 : 0) ||
      (a.job_id < b.job_id ? -1 : a.job_id > b.job_id ? 1 : 0),
  );

  return { records, coverage };
}

/** Fetch, map, and link one block range from one source. */
export async function ingestRange(
  source: CommerceSource,
  linkage: LinkageIndex,
  params: FetchJobsParams,
): Promise<IngestResult> {
  if (!source.supportedChains().includes(params.chain_id)) {
    throw new Error(`${source.platform} does not serve chain ${params.chain_id}`);
  }
  const jobs = await source.fetchJobs(params);
  return processJobs(jobs, linkage, source.platform, params);
}

/** Coverage as a percentage of fetched jobs that produced a label, to two decimals. */
export function coveragePercent(c: CoverageReport): string {
  if (c.fetched === 0) return "0.00";
  return ((c.ingested / c.fetched) * 100).toFixed(2);
}

/** Human-readable coverage summary for the A6 gate and the runbook. */
export function formatCoverage(c: CoverageReport): string {
  const lines = [
    `${c.platform} chain ${c.chain_id} blocks ${c.fromBlock}-${c.toBlock}`,
    `  fetched ${c.fetched}, ingested ${c.ingested} (${coveragePercent(c)}%), agents ${c.distinctAgents}`,
    `  dropped: unmappable_state ${c.dropped.unmappable_state}, unlinked_provider ${c.dropped.unlinked_provider}, ambiguous_linkage ${c.dropped.ambiguous_linkage}`,
    `  outcomes: completed ${c.outcomes.completed}, rejected ${c.outcomes.rejected}, disputed ${c.outcomes.disputed}, abandoned ${c.outcomes.abandoned}`,
    `  linkage: agent_wallet ${c.linkage.agent_wallet}, owner_address ${c.linkage.owner_address}, historical_owner ${c.linkage.historical_owner}`,
  ];
  const unmapped = Object.entries(c.unmappedStates).sort();
  if (unmapped.length > 0) {
    lines.push(`  unmapped states: ${unmapped.map(([s, n]) => `${s} (${n})`).join(", ")}`);
  }
  return lines.join("\n");
}

/** Merge coverage across ranges or platforms for a single headline number. */
export function mergeCoverage(reports: readonly CoverageReport[], label: string): CoverageReport {
  const merged = emptyCoverage(label, {
    chain_id: reports[0]?.chain_id ?? 0,
    fromBlock: Math.min(...reports.map((r) => r.fromBlock)),
    toBlock: Math.max(...reports.map((r) => r.toBlock)),
  });
  const allAgents = new Set<string>();
  for (const r of reports) {
    merged.fetched += r.fetched;
    merged.ingested += r.ingested;
    for (const k of r.agentKeys) allAgents.add(k);
    for (const k of Object.keys(merged.dropped) as DropReason[]) merged.dropped[k] += r.dropped[k];
    for (const k of Object.keys(merged.outcomes) as CanonicalOutcome[]) merged.outcomes[k] += r.outcomes[k];
    for (const k of Object.keys(merged.linkage) as LinkageMethod[]) merged.linkage[k] += r.linkage[k];
    for (const [s, n] of Object.entries(r.unmappedStates)) {
      merged.unmappedStates[s] = (merged.unmappedStates[s] ?? 0) + n;
    }
  }
  merged.agentKeys = [...allAgents].sort();
  merged.distinctAgents = allAgents.size;
  return merged;
}
