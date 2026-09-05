/**
 * Is the judge configured, and can it actually be used?
 *
 * One real call, not a catalogue lookup. A models listing passes on an account
 * with no credits and no rate-limit headroom, which is how a run once made 255
 * calls, received 255 rate-limit errors, and still printed a ranking.
 *
 * Run: npx tsx scripts/judge-status.mts
 */
import { preflight } from "../src/capability.js";
import {
  judgeCapabilityProbe,
  judgeFromEnv,
  PRODUCTION_JUDGE_EVIDENCE,
  PRODUCTION_JUDGE_MODEL,
} from "../src/judge/production.js";

const judge = judgeFromEnv();
const report = (await preflight([judgeCapabilityProbe(judge)])).values().next().value;

console.log(`model:     ${PRODUCTION_JUDGE_MODEL}`);
console.log(`observer:  ${judge?.observerId ?? "(none — ANTHROPIC_API_KEY is not set)"}`);
console.log(
  `health:    ${report?.health.available === true ? "available" : `UNAVAILABLE — ${report?.health.available === false ? `${report.health.reason}: ${report.health.detail}` : "unknown"}`}`,
);
console.log("");
console.log("chosen by measurement, not preference:");
console.log(`  benchmark:      ${PRODUCTION_JUDGE_EVIDENCE.run}`);
console.log(`  items:          ${PRODUCTION_JUDGE_EVIDENCE.corpus_items}`);
console.log(
  `  cov_accuracy:   ${PRODUCTION_JUDGE_EVIDENCE.coverage_adjusted_accuracy} ` +
    `[${PRODUCTION_JUDGE_EVIDENCE.ci95[0]}, ${PRODUCTION_JUDGE_EVIDENCE.ci95[1]}]`,
);
console.log(`  resolution:     gaps under ${PRODUCTION_JUDGE_EVIDENCE.resolution_points} points are not distinguishable at this n`);
console.log("");
console.log("measured on the class a structural check cannot do:");
console.log("  invention recall   6/6    (4/6 under judge.v1)");
console.log("  false accusations  1/25   (the heuristic that found the candidates: 81% false positive)");
console.log("                            the one accusation is a case labelled borderline before the run;");
console.log("                            the label was left alone rather than revised to flatter the score");
console.log("");
console.log("closed since the decision:");
console.log("  - label conflict bounded: 12 of 120 disputed; flipping all 12 leaves the");
console.log("    conclusion intact by 12.5 points against a 5.4-point resolution");
console.log("  - invention class now measured, having been unmeasurable at decision time");
console.log("");
console.log("still open:");
console.log("  - gpt-5.5 answered 97 of 120 items under our rate limit, not its own capability");
console.log(`  - the headline was ${PRODUCTION_JUDGE_EVIDENCE.headline_measured_on}.`);
console.log("    The call site is fixed and the invention class was re-measured on the running");
console.log(`    configuration (${PRODUCTION_JUDGE_EVIDENCE.invention_recall_after_fix}), but the 120-item number has not been re-earned.`);

if (report?.health.available !== true) process.exitCode = 1;
