/**
 * Run the grid.
 *
 * Two cheap models — one OpenAI, one Anthropic — vote on every labelled item.
 * Two premium models each adjudicate the same votes, in both the cheap
 * presentation (votes only) and the expensive one (votes plus the original
 * evidence). Each premium model also answers alone, because if a solo model
 * matches the panel then the panel is theatre and we should say so. Finally
 * Claude Fable 5.1 reads the results table and recommends a structure, and we
 * record whether it agreed with the arithmetic.
 *
 * Run: npx tsx scripts/run-panel.mts
 * Needs: OPENAI_API_KEY, ANTHROPIC_API_KEY
 *
 * WHAT TWO VOTERS CHANGES. With three, a dissenter loses and the panel still
 * publishes. With two, every disagreement is a tie, so the no-decider baseline
 * abstains on exactly the items the voters found hard — and rescue/breakage,
 * which only count items where the voters agreed, cannot see the adjudicator's
 * main job. That is why split_resolved / split_missed exist: on this shape they
 * are the decider's real scorecard.
 *
 * It refuses to start on a partial roster.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadCorpus, type CorpusFile } from "../src/judge/corpus.js";
import { runPanel, type Member } from "../src/judge/panel.js";
import { priceSheet, scorePanel } from "../src/judge/metrics.js";
import { rankStructures, recommendStructure, renderMetrics } from "../src/judge/meta.js";
import {
  ROSTER,
  VENDOR_CONFIG,
  chooseModel,
  judgeFor,
  keysFromEnv,
  validateModels,
  type RosterSlot,
  type Vendor,
} from "../src/judge/provider.js";

const ROOT = join(import.meta.dirname, "..");
const OUT_DIR = join(ROOT, "runs");

/**
 * Prices per 1M tokens. Anthropic from the claude-api skill; the rest fetched
 * 2026-09-04. Kept here rather than in library code because they move, and a
 * stale constant compiled into the scorer would silently misreport every run.
 */
const PRICES = priceSheet([
  { modelId: "claude-fable-5-1", input: 10, output: 50 },
  { modelId: "claude-opus-5", input: 5, output: 25 },
  { modelId: "claude-sonnet-5", input: 2, output: 10 },
  { modelId: "claude-haiku-4-5-20251001", input: 1, output: 5 },
  { modelId: "gpt-5.5", input: 5, output: 30 },
  { modelId: "gpt-5.4-mini", input: 0.75, output: 4.5 },
  { modelId: "gpt-5.4-nano", input: 0.2, output: 1.25 },
]);

const keys = keysFromEnv();
// An org-scoped Anthropic key is rejected on every request until it names a
// workspace; a workspace-scoped key ignores this entirely.
const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID;
const { ok, missing } = await validateModels(ROSTER, keys, undefined, workspaceId);

if (missing.length > 0) {
  console.error("PREFLIGHT FAILED. The run did not start.\n");
  console.error("Harness capability defects (ours to fix; nothing here is a finding about any subject):\n");
  const byVendor = new Map<Vendor, string[]>();
  for (const m of missing) {
    const list = byVendor.get(m.choice.vendor) ?? [];
    list.push(`${m.choice.slot} (${m.choice.id}): ${m.detail}`);
    byVendor.set(m.choice.vendor, list);
  }
  for (const [vendor, details] of byVendor) {
    const cfg = VENDOR_CONFIG[vendor];
    console.error(`  capability ${cfg.capability}`);
    console.error(`    provision: ${cfg.provisioning}`);
    for (const d of details) console.error(`    - ${d}`);
  }
  console.error(`\n${ok.length} of ${ROSTER.length} models reachable. A partial roster is a different experiment, not a smaller one.`);
  if (missing.some((m) => m.detail.includes("workspace"))) {
    console.error("\nThe Anthropic key is org-scoped. Set ANTHROPIC_WORKSPACE_ID, or use a workspace-scoped key.");
  }
  process.exit(1);
}

for (const m of ROSTER.filter((r) => !r.verified)) {
  console.log(`note: ${m.slot} id ${m.id} was unverified in source; confirmed against the live models listing`);
}

const corpus = JSON.parse(readFileSync(join(ROOT, "corpus", "response-classification.json"), "utf8")) as CorpusFile;
const items = loadCorpus(corpus, true);
console.log(`corpus ${corpus.corpus_version}: ${items.length} labelled items\n`);

const make = (slot: RosterSlot): Member => {
  const choice = chooseModel(slot);
  const vendor = choice.vendor;
  const key = keys[vendor];
  if (key === undefined) throw new Error(`unreachable: ${vendor} passed preflight without a key`);
  return {
    vendor,
    tier: choice.tier,
    modelId: choice.id,
    client: judgeFor(vendor, {
      apiKey: key,
      model: choice.id,
      baseUrl: VENDOR_CONFIG[vendor].baseUrl,
      ...(workspaceId === undefined ? {} : { workspaceId }),
    }),
  };
};

const voters = (["voter_1", "voter_2", "voter_3"] as const).map(make);
const deciders = (["decider_1", "decider_2", "decider_3"] as const).map(make);

console.log("roster:");
for (const m of [...voters, ...deciders]) console.log(`  ${m.tier.padEnd(8)} ${m.vendor.padEnd(10)} ${m.modelId}`);
console.log(`  meta     anthropic  ${chooseModel("meta").id}\n`);

const run = await runPanel(items, {
  voters,
  deciders,
  modes: ["votes_only", "votes_and_evidence"],
  solos: deciders,
  onProgress: (done, total) => {
    if (done % 10 === 0 || done === total) console.log(`  ${done}/${total}`);
  },
});

const metrics = scorePanel(run, items, PRICES);
const ranking = rankStructures(metrics);

// The meta pass. Its pick is explanatory; ranking.winner is authoritative.
const metaModel = chooseModel("meta");
const recommendation = await recommendStructure(
  metrics,
  ranking,
  judgeFor("anthropic", {
    apiKey: keys.anthropic!,
    model: metaModel.id,
    ...(workspaceId === undefined ? {} : { workspaceId }),
  }),
  metaModel.id,
);

mkdirSync(OUT_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const artifact = { run, metrics, ranking, recommendation, prices: PRICES };
const outPath = join(OUT_DIR, `panel-${stamp}.json`);
writeFileSync(outPath, `${JSON.stringify(artifact, null, 2)}\n`);

console.log(`\n${renderMetrics(metrics, ranking)}\n`);
console.log(`arithmetic winner: ${ranking.winner ?? "(none — every structure is flagged)"}`);
console.log(`model pick:        ${recommendation.model_pick}`);
console.log(`model reason:      ${recommendation.model_reason}`);
console.log(recommendation.agrees ? "the model agrees with the table." : "THE MODEL DISAGREES WITH THE TABLE — this is a finding, investigate before shipping either.");
console.log(`\nartifact: ${outPath}`);
