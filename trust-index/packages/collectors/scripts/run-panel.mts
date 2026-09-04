/**
 * Run the grid.
 *
 * Three cheap models from three labs vote on every labelled item. Three premium
 * models each adjudicate the same votes, in both the cheap presentation (votes
 * only) and the expensive one (votes plus the original evidence). Each premium
 * model also answers alone, because if a solo model matches the panel then the
 * panel is theatre and we should say so. Finally a Claude model reads the
 * results table and recommends a structure, and we record whether it agreed
 * with the arithmetic.
 *
 * Run: npx tsx scripts/run-panel.mts
 * Needs: OPENAI_API_KEY, ANTHROPIC_API_KEY, XAI_API_KEY
 *
 * It refuses to start on a partial roster. A two-vendor panel is not a smaller
 * version of this experiment; it is a different one whose agreement numbers
 * would be compared against three-vendor expectations and quietly mislead.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadCorpus, type CorpusFile } from "../src/judge/corpus.js";
import { runPanel, type Member } from "../src/judge/panel.js";
import { priceSheet, scorePanel } from "../src/judge/metrics.js";
import { rankStructures, recommendStructure, renderMetrics } from "../src/judge/meta.js";
import { ROSTER, VENDOR_CONFIG, chooseModel, judgeFor, keysFromEnv, validateModels, type Vendor } from "../src/judge/provider.js";

const ROOT = join(import.meta.dirname, "..");
const OUT_DIR = join(ROOT, "runs");

/**
 * Prices per 1M tokens. Anthropic from the claude-api skill; the rest fetched
 * 2026-09-04. Kept here rather than in library code because they move, and a
 * stale constant compiled into the scorer would silently misreport every run.
 */
const PRICES = priceSheet([
  { modelId: "claude-opus-5", input: 5, output: 25 },
  { modelId: "claude-haiku-4-5-20251001", input: 1, output: 5 },
  { modelId: "gpt-5", input: 1.25, output: 10 },
  { modelId: "gpt-5-mini", input: 0.25, output: 2 },
  { modelId: "grok-4", input: 3, output: 15 },
  { modelId: "grok-4-fast", input: 0.2, output: 0.5 },
]);

const keys = keysFromEnv();
const { ok, missing } = await validateModels(ROSTER, keys);

if (missing.length > 0) {
  console.error("PREFLIGHT FAILED. The run did not start.\n");
  console.error("Harness capability defects (ours to fix; nothing here is a finding about any subject):\n");
  const byVendor = new Map<Vendor, string[]>();
  for (const m of missing) {
    const list = byVendor.get(m.choice.vendor) ?? [];
    list.push(`${m.choice.tier} (${m.choice.id}): ${m.detail}`);
    byVendor.set(m.choice.vendor, list);
  }
  for (const [vendor, details] of byVendor) {
    const cfg = VENDOR_CONFIG[vendor];
    console.error(`  capability ${cfg.capability}`);
    console.error(`    provision: ${cfg.provisioning}`);
    for (const d of details) console.error(`    - ${d}`);
  }
  console.error(`\n${ok.length} of ${ROSTER.length} models reachable. A partial roster is a different experiment, not a smaller one.`);
  process.exit(1);
}

for (const m of ROSTER.filter((r) => !r.verified)) {
  console.log(`note: ${m.vendor} ${m.tier} id ${m.id} was unverified in source and has now been confirmed against the live models listing`);
}

const corpus = JSON.parse(readFileSync(join(ROOT, "corpus", "response-classification.json"), "utf8")) as CorpusFile;
const items = loadCorpus(corpus, true);
console.log(`corpus ${corpus.corpus_version}: ${items.length} labelled items\n`);

const make = (vendor: Vendor, tier: "cheap" | "premium"): Member => {
  const choice = chooseModel(vendor, tier);
  const key = keys[vendor];
  if (key === undefined) throw new Error(`unreachable: ${vendor} passed preflight without a key`);
  return {
    vendor,
    tier,
    modelId: choice.id,
    client: judgeFor(vendor, { apiKey: key, model: choice.id, baseUrl: VENDOR_CONFIG[vendor].baseUrl }),
  };
};

const voters = (["openai", "anthropic", "xai"] as const).map((v) => make(v, "cheap"));
const deciders = (["openai", "anthropic", "xai"] as const).map((v) => make(v, "premium"));

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
const metaModel = chooseModel("anthropic", "premium");
const recommendation = await recommendStructure(
  metrics,
  ranking,
  judgeFor("anthropic", { apiKey: keys.anthropic!, model: metaModel.id }),
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
