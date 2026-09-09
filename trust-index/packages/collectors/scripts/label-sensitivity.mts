/**
 * How much could the labels being wrong change the answer?
 *
 * The ground truth was drafted by a Claude model while Claude models were under
 * test. The obvious remedy is a human review pass, and it should still happen —
 * but before spending anyone's afternoon it is worth asking how much is
 * actually at stake. If the conclusions survive flipping every label the models
 * disputed, the conflict is real and immaterial, and that is worth knowing.
 *
 * The method is deliberately hostile to my own labelling. For each item, count
 * how many of the six judgements disagreed with the label. Then flip the most
 * contested items to whatever the models collectively preferred — that is, ASSUME
 * I WAS WRONG AND THEY WERE RIGHT, on exactly the items where they were most
 * confident I was — and re-score.
 *
 * This is an upper bound on the damage, not an estimate of it. Flipping a label
 * to the model consensus mechanically raises every model's score on that item,
 * so the resulting accuracies are inflated for everyone. What it can still
 * answer honestly is the ORDERING: whether the panel still loses to a single
 * model, and by how much the gap moves.
 *
 * Run: npx tsx scripts/label-sensitivity.mts [path/to/panel-*.json]
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadCorpus, type CorpusFile } from "../src/judge/corpus.js";
import { priceSheet, scorePanel } from "../src/judge/metrics.js";
import { rankStructures } from "../src/judge/meta.js";
import type { PanelItem, PanelRun } from "../src/judge/panel.js";

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

const path =
  process.argv[2] ??
  join(RUNS, readdirSync(RUNS).filter((f) => f.startsWith("panel-") && f.endsWith(".json")).sort().at(-1) ?? "");
const artifact = JSON.parse(readFileSync(path, "utf8")) as { run: PanelRun };
const corpus = JSON.parse(readFileSync(join(ROOT, "corpus", "response-classification.json"), "utf8")) as CorpusFile;
const items = loadCorpus(corpus, true);

// ---- how contested is each label? -------------------------------------------
type Contest = { id: string; label: string; against: number; total: number; preferred: string | null };
const contests: Contest[] = [];

for (const record of artifact.run.records) {
  const item = items.find((i) => i.id === record.item_id);
  if (item?.label == null) continue;
  const verdicts: string[] = [];
  for (const v of record.votes) if (v.ok) verdicts.push(v.verdict);
  for (const d of artifact.run.decisions) if (d.item_id === record.item_id && d.ok) verdicts.push(d.verdict);
  if (verdicts.length === 0) continue;

  const counts = new Map<string, number>();
  for (const v of verdicts) counts.set(v, (counts.get(v) ?? 0) + 1);
  const against = verdicts.filter((v) => v !== item.label).length;

  // What the models collectively preferred instead, if anything beat the label.
  let preferred: string | null = null;
  let best = counts.get(item.label) ?? 0;
  for (const [v, n] of counts) {
    if (v !== item.label && n > best) {
      best = n;
      preferred = v;
    }
  }
  contests.push({ id: item.id, label: item.label, against, total: verdicts.length, preferred });
}

contests.sort((a, b) => b.against - a.against);
const disputed = contests.filter((c) => c.preferred !== null);

console.log(`items scored: ${contests.length}`);
console.log(`items where the models collectively preferred a different label: ${disputed.length}`);
console.log("");
console.log("most contested (label -> what the models preferred, votes against / total):");
for (const c of disputed.slice(0, 12)) {
  console.log(`  ${c.against}/${c.total}  ${c.label} -> ${c.preferred}  ${c.id.slice(0, 68)}`);
}

// ---- flip them and re-score --------------------------------------------------
function rescoreWith(overrides: ReadonlyMap<string, string>): { name: string; cov: number }[] {
  const patched: PanelItem[] = items.map((i) => {
    const o = overrides.get(i.id);
    return o === undefined ? i : { ...i, label: o };
  });
  const ranking = rankStructures(scorePanel(artifact.run, patched, PRICES));
  return ranking.ranked.map((r) => ({
    name: r.structure.name,
    cov: r.structure.coverage_adjusted_accuracy ?? 0,
  }));
}

const baseline = rescoreWith(new Map());
console.log("");
console.log("BASELINE (my labels)");
for (const r of baseline) console.log(`  ${r.cov.toFixed(3)}  ${r.name}`);

for (const k of [5, 10, disputed.length]) {
  const overrides = new Map<string, string>();
  for (const c of disputed.slice(0, k)) if (c.preferred !== null) overrides.set(c.id, c.preferred);
  if (overrides.size === 0) continue;
  const rows = rescoreWith(overrides);
  console.log("");
  console.log(`FLIPPING THE ${overrides.size} MOST CONTESTED LABELS TO THE MODEL CONSENSUS`);
  for (const r of rows) console.log(`  ${r.cov.toFixed(3)}  ${r.name}`);

  const panel = rows.find((r) => r.name.startsWith("S0"));
  const bestSolo = rows.filter((r) => r.name.includes("solo")).sort((a, b) => b.cov - a.cov)[0];
  if (panel !== undefined && bestSolo !== undefined) {
    const gap = bestSolo.cov - panel.cov;
    console.log(
      `  => best solo beats the voting panel by ${(gap * 100).toFixed(1)} points ` +
        `(${gap > 0.054 ? "still outside the n=120 noise band" : "NOW INSIDE the noise band — conclusion would not survive"})`,
    );
  }
}
