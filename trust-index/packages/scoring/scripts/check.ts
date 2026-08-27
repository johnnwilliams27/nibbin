import { readFileSync, readdirSync } from "node:fs";
import { score } from "../src/index.js";
import type { AgentSnapshot } from "@trust-index/types";

const dir = new URL("../../../fixtures/snapshots/", import.meta.url);
for (const name of readdirSync(dir).sort()) {
  const snapshot = JSON.parse(readFileSync(new URL(name, dir), "utf8")) as AgentSnapshot;
  const { result } = score(snapshot);
  console.log(
    name,
    JSON.stringify({
      lifecycle: result.lifecycle_state,
      score: result.score,
      low: result.score_low,
      high: result.score_high,
      confidence: result.confidence,
      n_eff: result.n_eff,
      tier: result.coverage_tier,
      suppression: result.suppression_reason,
      epoch: result.ownership_epoch,
      eff_hist_days: result.effective_history_days,
      signals: result.signals,
      contexts: Object.keys(result.scores_by_context),
    }),
  );
}
