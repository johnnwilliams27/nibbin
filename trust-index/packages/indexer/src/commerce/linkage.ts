/**
 * Linking a commerce job to an ERC-8004 agent identity (Track A stage A6:
 * "Outcome labels joined; coverage % reported").
 *
 * This is the join that makes calibration possible, and it is the weakest
 * link in the chain. A commerce platform identifies a provider by the address
 * that did the work. An ERC-8004 agent is an ERC-721 token with an owner and,
 * separately, a declared agent wallet. Nothing guarantees those are the same
 * address, and nothing on chain declares "this Olas service is that ERC-8004
 * agent".
 *
 * So linkage is evidence, not fact. Every link carries the method that
 * produced it and its strength, unlinked jobs are counted rather than dropped
 * silently, and the coverage report publishes both. A calibration result built
 * on a weak-linkage cohort is a weaker claim, and the reader has to be able to
 * see that.
 *
 * Deliberately NOT implemented: fuzzy matching on names or metadata. A wrong
 * link attributes another agent's outcomes to this one, which is worse than no
 * link at all: it does not merely lose a label, it manufactures a false one.
 */

/** How a provider address was resolved to an agent identity. */
export type LinkageMethod =
  /** The provider address equals the agent's declared agent_wallet. Strongest available. */
  | "agent_wallet"
  /** The provider address equals the agent identity's current owner. */
  | "owner_address"
  /**
   * The provider address equals an owner the identity had at the time the job
   * settled, recovered from transfer history. Correct for jobs performed
   * before a sale, which agent_wallet and owner_address would both miss.
   */
  | "historical_owner";

/** Confidence in a link, used to weight or exclude a cohort. */
export type LinkageStrength = "strong" | "moderate";

export const METHOD_STRENGTH: Record<LinkageMethod, LinkageStrength> = {
  // The agent wallet is the address the identity itself declares as its
  // operating account, so a match is close to a direct assertion.
  agent_wallet: "strong",
  // An owner match is good evidence but an owner can operate several agents
  // from one address, so it can over-attribute.
  owner_address: "moderate",
  // Same caveat as owner_address, plus reliance on transfer history being
  // complete for the epoch in question.
  historical_owner: "moderate",
};

/** The agent-identity facts linkage resolves against, as materialized by the indexer. */
export type AgentIdentityRef = {
  chain_id: number;
  agent_id: string;
  owner_address: string;
  agent_wallet: string | null;
  /** Prior owners with the block range they held the identity, ascending. */
  ownership_history?: ReadonlyArray<{
    owner_address: string;
    from_block: number;
    /** Exclusive upper bound; null while still held. */
    to_block: number | null;
  }>;
};

export type LinkResult =
  | {
      linked: true;
      chain_id: number;
      agent_id: string;
      method: LinkageMethod;
      strength: LinkageStrength;
    }
  | { linked: false; reason: string };

function eq(a: string | null | undefined, b: string): boolean {
  return a !== null && a !== undefined && a.toLowerCase() === b.toLowerCase();
}

/**
 * Resolve one provider address, on one chain, at one block.
 *
 * Ambiguity is a refusal, not a coin flip: if the address matches more than
 * one agent identity, the job is left unlinked with the count of candidates,
 * because attributing it to an arbitrary one of them would invent a label.
 * This is the same posture as SPEC 11.10's "exclude rather than guess".
 */
export function linkProvider(
  providerAddress: string,
  chainId: number,
  settledBlock: number,
  candidates: readonly AgentIdentityRef[],
): LinkResult {
  const onChain = candidates.filter((c) => c.chain_id === chainId);
  if (onChain.length === 0) {
    return { linked: false, reason: `no indexed agents on chain ${chainId}` };
  }

  // Strongest method first; within a method, an ambiguous match refuses.
  const byWallet = onChain.filter((c) => eq(c.agent_wallet, providerAddress));
  if (byWallet.length === 1) {
    const hit = byWallet[0]!;
    return {
      linked: true,
      chain_id: hit.chain_id,
      agent_id: hit.agent_id,
      method: "agent_wallet",
      strength: METHOD_STRENGTH.agent_wallet,
    };
  }
  if (byWallet.length > 1) {
    return { linked: false, reason: `ambiguous agent_wallet match across ${byWallet.length} agents` };
  }

  const byOwner = onChain.filter((c) => eq(c.owner_address, providerAddress));
  if (byOwner.length === 1) {
    const hit = byOwner[0]!;
    return {
      linked: true,
      chain_id: hit.chain_id,
      agent_id: hit.agent_id,
      method: "owner_address",
      strength: METHOD_STRENGTH.owner_address,
    };
  }
  if (byOwner.length > 1) {
    return { linked: false, reason: `ambiguous owner_address match across ${byOwner.length} agents` };
  }

  // Historical owner: the identity may have changed hands since the job.
  const byHistory = onChain.filter((c) =>
    (c.ownership_history ?? []).some(
      (h) =>
        eq(h.owner_address, providerAddress) &&
        settledBlock >= h.from_block &&
        (h.to_block === null || settledBlock < h.to_block),
    ),
  );
  if (byHistory.length === 1) {
    const hit = byHistory[0]!;
    return {
      linked: true,
      chain_id: hit.chain_id,
      agent_id: hit.agent_id,
      method: "historical_owner",
      strength: METHOD_STRENGTH.historical_owner,
    };
  }
  if (byHistory.length > 1) {
    return { linked: false, reason: `ambiguous historical_owner match across ${byHistory.length} agents` };
  }

  return { linked: false, reason: "provider address matches no indexed agent identity" };
}

/**
 * Index candidates by every address that could resolve to them, so a large
 * cohort does not require a linear scan per job. Addresses are lowercased.
 */
export class LinkageIndex {
  private readonly byChain = new Map<number, AgentIdentityRef[]>();

  constructor(agents: readonly AgentIdentityRef[]) {
    for (const a of agents) {
      const list = this.byChain.get(a.chain_id);
      if (list === undefined) this.byChain.set(a.chain_id, [a]);
      else list.push(a);
    }
  }

  link(providerAddress: string, chainId: number, settledBlock: number): LinkResult {
    return linkProvider(providerAddress, chainId, settledBlock, this.byChain.get(chainId) ?? []);
  }
}
