/**
 * Re-score a stored run under the current metrics. No model calls, no spend.
 *
 * This is the payoff of keeping scoring pure. The run artifact holds every vote
 * and every adjudication exactly as they came back; the metrics are a function
 * of that artifact. So a metric added after the fact — as `verdicts` and
 * `subsets` both were — applies retroactively to runs that are already paid
 * for, and a scoring bug is fixed by re-running this rather than by re-running
 * the experiment.
 *
 * It is also the honest way to change a measurement mid-analysis: the votes
 * cannot move to suit the new metric, because they were frozen before it
 * existed.
 *
 * Run: npx tsx scripts/rescore.mts [path/to/panel-*.json]
 *      (defaults to the newest artifact in runs/)
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadCorpus, type CorpusFile } from "../src/judge/corpus.js";
import { priceSheet, scorePanel } from "../src/judge/metrics.js";
import { rankStructures, renderMetrics } from "../src/judge/meta.js";
import type { PanelRun } from "../src/judge/panel.js";

const ROOT = join(import.meta.dirname, "..");
const RUNS = join(ROOT, "runs");

const PRICES = priceSheet([
  { modelId: "claude-fable-5-1", input: 10, output: 50 },
  { modelId: "claude-opus-5", input: 5, output: 25 },
  { modelId: "claude-sonnet-5", input: 2, output: 10 },
  { modelId: "claude-haiku-4-5-20251001", input: 1, output: 5 },
  { modelId: "gpt-5.5", input: 5, output: 30 },
  { modelId: "gpt-5.4-mini", input: 0.75, output: 4.5 },
  { modelId: "gpt-5.4-nano", input: 0.2, output: 1.25 },
]);

const explicit = process.argv[2];
const path =
  explicit ??
  join(
    RUNS,
    readdirSync(RUNS)
      .filter((f) => f.startsWith("panel-") && f.endsWith(".json"))
      .sort()
      .at(-1) ?? "",
  );

const artifact = JSON.parse(readFileSync(path, "utf8")) as { run: PanelRun };
const corpus = JSON.parse(
  readFileSync(join(ROOT, "corpus", "response-classification.json"), "utf8"),
) as CorpusFile;
const items = loadCorpus(corpus, true);

const metrics = scorePanel(artifact.run, items, PRICES);
const ranking = rankStructures(metrics);

console.log(`rescored ${path}\n`);
console.log(renderMetrics(metrics, ranking));
console.log(`\narithmetic winner: ${ranking.winner ?? "(none — every structure is flagged)"}`);

const out = path.replace(/\.json$/, "-rescored.json");
writeFileSync(out, `${JSON.stringify({ ...artifact, metrics, ranking }, null, 2)}\n`);
console.log(`\nwrote ${out}`);
