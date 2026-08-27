/**
 * TS mirror of the on-chain structs (SPEC §20.2) and the fixed-point
 * encodings that map ScoreResult fields onto them. The Solidity source in
 * /contracts must match these layouts exactly; Track C tests assert the
 * encoding round-trips.
 */
import type { ScoreResult } from "./score.js";

/** score/scoreLow/scoreHigh on chain: display value * 100 (2 decimals), or NULL_SCORE_SENTINEL. */
export const ORACLE_SCORE_DECIMALS = 2;
export const NULL_SCORE_SENTINEL = -1;
/** confidence on chain: basis points (confidence * 10000). */
export const ORACLE_CONFIDENCE_DECIMALS = 4;
/** nEff on chain: value * 100 (2 decimals). */
export const ORACLE_NEFF_DECIMALS = 2;

export const COVERAGE_TIER_CODE = { none: 0, thin: 1, moderate: 2, strong: 3 } as const;
export const LIFECYCLE_STATE_CODE = {
  placeholder: 0,
  registered: 1,
  live: 2,
  dormant: 3,
} as const;

/** methodologyVersion uint32: major*1_000_000 + minor*1_000 + patch. */
export function encodeMethodologyVersion(semver: string): number {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(semver);
  if (!m) throw new SyntaxError(`not a semver: ${semver}`);
  const [, maj, min, pat] = m;
  return Number(maj) * 1_000_000 + Number(min) * 1_000 + Number(pat);
}

/** Mirror of `struct AgentScore` in ScoreOracle.sol. */
export type OracleAgentScore = {
  score: number; // int32, -1 sentinel for null
  scoreLow: number; // int32
  scoreHigh: number; // int32
  confidence: number; // uint16 basis points
  nEff: number; // uint32, 2 decimals fixed point
  coverageTier: number; // uint8
  lifecycleState: number; // uint8
  ownershipEpoch: number; // uint32
  asOfBlock: number; // uint64
  methodologyVersion: number; // uint32
};

/** Encode a ScoreResult into the oracle struct. Pure; rounding is round-half-up via the *100/*10000 integer scalings the engine already produced. */
export function toOracleScore(r: ScoreResult): OracleAgentScore {
  const scale = (v: number | null, decimals: number): number =>
    v === null ? NULL_SCORE_SENTINEL : Math.round(v * 10 ** decimals);
  return {
    score: scale(r.score, ORACLE_SCORE_DECIMALS),
    scoreLow: scale(r.score_low, ORACLE_SCORE_DECIMALS),
    scoreHigh: scale(r.score_high, ORACLE_SCORE_DECIMALS),
    confidence: Math.round(r.confidence * 10 ** ORACLE_CONFIDENCE_DECIMALS),
    nEff: Math.round(r.n_eff * 10 ** ORACLE_NEFF_DECIMALS),
    coverageTier: COVERAGE_TIER_CODE[r.coverage_tier],
    lifecycleState: LIFECYCLE_STATE_CODE[r.lifecycle_state],
    ownershipEpoch: r.ownership_epoch,
    asOfBlock: r.as_of_block,
    methodologyVersion: encodeMethodologyVersion(r.methodology_version),
  };
}

/**
 * Merkle leaf preimage layout for AnchorRegistry (SPEC §20.1):
 * canonical JSON of these fields, hashed sha256. Field order is the sorted
 * key order of canonical JSON.
 */
export type AnchorLeaf = {
  chain_id: number;
  agent_id: string;
  methodology_version: string;
  inputs_hash: string;
  score: string | null; // DecimalString at score precision
  score_low: string | null;
  score_high: string | null;
  confidence: string;
  n_eff: string;
};
