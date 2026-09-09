// The BSC ERC-8004 population, as measured by our indexer. These are the numbers
// that make the case for the whole site: the registry is enormous and almost
// none of it is verifiable. Every figure here is measured, not estimated — if one
// cannot be re-derived from a run, it does not belong on this list.
export const CENSUS = {
  registeredAgents: 310_403,
  mcpExposed: 5_568,
  endpointVerified: 5,
  mintedPerDay: 2_448,
  withAnyFeedback: 509,
  chainId: 56,
  chainName: 'BNB Smart Chain',
} as const;

export const CENSUS_SOURCE = 'Nibbin indexer over the ERC-8004 identity registry on BSC, cross-read against 8004scan.';
