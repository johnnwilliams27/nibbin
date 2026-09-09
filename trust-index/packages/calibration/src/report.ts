/**
 * Report rendering (SPEC 12 publication). Markdown, written to /research and
 * summarized on /methodology.
 *
 * The report's job is to be honest about what it does and does not establish.
 * A sensitivity sweep shows stability, never correctness. A calibration run on
 * a thin label set is a finding about coverage, not evidence the scores work.
 * Every rendering below states its own standing rather than leaving a reader
 * to infer it from a number.
 *
 * Voice follows SPEC 14A: no em-dashes, no inflation vocabulary, sentence-case
 * headings, claims carry their evidence.
 */
import { format } from "./fixed.js";
import type { MetricSet, ReliabilityBin } from "./metrics.js";
import type { CalibrationRun } from "./run.js";
import { beatsAllBaselines, MIN_EVALUABLE_AGENTS } from "./run.js";
import { recommendArm, type ArmComparison } from "./compare.js";
import type { JointSweepResult } from "./joint.js";
import type { CoverageReport } from "./coverage.js";
import type { SensitivityResult } from "./sensitivity.js";
import type { TuningResult } from "./tune.js";

function pct(v: bigint): string {
  return format(v, 4);
}

function reliabilityTable(curve: readonly ReliabilityBin[]): string {
  const rows = curve
    .filter((b) => b.count > 0)
    .map(
      (b) =>
        `| ${format(b.loFx, 2)} to ${format(b.hiFx, 2)} | ${b.count} | ${format(b.meanPredictedFx!, 4)} | ${format(b.observedFrequencyFx!, 4)} |`,
    );
  if (rows.length === 0) return "_No populated bins._\n";
  return [
    "| Predicted range | Agents | Mean predicted | Observed frequency |",
    "|---|---|---|---|",
    ...rows,
    "",
  ].join("\n");
}

function metricsBlock(m: MetricSet): string {
  const auc = m.aucFx === null ? "undefined (only one outcome class present)" : format(m.aucFx, 4);
  const lines = [
    `- Brier score: ${format(m.brierFx, 6)} (lower is better)`,
    `- Base rate: ${pct(m.baseRateFx)}, base-rate Brier: ${format(m.baseRateBrierFx, 6)}`,
    `- Skill against the base rate: ${format(m.skillVsBaseRateFx, 4)}`,
    `- Expected calibration error: ${format(m.eceFx, 4)}`,
    `- AUC: ${auc}`,
    "",
    "Reliability:",
    "",
    reliabilityTable(m.reliability),
  ];
  if (m.tiers.length > 0) {
    lines.push("By coverage tier:", "");
    lines.push("| Tier | Agents | Brier | Mean predicted | Observed rate |");
    lines.push("|---|---|---|---|---|");
    for (const t of m.tiers) {
      lines.push(
        `| ${t.tier} | ${t.count} | ${format(t.brierFx, 6)} | ${format(t.meanPredictedFx, 4)} | ${format(t.baseRateFx, 4)} |`,
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}

export function renderCalibrationReport(run: CalibrationRun, generatedFrom: string): string {
  const gate = beatsAllBaselines(run);
  const out: string[] = [];

  out.push("# Calibration report");
  out.push("");
  out.push(`Source cohort: ${generatedFrom}`);
  out.push(`Split at: ${run.split_ts} (block ${run.split_block})`);
  out.push(`Label view: ${run.view}`);
  out.push("");

  out.push("## Standing of this report");
  out.push("");
  if (run.evaluated === 0) {
    out.push(
      "This run evaluated no agents. Nothing here supports any claim about predictive accuracy. The cohort carried no commerce outcomes after the split instant.",
    );
  } else if (run.underpowered) {
    out.push(
      `This run evaluated ${run.evaluated} agents, below the ${MIN_EVALUABLE_AGENTS} needed for a result to support a claim. The numbers below are reported because SPEC 12 asks for sparse coverage to be published rather than hidden, not because they establish that the scores predict outcomes. Constants stay provisional.`,
    );
  } else {
    out.push(
      `This run evaluated ${run.evaluated} agents against outcomes recorded after the split. Scoring used only evidence dated at or before the split, so no result here is in-sample.`,
    );
  }
  out.push("");
  out.push(
    `Cohort: ${run.cohort_size} agents. Excluded for no post-split outcome: ${run.excluded_no_label}. Excluded for no outcome in this label view: ${run.excluded_no_view_label}. Evaluated: ${run.evaluated}.`,
  );
  if (run.leakage_guard_triggered) {
    out.push("");
    out.push(
      "The leakage guard fired: at least one reviewer's commerce corroboration flag was derived from a job dated after the split and was cleared before scoring. Without that correction the scores would have partly read their own labels.",
    );
  }
  out.push("");
  out.push(
    "Known limitation: reviewer aggregate statistics (total reviews, distinct agents reviewed, peak daily reviews, portfolio concentration, first seen) are carried as-of-snapshot rather than as-of-split, because the snapshot contract does not retain their history. They leak a limited amount of post-split information into reviewer weights. The effect is second order, it shifts weights rather than outcomes, but it is real and is not corrected here.",
  );
  out.push("");

  if (run.results.length === 0) {
    out.push("## Results");
    out.push("");
    out.push("No predictors were evaluated.");
    out.push("");
    return out.join("\n");
  }

  out.push("## Gate G2: does the index beat the trivial baselines?");
  out.push("");
  out.push(`${gate.passed ? "PASS" : "FAIL"}: ${gate.detail}.`);
  if (run.underpowered) {
    out.push("");
    out.push("This verdict is not binding while the run is underpowered.");
  }
  out.push("");

  out.push("## Reading these numbers");
  out.push("");
  out.push(
    "Brier and AUC answer different questions, and a score can do well on one and badly on the other. AUC asks whether the score ranks agents correctly, which is mapping-free. Brier and the expected calibration error ask whether the number itself is a probability, which depends entirely on how the score is read.",
  );
  out.push("");
  out.push(
    "The index publishes a 0 to 100 quality estimate, and this report reads it as p = score/100 because that is the mapping a consumer gating on `minimum_score` implicitly assumes. High AUC with poor Brier therefore means the ranking works while that assumed mapping does not: the scores separate good agents from bad ones, but a score of 80 does not mean an 80 percent chance of clean completion. That gap is a finding about the mapping, not about the ranking, and it is the argument for publishing a fitted score-to-probability curve alongside the score rather than letting integrators infer one.",
  );
  out.push("");

  out.push("## Results by predictor");
  out.push("");
  for (const r of run.results) {
    out.push(`### ${r.name}`);
    out.push("");
    out.push(r.description);
    out.push("");
    out.push(metricsBlock(r.metrics));
  }

  out.push("## Reproduction");
  out.push("");
  out.push(
    "Rebuild the cohort, then run `agent-trust-calibrate run --cohort <dir> --split <iso-ts> --split-block <n>`. Metrics are exact fixed-point arithmetic, so a rerun on the same inputs reproduces these numbers byte for byte.",
  );
  out.push("");
  return out.join("\n");
}

export function renderSensitivityReport(results: readonly SensitivityResult[], generatedFrom: string): string {
  const out: string[] = [];
  out.push("# Constant sensitivity report");
  out.push("");
  out.push(`Source cohort: ${generatedFrom}`);
  out.push("");
  out.push("## What this establishes");
  out.push("");
  out.push(
    "Each constant below is swept across a plausible range and the cohort is rescored at every setting. The tables report two different things: how far the published scores move, and whether the ordering of agents survives.",
  );
  out.push("");
  out.push(
    "Those are separate questions with separate answers, and the difference decides what a reader can safely do with an unverified constant. A constant that lifts every agent by the same amount moves the score a great deal and leaves the ordering untouched: a reader comparing two agents, or gating on a percentile, is unaffected by it, while a reader treating the number itself as a measurement is not. Reporting only the score movement would overstate the first reader's exposure.",
  );
  out.push("");
  out.push(
    "This shows stability, not correctness. A constant can be perfectly stable and still be the wrong value, and an ordering can be stable under every constant and still be the wrong ordering. SPEC 12 permits shipping an untuned constant as provisional when its sweep is stable, and requires flagging one whose sweep is not. Nothing here promotes a constant to tuned; only a calibration run against real outcomes can do that.",
  );
  out.push("");
  out.push(
    "The magnitudes below describe this cohort. A small or unrepresentative cohort gives an indicative reading, not a population statement: a constant that looks stable here can still move scores materially across the real index, and a tier change count is bounded by how many agents sit near a boundary in the first place. Read the ranking of constants by risk, which is robust, ahead of the absolute shifts, which are not.",
  );
  out.push("");

  const unstable = results.filter((r) => !r.stable);
  const rankUnstable = results.filter((r) => !r.rankStable);
  const scoreOnly = results.filter((r) => !r.stable && r.rankStable);
  out.push("## Summary");
  out.push("");
  out.push("| Constant | Baseline | Worst mean score shift | Worst tier changes | Score stable | Worst pair agreement | Worst rank shift | Rank stable | Safe comparison margin |");
  out.push("|---|---|---|---|---|---|---|---|---|");
  for (const r of results) {
    out.push(
      `| ${r.path} | ${r.baselineValue} | ${format(r.worstMeanAbsDeltaFx, 2)} | ${r.worstTierChanges} | ${r.stable ? "yes" : "no"} | ${
        r.worstPairAgreementFx === null ? "not measurable" : format(r.worstPairAgreementFx, 4)
      } | ${r.worstMaxRankShift} | ${r.rankStable ? "yes" : "no"} | ${
        r.safeSeparationFx === null ? "none reached" : `${format(r.safeSeparationFx, 2)} points`
      } |`,
    );
  }
  out.push("");
  if (unstable.length > 0) {
    out.push(
      `${unstable.length} of ${results.length} constants move the published score materially across their plausible range: ${unstable
        .map((r) => r.path)
        .join(", ")}. These carry the most risk while untuned and should be named on the methodology page.`,
    );
  } else {
    out.push("Every swept constant leaves the published score stable across its plausible range on this cohort.");
  }
  out.push("");
  if (rankUnstable.length > 0) {
    out.push(
      `${rankUnstable.length} of ${results.length} also disturb the ordering: ${rankUnstable
        .map((r) => r.path)
        .join(", ")}. For these, "agent A ranks above agent B" is not safe from the constant choice either.`,
    );
  } else {
    out.push(
      "No swept constant disturbs the ordering. Every pairwise comparison the index makes survives every setting tested, so relative claims are not hostage to these constants even where the absolute scores are.",
    );
  }
  out.push("");
  if (scoreOnly.length > 0) {
    out.push(
      `${scoreOnly.length} constants move the score without disturbing the ordering: ${scoreOnly
        .map((r) => r.path)
        .join(", ")}. Their uncertainty falls entirely on the published magnitude. A reader comparing agents or gating on a percentile is not exposed to it; a reader reading the number as a measurement is.`,
    );
    out.push("");
  }

  out.push("## How far apart two agents must be");
  out.push("");
  out.push(
    "Unrestricted pair agreement counts a pair separated by a hundredth of a point the same as a pair separated by thirty, which understates how usable the ordering is: nobody quotes an ordering between two agents who are level. The margin below is the narrowest baseline score gap at which agreement holds across every setting of that constant, so it is the distance at which a comparison stops depending on the constant being right.",
  );
  out.push("");
  const reached = results.filter((r) => r.safeSeparationFx !== null);
  const widest = reached.reduce<bigint | null>(
    (acc, r) => (acc === null || r.safeSeparationFx! > acc ? r.safeSeparationFx! : acc),
    null,
  );
  if (reached.length < results.length) {
    const unreached = results.filter((r) => r.safeSeparationFx === null).map((r) => r.path);
    out.push(
      `${unreached.length} constants reach the agreement threshold at no tested margin: ${unreached.join(
        ", ",
      )}. For these the ordering is not safe from the constant choice at any separation measured here, and a wider sweep of margins would be needed to find one if it exists.`,
    );
  } else if (widest !== null) {
    out.push(
      `Every constant reaches the agreement threshold at some margin. Taking the widest across all of them, two agents separated by at least ${format(
        widest,
        2,
      )} points keep their ordering under every constant setting tested. That is the comparison the index can support today, before any constant is verified against outcomes.`,
    );
  }
  out.push("");
  out.push("| Constant | Margin at which the ordering holds |");
  out.push("|---|---|");
  for (const r of results) {
    out.push(
      `| ${r.path} | ${r.safeSeparationFx === null ? "none reached" : `${format(r.safeSeparationFx, 2)} points`} |`,
    );
  }
  out.push("");
  out.push(
    "This margin describes one constant at a time. Two constants moving together can disturb a pair that neither disturbs alone, so the figures above are a lower bound on the margin a joint sweep would find, not an upper one.",
  );
  out.push("");

  out.push("## Sweeps");
  out.push("");
  for (const r of results) {
    out.push(`### ${r.path}`);
    out.push("");
    out.push(`Baseline value: ${r.baselineValue}`);
    out.push("");
    out.push("| Value | Scored | Suppressed | Mean score shift | Max score shift | Tier changes | Suppression flips |");
    out.push("|---|---|---|---|---|---|---|");
    for (const p of r.points) {
      out.push(
        `| ${p.value} | ${p.scored} | ${p.suppressed} | ${format(p.meanAbsScoreDeltaFx, 2)} | ${format(p.maxAbsScoreDeltaFx, 2)} | ${p.tierChanges} | ${p.suppressionFlips} |`,
      );
    }
    out.push("");
    out.push("Ordering at each setting, against the baseline ordering:");
    out.push("");
    out.push("| Value | Ranked | Pair agreement | Pairs inverted | Spearman | Top decile kept | Worst rank shift |");
    out.push("|---|---|---|---|---|---|---|");
    for (const p of r.points) {
      const k = p.rank;
      out.push(
        `| ${p.value} | ${k.comparable} | ${k.pairAgreementFx === null ? "n/a" : format(k.pairAgreementFx, 4)} | ${k.invertedPairs} of ${k.orderedPairs} | ${
          k.spearmanFx === null ? "n/a" : format(k.spearmanFx, 4)
        } | ${k.topDecileRetained} of ${k.topDecileBaseline} | ${k.maxRankShift} |`,
      );
    }
    out.push("");
    out.push("Agreement by how far apart the baseline puts the pair:");
    out.push("");
    const margins = r.points[0]?.rank.separation ?? [];
    out.push(`| Value | ${margins.map((m) => `gap >= ${format(m.minGapFx, 2)}`).join(" | ")} |`);
    out.push(`|---|${margins.map(() => "---").join("|")}|`);
    for (const p of r.points) {
      const cells = p.rank.separation.map((sp) =>
        sp.agreementFx === null ? "no pairs" : `${format(sp.agreementFx, 4)} (${sp.orderedPairs})`,
      );
      out.push(`| ${p.value} | ${cells.join(" | ")} |`);
    }
    out.push("");
  }

  out.push("## How to read the ordering tables");
  out.push("");
  out.push(
    "Pair agreement is the fraction of agent pairs that the baseline orders and the swept setting orders the same way. It is the direct measure of whether \"A is better than B\" survives the constant. Pairs the swept setting ties are counted in neither the agreed nor the inverted column, so agreement plus inversions can fall short of the ordered-pair total.",
  );
  out.push("");
  out.push(
    "Spearman is the rank correlation over the whole cohort, reported in its standard form for comparison against other work. Top decile kept counts how many of the baseline's top-decile agents remain in the top decile, which is the claim a consumer gating on a threshold depends on. The decile is taken by score threshold rather than by count, so ties at the cut line widen the set rather than being broken arbitrarily, and both sides of the count are printed.",
  );
  out.push("");
  out.push(
    "Worst rank shift is the largest number of positions any single agent moves. It is reported because the other three measures are cohort averages, and an average can stay excellent while one agent moves from second place to two hundredth.",
  );
  out.push("");
  out.push(
    "Agents that one setting suppresses and another does not have no rank to compare and are excluded from these tables. That is a coverage effect rather than an ordering effect, and the suppression flips column above already reports it.",
  );
  out.push("");
  out.push(
    "In the agreement-by-gap table each cell is the agreement among pairs separated by at least that margin, with the number of such pairs in brackets. Agreement normally rises as the margin widens, because a wider gap takes more disturbance to close. A cell reading no pairs means the cohort contains no pair that far apart, which is a statement about the cohort rather than about the constant.",
  );
  out.push("");
  return out.join("\n");
}

/**
 * Joint sweep report. This is the band a reader should be quoted, because it is
 * the only one that varies every unverified constant at once.
 */
export function renderJointSweepReport(r: JointSweepResult, generatedFrom: string): string {
  const out: string[] = [];
  out.push("# Joint constant sweep");
  out.push("");
  out.push(`Source cohort: ${generatedFrom}`);
  out.push(`Draws: ${r.draws} of a ${r.gridSize} point grid, seed ${r.seed}`);
  out.push("");

  out.push("## What this establishes");
  out.push("");
  out.push(
    "Every constant is varied at the same time, and the worst effect on the cohort is reported. The per-constant sweep answers what one unverified value costs; this answers what all of them cost together, which is the honest position while none of them has been checked against outcomes.",
  );
  out.push("");
  out.push(
    `The grid is sampled rather than enumerated: ${r.draws} draws out of ${r.gridSize} combinations, from a seeded generator with no clock, so the same seed and cohort reproduce this band exactly. The two corners of the grid, every constant at its lowest and every constant at its highest, are always included. A sample gives a lower bound on the worst case: a combination worse than any drawn here is possible, and more draws tighten the bound without ever making it a proof.`,
  );
  out.push("");
  out.push(
    "As with the per-constant sweep, this measures stability rather than correctness. A band this analysis calls narrow can still be centred on the wrong value. Only calibration against real outcomes speaks to that.",
  );
  out.push("");

  out.push("## How far the score moves");
  out.push("");
  out.push("| Measure | Worst observed |");
  out.push("|---|---|");
  out.push(
    `| Mean score movement | ${format(r.worstMeanAbsDeltaFx, 2)} points, over ${r.worstMeanAbsDeltaCompared} agents |`,
  );
  out.push(`| Largest single score movement | ${format(r.worstMaxAbsDeltaFx, 2)} points |`);
  out.push(`| Agents changing coverage tier | ${r.worstTierChanges} of ${r.cohortSize} |`);
  out.push(`| Agents changing suppression state | ${r.worstSuppressionFlips} of ${r.cohortSize} |`);
  out.push(`| Fewest agents any draw left scored | ${r.fewestScored} of ${r.cohortSize} |`);
  out.push("");
  out.push(
    "The mean score movement is the figure to quote as the methodology band: the published score of a typical agent can move that far on the constant choice alone, and no amount of additional evidence about that agent narrows it. Only verifying the constants does.",
  );
  out.push("");
  out.push(
    "The agent count beside it matters. Some constant combinations suppress most of the cohort, and a mean taken over the few survivors is a statement about those survivors. The last row shows how far coverage collapses at the worst draw, so a band resting on a handful of agents is visible rather than implied.",
  );
  out.push("");

  out.push("## How far apart two agents must be");
  out.push("");
  out.push(
    `Each of the ${r.trackedPairs} tracked pairs is followed across every draw. A pair holds when every draw that could score both agents ordered them the way the baseline does; a draw that ties them does not support the ordering and counts against it, and a draw that suppresses either agent removes the comparison rather than breaking it. The figures below are therefore a property of the pairs, not of any single draw, which keeps a coverage collapse in one corner of the grid from standing in for an ordering result.`,
  );
  out.push("");
  if (r.pairsSampled) {
    out.push(
      `The cohort contains ${r.totalOrderedPairs} ordered pairs, more than the tracking limit, so the tracked set is a deterministic sample of them drawn from the same seed.`,
    );
    out.push("");
  }
  if (r.safeSeparationFx === null) {
    out.push(
      "No tested margin reaches the survival threshold. On this cohort no comparison between two agents is safe from the joint constant choice at any separation measured here. That is the finding, and it belongs on the methodology page rather than softened: the index can rank agents only to the extent its unverified constants happen to be right.",
    );
  } else if (r.safeSeparationFx === 0n) {
    out.push(
      "Every pair holds at every margin, adjacent agents included. The ordering is not disturbed by the joint constant choice on this cohort, so relative claims are safe even though the absolute scores are not.",
    );
  } else {
    out.push(
      `Two agents separated by at least ${format(
        r.safeSeparationFx,
        2,
      )} points keep their ordering under every constant combination drawn. That is the comparison the index can support today, before any constant is verified. Below that margin the ordering depends on constants nobody has checked, and the index should not be read as ranking those agents against each other.`,
    );
  }
  out.push("");
  out.push("| Baseline gap | Pairs | Held under every draw | Survival | Never evaluable |");
  out.push("|---|---|---|---|---|");
  for (const s of r.separation) {
    out.push(
      `| at least ${format(s.minGapFx, 2)} | ${s.pairs} | ${s.alwaysHeld} | ${
        s.survivalFx === null ? "no pairs" : format(s.survivalFx, 4)
      } | ${s.neverEvaluable} |`,
    );
  }
  out.push("");
  out.push(
    "Survival normally rises as the margin widens, because a wider gap takes more disturbance to close. Never evaluable counts pairs at that margin which no draw could score, because at least one of the two agents was suppressed in every draw; those pairs are excluded from the survival figure rather than counted as holding.",
  );
  out.push("");

  out.push("## Reproduction");
  out.push("");
  out.push("Axes swept:");
  out.push("");
  for (const a of r.axes) out.push(`- ${a.path}: ${a.values.join(", ")}`);
  out.push("");
  if (r.worstScoreDraw !== null) {
    out.push("Constant combination producing the worst score movement:");
    out.push("");
    for (const [path, value] of Object.entries(r.worstScoreDraw)) out.push(`- ${path} = ${value}`);
    out.push("");
  }
  out.push(
    `Rerun with \`agent-trust-calibrate joint --cohort <dir> --draws ${r.draws - 2} --seed ${r.seed}\` to reproduce these numbers exactly.`,
  );
  out.push("");
  return out.join("\n");
}

/**
 * Coverage report. Answers the question that comes before any band: how many
 * agents does the methodology publish a score for at all?
 */
export function renderCoverageReport(r: CoverageReport, generatedFrom: string): string {
  const out: string[] = [];
  const pct = (n: number) => (r.baseline.total === 0 ? "0.00" : ((n / r.baseline.total) * 100).toFixed(2));

  out.push("# Coverage report");
  out.push("");
  out.push(`Source cohort: ${generatedFrom}`);
  out.push("");

  out.push("## What this establishes");
  out.push("");
  out.push(
    "How many agents receive a published score, and where the rest are lost. The sensitivity and joint sweeps measure how far a score moves; neither says how many agents have one. On a real registry that turns out to be the more consequential number, and a band around a score almost nobody carries is not a headline.",
  );
  out.push("");

  out.push("## Where agents are lost");
  out.push("");
  out.push("| Stage | Agents | Share of cohort |");
  out.push("|---|---|---|");
  out.push(`| In the cohort | ${r.baseline.total} | 100.00% |`);
  out.push(`| Carry any feedback | ${r.baseline.withFeedback} | ${pct(r.baseline.withFeedback)}% |`);
  out.push(`| Carry usable feedback | ${r.baseline.withUsableFeedback} | ${pct(r.baseline.withUsableFeedback)}% |`);
  out.push(`| Receive a published score | ${r.baseline.scored} | ${pct(r.baseline.scored)}% |`);
  out.push("");
  out.push(
    "The three stages fail for different reasons and have different fixes. An agent with no feedback cannot be scored by any constant setting. An agent whose feedback is all revoked or all scale-uninferable is excluded by SPEC 11.10, which excludes rather than guesses at a scale. An agent that clears both and still has no score was suppressed for insufficient evidence weight, and that last one is a constant choice.",
  );
  out.push("");
  out.push(
    `Mean n_eff across the cohort is ${r.baseline.meanNeff.toFixed(4)}, against a suppression floor of 0.50, and the highest any agent reaches is ${r.baseline.maxNeff.toFixed(3)}. The index publishes ${r.baseline.distinctScores} distinct score values, which bounds how finely it can rank regardless of anything else.`,
  );
  out.push("");
  out.push("| Coverage tier | Agents |");
  out.push("|---|---|");
  for (const t of r.baseline.tiers) out.push(`| ${t.tier} | ${t.count} |`);
  out.push("");

  out.push("## Why the evidence weighs so little");
  out.push("");
  out.push(
    `${r.reviewersPerAgent.agents} agents have at least one reviewer. The median such agent has ${r.reviewersPerAgent.median}, the 90th percentile has ${r.reviewersPerAgent.p90}, and ${r.reviewersPerAgent.exactlyOne} have exactly one.`,
  );
  out.push("");
  out.push(
    "That interacts with two rules that are individually reasonable. One reviewer one vote (SPEC 11.1, and the anti-flooding cap) means a reviewer contributes at most their own weight no matter how many reviews they leave, so an agent reviewed by one address cannot exceed an n_eff of one however much that address says. The age ramp and time decay then discount that single contribution well below one. A floor of 0.50 therefore asks for something close to three recent, fully weighted, distinct reviewers, and most agents on the registry have one reviewer of unknown age.",
  );
  out.push("");

  out.push("## Separating the methodology from the inputs");
  out.push("");
  out.push(
    "Some of the shortfall is ours rather than the methodology's: an index build that cannot date a reviewer's wallet understates the age ramp, and one that reads a short history still applies decay. The first two variations below disable those effects to bound that artifact. They are not proposed settings, and neither is a fix. The last two vary the suppression floor itself, which is a real constant choice.",
  );
  out.push("");
  out.push("| Variation | Purpose | Agents scored | Share | Mean n_eff |");
  out.push("|---|---|---|---|---|");
  for (const v of r.variations) {
    const purpose =
      v.purpose === "baseline" ? "baseline" : v.purpose === "artifact_bound" ? "bounds an input artifact" : "constant choice";
    out.push(`| ${v.label} | ${purpose} | ${v.scored} | ${pct(v.scored)}% | ${v.meanNeff.toFixed(4)} |`);
  }
  out.push("");
  const bound = r.variations.find((v) => v.label === "age ramp and decay both removed");
  const noFloor = r.variations.find((v) => v.label.startsWith("suppression floor effectively removed"));
  if (bound !== undefined && noFloor !== undefined) {
    out.push(
      `Reading this: even with every age and decay effect removed, which is more generous than any real index build could justify, coverage reaches ${pct(bound.scored)}%. So the shortfall is not mainly an artifact of thin inputs. Removing the suppression floor instead reaches ${pct(noFloor.scored)}%, which is close to the share of agents carrying usable feedback at all. The floor, not the evidence, is what decides coverage here.`,
    );
    out.push("");
  }
  out.push(
    "None of this says the floor is wrong. Publishing a score from a single unverified review may well be worse than publishing nothing, and SPEC 12 is explicit that a sparse-coverage finding should be reported rather than hidden. It does say the floor is the single most consequential constant in the methodology, that it is currently unverified like the rest, and that it should be tuned against outcomes before the index claims to cover a registry.",
  );
  out.push("");
  return out.join("\n");
}

export function renderTuningReport(result: TuningResult): string {
  const out: string[] = [];
  out.push("# Constant tuning run");
  out.push("");
  out.push(`Run id: ${result.run_id}`);
  out.push(`Split at: ${result.split_ts}`);
  out.push(`Label view: ${result.view}`);
  out.push("");
  if (result.underpowered) {
    out.push(
      "This run is underpowered. Its result does not promote any constant from provisional to tuned. SPEC 12 is explicit that an untuned constant must never be presented as a tuned one.",
    );
    out.push("");
  }
  out.push("## Grid");
  out.push("");
  for (const axis of result.axes) {
    out.push(`- ${axis.path}: ${axis.values.join(", ")}`);
  }
  out.push("");
  out.push(`Candidates evaluated: ${result.candidates.length}`);
  if (result.baselineBrierFx !== null) {
    out.push(`Baseline Brier at the shipped constants: ${format(result.baselineBrierFx, 6)}`);
  }
  out.push("");
  if (result.best === null) {
    out.push("No candidate produced a Brier score.");
    out.push("");
    return out.join("\n");
  }
  out.push("## Best candidate");
  out.push("");
  out.push(`Brier: ${format(result.best.brierFx, 6)} over ${result.best.evaluated} agents`);
  out.push("");
  for (const [path, value] of Object.entries(result.best.assignment)) {
    out.push(`- ${path} = ${value}`);
  }
  out.push("");
  out.push(
    result.underpowered
      ? "Constants remain labeled provisional until a run with adequate power reproduces this result."
      : `A constant adopted from this run cites ${result.run_id} as its provenance.`,
  );
  out.push("");
  return out.join("\n");
}

/**
 * Linkage-arm comparison report. Written to answer one question for the
 * author: can moderate-linkage outcomes be trusted as calibration labels, and
 * therefore which arm is the headline number?
 */
export function renderArmComparisonReport(c: ArmComparison, generatedFrom: string): string {
  const rec = recommendArm(c);
  const num = (v: bigint | null, dp = 4): string => (v === null ? "n/a" : format(v, dp));
  const signed = (v: bigint | null, dp = 4): string => {
    if (v === null) return "n/a";
    const s = format(v < 0n ? -v : v, dp);
    return v < 0n ? `-${s}` : `+${s}`;
  };

  const out: string[] = [];
  out.push("# Linkage arm comparison");
  out.push("");
  out.push(`Source cohort: ${generatedFrom}`);
  out.push(`Split at: ${c.split_ts} (block ${c.split_block})`);
  out.push(`Label view: ${c.view}`);
  out.push("");

  out.push("## The question");
  out.push("");
  out.push(
    "A commerce outcome is attached to an agent by evidence, not by declaration. A strong link matches the agent's own declared wallet; a moderate link matches its owner, which can over-attribute when that owner does other business from the same address. This report asks whether moderate-linkage outcomes behave like strong ones, and therefore whether they can be pooled into a headline result.",
  );
  out.push("");
  out.push(
    "The decisive comparison is strong against moderate, which are disjoint sets of evidence. Strong against pooled is reported for completeness but is diluted, because the pooled arm contains the strong rows.",
  );
  out.push("");

  out.push("## How much data each arm has");
  out.push("");
  out.push("| Arm | Agents | Jobs | Powered |");
  out.push("|---|---|---|---|");
  for (const a of [c.strong, c.moderate, c.pooled]) {
    out.push(`| ${a.arm} | ${a.agents} | ${a.jobs} | ${a.underpowered ? `no (under ${MIN_EVALUABLE_AGENTS})` : "yes"} |`);
  }
  out.push("");
  out.push(`Cohort: ${c.cohort_size} agents. Carrying both link types: ${c.agentsWithBothLinkTypes}.`);
  out.push("");

  out.push("## How the arms compare");
  out.push("");
  out.push("| Metric | strong | moderate | pooled | strong minus moderate |");
  out.push("|---|---|---|---|---|");
  out.push(
    `| Success base rate | ${num(c.strong.baseRateFx)} | ${num(c.moderate.baseRateFx)} | ${num(c.pooled.baseRateFx)} | ${signed(c.strongVsModerate.baseRateFx)} |`,
  );
  out.push(
    `| Brier (lower better) | ${num(c.strong.brierFx, 6)} | ${num(c.moderate.brierFx, 6)} | ${num(c.pooled.brierFx, 6)} | ${signed(c.strongVsModerate.brierFx, 6)} |`,
  );
  out.push(
    `| AUC (ranking) | ${num(c.strong.aucFx)} | ${num(c.moderate.aucFx)} | ${num(c.pooled.aucFx)} | ${signed(c.strongVsModerate.aucFx)} |`,
  );
  out.push(
    `| Calibration error | ${num(c.strong.eceFx)} | ${num(c.moderate.eceFx)} | ${num(c.pooled.eceFx)} | ${signed(c.strongVsModerate.eceFx)} |`,
  );
  out.push("");
  for (const a of [c.strong, c.moderate, c.pooled]) {
    if (a.gate !== null) out.push(`- ${a.arm}: ${a.gate.passed ? "beats" : "does not beat"} the trivial baselines (${a.gate.detail}).`);
  }
  if (c.strongVsModerate.gateVerdictDiffers) {
    out.push("");
    out.push(
      "The strata disagree about whether the index beats the baselines. That disagreement is the finding: the headline verdict depends on which outcomes you trust.",
    );
  }
  out.push("");

  out.push("## Where the arms disagree about individual agents");
  out.push("");
  if (c.divergences.length === 0) {
    out.push(
      "No agent's outcome label changes between arms. Any difference in the numbers above therefore comes from which agents are covered, not from the same agent being judged differently.",
    );
  } else {
    out.push(
      `${c.divergences.length} agents carry a label that changes between arms. These are the concrete cases where trusting moderate links changes what the data says about a specific agent.`,
    );
    out.push("");
    out.push("| Agent | strong | moderate | pooled | strong jobs | moderate jobs |");
    out.push("|---|---|---|---|---|---|");
    const lab = (v: 0 | 1 | null): string => (v === null ? "no label" : v === 1 ? "success" : "failure");
    for (const d of c.divergences.slice(0, 50)) {
      out.push(
        `| ${d.agent} | ${lab(d.strongLabel)} | ${lab(d.moderateLabel)} | ${lab(d.pooledLabel)} | ${d.strongJobs} | ${d.moderateJobs} |`,
      );
    }
    if (c.divergences.length > 50) out.push(`| ... and ${c.divergences.length - 50} more | | | | | |`);
  }
  out.push("");

  out.push("## What follows");
  out.push("");
  out.push(`Headline arm: **${rec.headline}**. Pooling ${rec.poolingDefensible ? "is" : "is not"} defensible from this comparison.`);
  out.push("");
  for (const r of rec.reasons) out.push(`- ${r}`);
  out.push("");
  out.push(
    "Agreement between strata is evidence that linkage confidence is not driving the result, which makes pooling defensible and buys back statistical power. It is not proof that individual moderate links are correct. Divergence is the more informative outcome, because it means the pooled number cannot carry a headline.",
  );
  out.push("");
  return out.join("\n");
}
