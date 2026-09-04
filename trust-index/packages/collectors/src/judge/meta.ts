/**
 * The final pass: which structure do we ship?
 *
 * A model is asked to read the three deciders' results and recommend. That is
 * the last step of the design, and it has one obvious problem which this file
 * exists to contain: the model making the recommendation belongs to one of the
 * families being recommended between. Asking Claude whether the Claude decider
 * won is not a neutral question.
 *
 * The containment is to make the ARITHMETIC authoritative and the MODEL
 * explanatory. `rankStructures` is pure and deterministic: it ranks by the
 * metric that matters, flags the structures that are net-negative or
 * self-preferring, and produces a winner without asking anyone. The model then
 * reads the same table and gives its own recommendation with reasoning.
 *
 * Then we compare the two. Three outcomes, all informative:
 *
 * - They agree. The recommendation carries the reasoning; ship it.
 * - The model picks a worse structure. That is a finding about the model, and
 *   a direct measurement of exactly the bias we were worried about — recorded
 *   in the artifact, not smoothed over.
 * - The model picks a structure the arithmetic ranked lower for a reason the
 *   arithmetic does not encode. That is the valuable case: it means our ranking
 *   criterion is missing something, and the criterion gets fixed rather than
 *   the model overruled.
 *
 * What we must never do is let the model's pick silently BE the answer. A
 * ratings service whose own methodology was chosen by an unaudited model vote
 * has no defensible reply when somebody asks why their rating is what it is.
 */
import type { JudgeClient } from "./index.js";
import type { DeciderBehaviour, PanelMetrics, StructureMetrics } from "./metrics.js";

export const META_PROMPT_VERSION = "meta.v1";

export type RankedStructure = {
  structure: StructureMetrics;
  rank: number;
  /** Reasons this structure should not be shipped regardless of its accuracy. */
  flags: string[];
};

export type Ranking = {
  criterion: string;
  ranked: RankedStructure[];
  /** Highest-ranked structure carrying no flags, or null if every option is flagged. */
  winner: string | null;
};

/**
 * Rank the structures.
 *
 * The criterion is coverage-adjusted accuracy: correct answers over ALL
 * labelled items, counting an abstention as a miss. Plain accuracy would let a
 * structure win by answering only the easy third of the corpus, and a rating
 * service that abstains on everything hard is worse than useless — it publishes
 * a confident view of exactly the population that never needed one.
 *
 * Cost deliberately does not enter the ranking. At the scales measured in
 * research/judge-model-economics.md the entire spread is about $105/month, so
 * letting cost break ties would be optimising the smallest term.
 */
export function rankStructures(metrics: PanelMetrics): Ranking {
  const behaviourFor = (name: string): DeciderBehaviour | undefined =>
    metrics.decider_behaviour.find((b) => name.includes(b.vendor) && name.includes(b.mode));

  const scored = metrics.structures
    .filter((s) => s.coverage_adjusted_accuracy !== null)
    .sort((a, b) => (b.coverage_adjusted_accuracy ?? 0) - (a.coverage_adjusted_accuracy ?? 0));

  const ranked: RankedStructure[] = scored.map((structure, i) => {
    const flags: string[] = [];
    const b = behaviourFor(structure.name);
    if (b !== undefined) {
      // A decider that overturns more right answers than it fixes wrong ones is
      // costing money to make the panel worse. Average accuracy hides this.
      //
      // A null rescue_rate counts as zero, not as "no opinion". It means the
      // panel handed this decider no wrong majorities to fix, so a decider that
      // still managed to break correct ones did pure damage — the clearest
      // net-negative case there is, and the one an earlier version of this rule
      // let through by requiring both rates to be non-null.
      if (b.breakage_rate !== null && b.breakage_rate > (b.rescue_rate ?? 0)) {
        const rescued = b.rescue_rate === null ? "had no wrong majority to rescue" : `rescues ${(b.rescue_rate * 100).toFixed(0)}% of wrong ones`;
        flags.push(
          `net-negative adjudication: breaks ${(b.breakage_rate * 100).toFixed(0)}% of correct majorities, ${rescued}`,
        );
      }
      // Following its own lab's voter, when that voter is wrong and others are
      // right, more often than not. The panel's independence is theatre here.
      if (b.self_preference !== null && b.self_preference > 0.5 && b.sibling_wrong_others_right >= 5) {
        flags.push(
          `self-preference: followed its own vendor's wrong vote in ${b.followed_wrong_sibling}/${b.sibling_wrong_others_right} cases`,
        );
      }
    }
    if (structure.scored < 30) flags.push(`thin evidence: only ${structure.scored} labelled items scored`);
    return { structure, rank: i + 1, flags };
  });

  return {
    criterion: "coverage-adjusted accuracy (correct / all labelled items, abstention counts as a miss)",
    ranked,
    winner: ranked.find((r) => r.flags.length === 0)?.structure.name ?? null,
  };
}

/** A compact, model-readable rendering of the table. Numbers only; no advocacy. */
export function renderMetrics(metrics: PanelMetrics, ranking: Ranking): string {
  const lines: string[] = [];
  lines.push(`items=${metrics.items} labelled=${metrics.labelled}`);
  lines.push("");
  lines.push("STRUCTURES (ranked by coverage-adjusted accuracy)");
  for (const r of ranking.ranked) {
    const s = r.structure;
    const acc = s.accuracy === null ? "n/a" : s.accuracy.toFixed(3);
    const cov = s.coverage_adjusted_accuracy === null ? "n/a" : s.coverage_adjusted_accuracy.toFixed(3);
    const usd = s.usd === null ? "n/a" : `$${s.usd.toFixed(4)}`;
    lines.push(
      `${r.rank}. ${s.name} | acc=${acc} cov_acc=${cov} decided=${s.decided} abstained=${s.abstained} cost=${usd}` +
        (r.flags.length > 0 ? ` | FLAGS: ${r.flags.join("; ")}` : ""),
    );
  }
  lines.push("");
  lines.push("DECIDER BEHAVIOUR");
  for (const b of metrics.decider_behaviour) {
    lines.push(
      `${b.vendor}/${b.mode}: rescued=${b.rescued} missed=${b.missed} broke=${b.broke} held=${b.held} ` +
        `rescue_rate=${b.rescue_rate?.toFixed(3) ?? "n/a"} breakage_rate=${b.breakage_rate?.toFixed(3) ?? "n/a"} ` +
        `self_preference=${b.self_preference?.toFixed(3) ?? "n/a"} (n=${b.sibling_wrong_others_right})`,
    );
  }
  lines.push("");
  lines.push("PAIRWISE ERROR CORRELATION (phi; high means mistakes coincide)");
  for (const c of [...metrics.correlation].sort((x, y) => (y.phi ?? -2) - (x.phi ?? -2)).slice(0, 12)) {
    lines.push(`${c.a} vs ${c.b}: phi=${c.phi?.toFixed(3) ?? "n/a"} both_wrong=${c.both_wrong}/${c.overlap}`);
  }
  lines.push("");
  lines.push("SCHEMA FAILURES (gate G2; any nonzero count is disqualifying)");
  if (metrics.schema_failures.length === 0) lines.push("none");
  for (const f of metrics.schema_failures) lines.push(`${f.vendor}/${f.modelId}: ${f.failures}`);
  return lines.join("\n");
}

export type MetaRecommendation = {
  protocol: string;
  /** What the arithmetic says. Authoritative. */
  deterministic_winner: string | null;
  /** What the model says. Explanatory. */
  model_pick: string | null;
  model_reason: string;
  /** The finding: did the model agree with the table it was shown? */
  agrees: boolean;
  modelId: string;
};

/**
 * Ask a model to recommend a structure.
 *
 * The metrics table goes in the UNTRUSTED position, same as everything else.
 * Not because a number can inject anything, but because the structure names and
 * the flag strings are assembled from run data, and the day someone adds a
 * model-authored reason string to this table is the day the fence would have
 * mattered. Putting it there now costs nothing and removes the question.
 */
export async function recommendStructure(
  metrics: PanelMetrics,
  ranking: Ranking,
  client: JudgeClient,
  modelId: string,
): Promise<MetaRecommendation> {
  const names = ranking.ranked.map((r) => r.structure.name);
  const instruction = [
    "You are reviewing the results of an experiment that compared several structures",
    "for judging third-party software tools: three cheap models voting, three premium",
    "models adjudicating those votes, and single models working alone.",
    "",
    "Recommend ONE structure to put into production. Judge on: accuracy over all",
    "labelled items with abstentions counted as misses; whether a decider fixes more",
    "wrong answers than it breaks right ones; whether the panel's errors are",
    "independent rather than coincident; and whether any model failed to produce",
    "schema-valid output at all.",
    "",
    "Cost is not a tiebreaker. The spread between the cheapest and most expensive",
    "option here is small enough that accuracy dominates.",
    "",
    "Answer with the exact structure name as your verdict, and one sentence of reason.",
  ].join("\n");

  const res = await client({
    task: "response_classification",
    instruction,
    untrusted: { experiment_results: renderMetrics(metrics, ranking) },
    allowed: names,
  });

  return {
    protocol: META_PROMPT_VERSION,
    deterministic_winner: ranking.winner,
    model_pick: res.verdict,
    model_reason: res.reason,
    agrees: ranking.winner !== null && res.verdict === ranking.winner,
    modelId,
  };
}
