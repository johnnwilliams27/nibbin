/**
 * Commerce ingest tests (Track A stage A6). Nothing here touches the network.
 */
import { describe, expect, it } from "vitest";
import { SimulatedCommerceSource, type RawCommerceJob } from "./commerceSource.js";
import {
  ACP_HAS_NO_DISPUTE_STATE,
  ACP_PHASES,
  VIRTUALS_ACP_MAPPING,
  knownStates,
  mapOutcome,
} from "./outcomeMapping.js";
import { LinkageIndex, linkProvider, type AgentIdentityRef } from "./linkage.js";
import {
  coveragePercent,
  formatCoverage,
  ingestRange,
  mergeCoverage,
  processJobs,
} from "./ingest.js";
import { OlasCommerceSource, VirtualsAcpCommerceSource, type HttpFetcher } from "./adapters.js";

const AGENT_WALLET = "0x00000000000000000000000000000000000000a1";
const OWNER = "0x00000000000000000000000000000000000000b1";
const REQUESTER = "0x00000000000000000000000000000000000000c1";

const agents: AgentIdentityRef[] = [
  { chain_id: 8453, agent_id: "1", owner_address: OWNER, agent_wallet: AGENT_WALLET },
  {
    chain_id: 8453,
    agent_id: "2",
    owner_address: "0x00000000000000000000000000000000000000b2",
    agent_wallet: null,
    ownership_history: [
      { owner_address: "0x00000000000000000000000000000000000000d2", from_block: 0, to_block: 500 },
      { owner_address: "0x00000000000000000000000000000000000000b2", from_block: 500, to_block: null },
    ],
  },
];

function job(over: Partial<RawCommerceJob> = {}): RawCommerceJob {
  return {
    platform: "olas",
    job_id: "j1",
    chain_id: 8453,
    provider_address: AGENT_WALLET,
    requester_address: REQUESTER,
    nativeState: "delivered",
    settled_ts: 1_780_000_000,
    settled_block: 1000,
    tx_hash: null,
    ...over,
  };
}

describe("outcome mapping", () => {
  it("maps the documented Olas states", () => {
    expect(mapOutcome("olas", "delivered")).toMatchObject({ mapped: true, outcome: "completed" });
    expect(mapOutcome("olas", "disputed")).toMatchObject({ mapped: true, outcome: "disputed" });
    expect(mapOutcome("olas", "slashed")).toMatchObject({ mapped: true, outcome: "disputed" });
    expect(mapOutcome("olas", "cancelled")).toMatchObject({ mapped: true, outcome: "rejected" });
    expect(mapOutcome("olas", "expired")).toMatchObject({ mapped: true, outcome: "abandoned" });
  });

  it("maps the verified Virtuals ACP terminal phases", () => {
    // Phases are integers on JobPhaseUpdated, verified against the ACP SDK enum
    // and the Sourcify-verified implementation on Base.
    expect(mapOutcome("virtuals_acp", String(ACP_PHASES.COMPLETED))).toMatchObject({
      mapped: true,
      outcome: "completed",
    });
    expect(mapOutcome("virtuals_acp", String(ACP_PHASES.REJECTED))).toMatchObject({
      mapped: true,
      outcome: "rejected",
    });
    expect(mapOutcome("virtuals_acp", String(ACP_PHASES.EXPIRED))).toMatchObject({
      mapped: true,
      outcome: "abandoned",
    });
  });

  it("leaves non-terminal ACP phases unmapped rather than inventing an outcome", () => {
    // A job still in negotiation has not resolved. Calling that an abandonment
    // would manufacture a failure the contract never recorded.
    for (const phase of [ACP_PHASES.REQUEST, ACP_PHASES.NEGOTIATION, ACP_PHASES.TRANSACTION, ACP_PHASES.EVALUATION]) {
      expect(mapOutcome("virtuals_acp", String(phase)).mapped).toBe(false);
    }
  });

  it("produces no disputed outcome from ACP, because the contract has no dispute phase", () => {
    // This is a limitation of the source, not of the mapping: SPEC 12.3
    // evaluates discrimination on completed versus disputed, and ACP alone can
    // never populate the negative class.
    expect(ACP_HAS_NO_DISPUTE_STATE).toBe(true);
    for (const e of VIRTUALS_ACP_MAPPING) expect(e.outcome).not.toBe("disputed");
  });

  it("is case and whitespace insensitive", () => {
    expect(mapOutcome("olas", "  DELIVERED ")).toMatchObject({ mapped: true, outcome: "completed" });
  });

  it("never guesses an unknown state", () => {
    const r = mapOutcome("olas", "quantum_superposition");
    expect(r.mapped).toBe(false);
    if (!r.mapped) expect(r.reason).toContain("unrecognized");
    expect(mapOutcome("olas", "   ").mapped).toBe(false);
  });

  it("exposes its known states for the methodology page", () => {
    expect(knownStates("olas")).toContain("slashed");
    expect(knownStates("virtuals_acp")).toContain(String(ACP_PHASES.COMPLETED));
  });
});

describe("linkage", () => {
  it("prefers the agent wallet, the strongest evidence", () => {
    const r = linkProvider(AGENT_WALLET, 8453, 1000, agents);
    expect(r).toMatchObject({ linked: true, agent_id: "1", method: "agent_wallet", strength: "strong" });
  });

  it("falls back to the current owner", () => {
    const r = linkProvider(OWNER, 8453, 1000, agents);
    expect(r).toMatchObject({ linked: true, agent_id: "1", method: "owner_address", strength: "moderate" });
  });

  it("resolves a historical owner for a job settled before a transfer", () => {
    const r = linkProvider("0x00000000000000000000000000000000000000d2", 8453, 400, agents);
    expect(r).toMatchObject({ linked: true, agent_id: "2", method: "historical_owner" });
  });

  it("does not use a historical owner outside its holding window", () => {
    const r = linkProvider("0x00000000000000000000000000000000000000d2", 8453, 600, agents);
    expect(r.linked).toBe(false);
  });

  it("refuses an ambiguous match rather than picking one", () => {
    // Two agents declaring the same wallet: attributing the job to either
    // would invent a label.
    const dupes: AgentIdentityRef[] = [
      { chain_id: 8453, agent_id: "10", owner_address: OWNER, agent_wallet: AGENT_WALLET },
      { chain_id: 8453, agent_id: "11", owner_address: OWNER, agent_wallet: AGENT_WALLET },
    ];
    const r = linkProvider(AGENT_WALLET, 8453, 1000, dupes);
    expect(r.linked).toBe(false);
    if (!r.linked) expect(r.reason).toContain("ambiguous");
  });

  it("is case insensitive on addresses", () => {
    expect(linkProvider(AGENT_WALLET.toUpperCase(), 8453, 1000, agents).linked).toBe(true);
  });

  it("does not link across chains", () => {
    expect(linkProvider(AGENT_WALLET, 10, 1000, agents).linked).toBe(false);
  });
});

describe("ingest", () => {
  const index = new LinkageIndex(agents);
  const params = { chain_id: 8453, fromBlock: 0, toBlock: 10_000 };

  it("produces labels and counts every drop reason", () => {
    const { records, coverage } = processJobs(
      [
        job({ job_id: "a", nativeState: "delivered" }),
        job({ job_id: "b", nativeState: "disputed" }),
        job({ job_id: "c", nativeState: "not_a_real_state" }),
        job({ job_id: "d", provider_address: "0x00000000000000000000000000000000000000ff" }),
      ],
      index,
      "olas",
      params,
    );
    expect(records).toHaveLength(2);
    expect(coverage.fetched).toBe(4);
    expect(coverage.ingested).toBe(2);
    expect(coverage.dropped.unmappable_state).toBe(1);
    expect(coverage.dropped.unlinked_provider).toBe(1);
    expect(coverage.unmappedStates["not_a_real_state"]).toBe(1);
    expect(coverage.outcomes.completed).toBe(1);
    expect(coverage.outcomes.disputed).toBe(1);
    expect(coveragePercent(coverage)).toBe("50.00");
  });

  it("counts an ambiguous linkage separately from no match", () => {
    const dupeIndex = new LinkageIndex([
      { chain_id: 8453, agent_id: "10", owner_address: OWNER, agent_wallet: AGENT_WALLET },
      { chain_id: 8453, agent_id: "11", owner_address: OWNER, agent_wallet: AGENT_WALLET },
    ]);
    const { coverage } = processJobs([job()], dupeIndex, "olas", params);
    expect(coverage.dropped.ambiguous_linkage).toBe(1);
    expect(coverage.dropped.unlinked_provider).toBe(0);
  });

  it("emits an ISO second-precision timestamp matching the snapshot contract", () => {
    const { records } = processJobs([job({ settled_ts: 1_780_000_000 })], index, "olas", params);
    expect(records[0]!.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it("is deterministic in output order", () => {
    const jobs = [
      job({ job_id: "z", settled_block: 2000 }),
      job({ job_id: "a", settled_block: 1000 }),
      job({ job_id: "m", settled_block: 1000 }),
    ];
    const first = processJobs(jobs, index, "olas", params).records.map((r) => r.job_id);
    const second = processJobs([...jobs].reverse(), index, "olas", params).records.map((r) => r.job_id);
    expect(first).toEqual(["a", "m", "z"]);
    expect(second).toEqual(first);
  });

  it("carries linkage strength through so a weak cohort is visible", () => {
    const { records, coverage } = processJobs(
      [job({ job_id: "w" }), job({ job_id: "o", provider_address: OWNER })],
      index,
      "olas",
      params,
    );
    expect(records.find((r) => r.job_id === "w")!.linkage_strength).toBe("strong");
    expect(records.find((r) => r.job_id === "o")!.linkage_strength).toBe("moderate");
    expect(coverage.linkage.agent_wallet).toBe(1);
    expect(coverage.linkage.owner_address).toBe(1);
  });

  it("reports zero coverage without dividing by zero on an empty range", () => {
    const { coverage } = processJobs([], index, "olas", params);
    expect(coveragePercent(coverage)).toBe("0.00");
    expect(formatCoverage(coverage)).toContain("fetched 0");
  });

  it("unions distinct agents when merging ranges rather than double counting", () => {
    const a = processJobs([job({ job_id: "a" })], index, "olas", params).coverage;
    const b = processJobs([job({ job_id: "b", settled_block: 2000 })], index, "olas", params).coverage;
    const merged = mergeCoverage([a, b], "olas-all");
    // The same agent in both ranges is one agent, not two.
    expect(merged.distinctAgents).toBe(1);
    expect(merged.fetched).toBe(2);
    expect(merged.ingested).toBe(2);
  });

  it("refuses a chain the source does not serve", async () => {
    const source = new SimulatedCommerceSource("virtuals_acp", [], [8453]);
    await expect(ingestRange(source, index, { chain_id: 137, fromBlock: 0, toBlock: 1 })).rejects.toThrow(
      /does not serve chain/,
    );
  });

  it("runs end to end against a simulated source", async () => {
    const source = new SimulatedCommerceSource("olas", [
      job({ job_id: "a", settled_block: 100 }),
      job({ job_id: "b", settled_block: 200, nativeState: "slashed" }),
      job({ job_id: "out-of-range", settled_block: 99_999 }),
    ]);
    const { records, coverage } = await ingestRange(source, index, {
      chain_id: 8453,
      fromBlock: 0,
      toBlock: 1000,
    });
    expect(records.map((r) => r.job_id)).toEqual(["a", "b"]);
    expect(coverage.outcomes.disputed).toBe(1);
  });
});

describe("adapters", () => {
  const okFetcher = (body: unknown): HttpFetcher => async () => ({
    ok: true,
    status: 200,
    json: async () => body,
  });

  it("parses an Olas response into raw jobs", async () => {
    const source = new OlasCommerceSource({
      baseUrl: "https://olas.invalid/api",
      timeoutMs: 1000,
      fetcher: okFetcher({
        jobs: [
          {
            id: "olas-1",
            providerAddress: AGENT_WALLET.toUpperCase(),
            requesterAddress: REQUESTER,
            state: "delivered",
            settledTimestamp: 1_780_000_000,
            settledBlock: 1234,
            txHash: "0xabc",
          },
        ],
      }),
    });
    const jobs = await source.fetchJobs({ chain_id: 8453, fromBlock: 0, toBlock: 2000 });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.provider_address).toBe(AGENT_WALLET);
    expect(jobs[0]!.nativeState).toBe("delivered");
  });

  it("parses a Virtuals ACP response into raw jobs", async () => {
    const source = new VirtualsAcpCommerceSource({
      baseUrl: "https://virtuals.invalid/api",
      timeoutMs: 1000,
      fetcher: okFetcher({
        data: [
          {
            jobId: "acp-1",
            providerWallet: AGENT_WALLET,
            clientWallet: REQUESTER,
            phase: "evaluation_failed",
            settledAt: 1_780_000_000,
            blockNumber: 4321,
            transactionHash: null,
          },
        ],
      }),
    });
    const jobs = await source.fetchJobs({ chain_id: 8453, fromBlock: 0, toBlock: 9999 });
    expect(jobs[0]!.nativeState).toBe("evaluation_failed");
    expect(jobs[0]!.tx_hash).toBeNull();
  });

  it("fails loudly on an unexpected response shape rather than returning empty", async () => {
    // The wire format is UNVERIFIED, so a wrong guess must be a loud parse
    // error, never a silent zero-label ingest that reads as poor coverage.
    const source = new OlasCommerceSource({
      baseUrl: "https://olas.invalid/api",
      timeoutMs: 1000,
      fetcher: okFetcher({ results: [] }),
    });
    await expect(source.fetchJobs({ chain_id: 8453, fromBlock: 0, toBlock: 1 })).rejects.toThrow(
      /expected an array/,
    );
  });

  it("fails on a missing required field", async () => {
    const source = new OlasCommerceSource({
      baseUrl: "https://olas.invalid/api",
      timeoutMs: 1000,
      fetcher: okFetcher({ jobs: [{ id: "x", providerAddress: AGENT_WALLET }] }),
    });
    await expect(source.fetchJobs({ chain_id: 8453, fromBlock: 0, toBlock: 1 })).rejects.toThrow(
      /expected non-empty string/,
    );
  });

  it("surfaces an HTTP error", async () => {
    const source = new OlasCommerceSource({
      baseUrl: "https://olas.invalid/api",
      timeoutMs: 1000,
      fetcher: async () => ({ ok: false, status: 503, json: async () => ({}) }),
    });
    await expect(source.fetchJobs({ chain_id: 8453, fromBlock: 0, toBlock: 1 })).rejects.toThrow(/HTTP 503/);
  });
});
