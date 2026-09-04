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
console.log("open questions that could overturn the choice:");
console.log("  - labels were Claude-drafted while Claude models were under test");
console.log("  - gpt-5.5 answered 97 of 120 items under our rate limit, not its own capability");
console.log("  - zero 'invention' items, the class the judge most exists to catch");

if (report?.health.available !== true) process.exitCode = 1;
