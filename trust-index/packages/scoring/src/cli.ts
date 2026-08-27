#!/usr/bin/env node
/**
 * `agent-trust recompute` (UC-6, SPEC 13 `/recompute`). Prints the full
 * derivation for a locally held AgentSnapshot: every input, weight
 * component, per-context n_eff/alpha/beta/interval, and the final canonical
 * result. `--json` prints the canonical bytes only, so a caller can pipe
 * this straight into a byte comparison.
 *
 * This is the one file in packages/scoring that reads the filesystem. SPEC
 * 22 bans I/O in the scoring engine itself (src/index.ts and everything it
 * imports); this file sits on top of that engine as its only I/O boundary,
 * kept isolated here on purpose. The workspace eslint config currently bans
 * I/O imports across all of packages/scoring/**, which would also flag this
 * file; docs/NOTES-track-b.md records a request to the lead to scope that
 * ban so this one CLI entry point is exempt, since no exemption pattern was
 * available to apply without editing the shared config this track does not
 * own.
 *
 * Every number printed here is recomputed via the same exported functions
 * `score()` itself uses (scoreGroup, computeReviewerWeights, resolveEpoch,
 * classifyLifecycle): the derivation is a readable view of the real
 * computation, never a second, drifting implementation of it.
 */
import { readFileSync } from "node:fs";
import type { AgentSnapshot } from "@trust-index/types";
import { parseConstants } from "./constants.js";
import { resolveEpoch, inCurrentEpoch } from "./epochs.js";
import { parseFx } from "./fixedmath.js";
import { scoreGroup, score } from "./index.js";
import { classifyLifecycle } from "./lifecycle.js";
import { parseIsoUtcSeconds } from "./time.js";
import { computeReviewerWeights } from "./weights.js";

function readSnapshot(path: string): AgentSnapshot {
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw) as AgentSnapshot;
}

function printDerivation(snapshot: AgentSnapshot): void {
  const c = parseConstants(snapshot.constants);
  const asOfSec = parseIsoUtcSeconds(snapshot.as_of_ts);
  const epochInfo = resolveEpoch(snapshot);

  console.log(`agent-trust recompute`);
  console.log(`  chain: ${snapshot.chain_slug} (${snapshot.chain_id})  agent: ${snapshot.agent_id}`);
  console.log(`  as_of_block: ${snapshot.as_of_block}  as_of_ts: ${snapshot.as_of_ts}`);
  console.log(`  methodology_version: ${snapshot.constants.methodology_version}`);
  console.log("");
  console.log("ownership epoch");
  console.log(`  epoch: ${epochInfo.epoch}`);
  console.log(`  epoch_start_ts: ${epochInfo.lastResetTs ?? snapshot.registered_at}`);
  console.log(`  custody_migration_detected: ${epochInfo.custodyMigrationDetected}`);
  console.log("");

  let lastActivitySec: number | null = null;
  for (const t of [
    ...snapshot.feedback.map((f) => parseIsoUtcSeconds(f.ts)),
    ...snapshot.validations.map((v) => parseIsoUtcSeconds(v.ts)),
    ...snapshot.commerce.map((m) => parseIsoUtcSeconds(m.ts)),
  ]) {
    if (lastActivitySec === null || t > lastActivitySec) lastActivitySec = t;
  }
  const lifecycleState = classifyLifecycle(
    {
      metadataStatus: snapshot.metadata_status,
      declaredEndpoints: snapshot.declared_endpoints,
      agentWalletActive: snapshot.agent_wallet_active,
      lastActivitySec,
      asOfSec,
    },
    { liveWindowDays: c.liveWindowDays, dormantWindowDays: c.dormantWindowDays },
  );
  console.log(`lifecycle_state: ${lifecycleState}`);
  console.log("");

  const forceSuppressed = lifecycleState === "placeholder";
  const currentEpochFeedback = snapshot.feedback.filter(
    (f) => inCurrentEpoch(f.block, epochInfo) && !f.is_revoked,
  );
  const reviewerAddresses = [...new Set(currentEpochFeedback.map((f) => f.client_address))].sort();
  const reviewCountByAddress = new Map<string, number>();
  for (const f of currentEpochFeedback) {
    reviewCountByAddress.set(f.client_address, (reviewCountByAddress.get(f.client_address) ?? 0) + 1);
  }
  const reviewerSnapshots = reviewerAddresses.map((a) => {
    const r = snapshot.reviewers[a];
    if (r === undefined) throw new Error(`no reviewer snapshot for ${a}`);
    return r;
  });
  const reviewerWeights = computeReviewerWeights(reviewerSnapshots, reviewCountByAddress, asOfSec, c);
  const undecayedWeightByAddress = new Map(reviewerWeights.map((w) => [w.address, w.weightFx]));

  console.log(`reviewer weights (${reviewerWeights.length} current-epoch reviewers)`);
  for (const w of reviewerWeights) {
    console.log(
      `  ${w.address}  weight=${w.weightFx}  age=${w.components.age} cohort=${w.components.cohort} ` +
        `funder=${w.components.funder} velocity=${w.components.velocity} repeat=${w.components.repeat} ` +
        `commerce=${w.components.commerce} portfolio=${w.components.portfolio}`,
    );
  }
  console.log("");

  const tags = [...new Set(currentEpochFeedback.map((f) => f.tag1))].sort();
  for (const tag of [...tags, null] as (string | null)[]) {
    const label = tag === null ? "global" : `context: ${tag}`;
    const entries = tag === null ? currentEpochFeedback : currentEpochFeedback.filter((f) => f.tag1 === tag);
    const priorStr = tag === null ? snapshot.priors.global : (snapshot.priors.by_context[tag] ?? snapshot.priors.global);
    const group = scoreGroup(entries, parseFx(priorStr), c, asOfSec, undecayedWeightByAddress, forceSuppressed);
    console.log(label);
    console.log(`  feedback_count: ${group.feedbackCount}  unusable: ${group.unusableCount}`);
    console.log(`  n_eff: ${group.neffFx}  alpha: ${group.post.alphaFx}  beta: ${group.post.betaFx}`);
    console.log(
      `  mean: ${group.post.meanFx}  low: ${group.post.lowFx}  high: ${group.post.highFx}  ` +
        `confidence: ${group.post.confidenceFx}  suppressed: ${group.suppressed}`,
    );
    console.log("");
  }
}

function main(argv: string[]): void {
  const [command, ...rest] = argv;
  if (command !== "recompute") {
    console.error(`usage: agent-trust recompute --snapshot <path> [--json]`);
    process.exitCode = 1;
    return;
  }
  let snapshotPath: string | null = null;
  let jsonOnly = false;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--snapshot") {
      snapshotPath = rest[i + 1] ?? null;
      i += 1;
    } else if (arg === "--json") {
      jsonOnly = true;
    }
  }
  if (snapshotPath === null) {
    console.error(`usage: agent-trust recompute --snapshot <path> [--json]`);
    process.exitCode = 1;
    return;
  }

  const snapshot = readSnapshot(snapshotPath);
  const { canonicalBytes } = score(snapshot);

  if (jsonOnly) {
    console.log(canonicalBytes);
    return;
  }
  printDerivation(snapshot);
  console.log("canonical result");
  console.log(`  ${canonicalBytes}`);
}

main(process.argv.slice(2));
