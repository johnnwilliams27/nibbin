import { readFileSync } from "node:fs";
import { computeSyntheticScoreResult } from "./src/lib/synthetic-estimator.ts";

const manifest = JSON.parse(readFileSync("../../fixtures/manifest.json", "utf8"));
for (const [key, c] of Object.entries<any>(manifest.cases)) {
  const snap = JSON.parse(readFileSync(`../../fixtures/snapshots/${c.snapshot}`, "utf8"));
  const r = computeSyntheticScoreResult(snap);
  console.log(
    key,
    JSON.stringify({
      score: r.score,
      low: r.score_low,
      high: r.score_high,
      n_eff: r.n_eff,
      conf: r.confidence,
      tier: r.coverage_tier,
      lifecycle: r.lifecycle_state,
      suppression: r.suppression_reason,
      epoch: r.ownership_epoch,
      eff_days: r.effective_history_days,
      contexts: Object.keys(r.scores_by_context),
    }),
  );
}
