/**
 * Commerce job access, abstracted (SPEC 12, Track A stage A6).
 *
 * Every consumer talks to a CommerceSource, never to a platform API or
 * contract directly, for the same reason the chain path goes through
 * ChainSource: the ingest logic has to be testable without the network, and
 * SPEC 5.6 forbids a serving-path dependency on anyone else's schema. Commerce
 * outcomes are research inputs (they become calibration labels), so a platform
 * changing its API must never break the API we serve.
 *
 * No test in this package touches the network; everything runs against
 * SimulatedCommerceSource.
 */

/** Platforms that publish job outcomes we can use as ground truth (SPEC 12). */
export type CommercePlatform = "olas" | "virtuals_acp";

/**
 * One job as the platform reports it, before any interpretation. `nativeState`
 * is the platform's own vocabulary, kept verbatim so the mapping to our
 * canonical outcomes stays auditable and a state we do not recognize is
 * visible rather than silently coerced.
 */
export type RawCommerceJob = {
  platform: CommercePlatform;
  /** Platform-local job identifier, used for idempotent ingest. */
  job_id: string;
  /** EIP-155 chain the job settled on. */
  chain_id: number;
  /**
   * The address performing the work, as the platform identifies it. This is
   * what linkage resolves to an ERC-8004 agent identity.
   */
  provider_address: string;
  /** The address paying for the work. */
  requester_address: string;
  /** The platform's own terminal state string, verbatim. */
  nativeState: string;
  /** Unix seconds when the job reached its terminal state. */
  settled_ts: number;
  settled_block: number;
  tx_hash: string | null;
};

export type FetchJobsParams = {
  chain_id: number;
  /** Inclusive lower bound on settled_block. */
  fromBlock: number;
  /** Inclusive upper bound on settled_block. */
  toBlock: number;
};

export interface CommerceSource {
  readonly platform: CommercePlatform;
  /** Chains this source can serve, as EIP-155 ids. */
  supportedChains(): readonly number[];
  /**
   * Terminal jobs settled within the block range, ascending by
   * (settled_block, job_id). May throw on a provider error; callers decide
   * how to retry.
   */
  fetchJobs(params: FetchJobsParams): Promise<RawCommerceJob[]>;
}

/**
 * Deterministic in-memory source for tests and for exercising the ingest
 * pipeline without a network. Jobs are returned in the same sorted order a
 * real source must guarantee.
 */
export class SimulatedCommerceSource implements CommerceSource {
  readonly platform: CommercePlatform;
  private readonly jobs: RawCommerceJob[];
  private readonly chains: number[];
  /** Set to make the next fetch throw once, for retry tests. */
  failNextFetch = false;

  constructor(platform: CommercePlatform, jobs: readonly RawCommerceJob[], chains?: readonly number[]) {
    this.platform = platform;
    this.jobs = [...jobs];
    this.chains = chains === undefined ? [...new Set(jobs.map((j) => j.chain_id))] : [...chains];
  }

  supportedChains(): readonly number[] {
    return this.chains;
  }

  async fetchJobs(params: FetchJobsParams): Promise<RawCommerceJob[]> {
    if (this.failNextFetch) {
      this.failNextFetch = false;
      throw new Error("simulated commerce source failure");
    }
    return this.jobs
      .filter(
        (j) =>
          j.chain_id === params.chain_id &&
          j.settled_block >= params.fromBlock &&
          j.settled_block <= params.toBlock,
      )
      .sort((a, b) => a.settled_block - b.settled_block || (a.job_id < b.job_id ? -1 : a.job_id > b.job_id ? 1 : 0));
  }
}
