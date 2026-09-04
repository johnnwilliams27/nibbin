/**
 * Scoring the grid.
 *
 * A panel run produces a lot of numbers, and most of them are the wrong ones.
 * Accuracy per model is the number everyone reaches for, and on its own it
 * cannot answer the question we are actually asking, which is WHICH STRUCTURE
 * TO SHIP. Four measurements decide that, and three of them are usually
 * missing from comparisons like this one.
 *
 * 1. PAIRWISE ERROR CORRELATION. The whole case for three vendors is that their
 *    mistakes are independent. If two voters are wrong on the same items, a
 *    majority of three is really a majority of two, and the third vendor is
 *    paying for nothing. Reported as a phi coefficient over error indicators,
 *    which is the plainest way to say "when this one is wrong, is that one
 *    wrong too". Nobody quotes this and it is the number that decides whether
 *    the panel is a panel or an echo.
 *
 * 2. RESCUE AND BREAKAGE, not lift. A decider's average accuracy hides the
 *    trade it is making. What matters is how often it fixes a majority that was
 *    wrong (rescue) against how often it overturns a majority that was right
 *    (breakage). A decider with a good average and a bad breakage rate is
 *    actively dangerous: it damages the cases the cheap panel already had.
 *
 * 3. SELF-PREFERENCE. Voters are anonymised, so a decider siding with its own
 *    lab's voter more often than with the others is measurable. The sharp form
 *    is conditional: on items where its own family's voter was WRONG and the
 *    others were right, how often did it follow the sibling anyway?
 *
 * 4. THE SOLO BASELINE. If one premium model alone matches voters-plus-decider,
 *    the voting layer buys nothing and the honest recommendation is to skip it.
 *    A grid that cannot produce that answer is not an experiment, it is a
 *    procurement exercise looking for a justification.
 *
 * Everything here is pure. It reads a stored PanelRun and computes; it never
 * calls a model. The run is the artifact, the metrics are reproducible from it,
 * and re-scoring under a new metric never means re-spending money.
 */
import type { DeciderVerdict, PanelItem, PanelRun, VoteRecord, VoterVote } from "./panel.js";
import { majorityOf } from "./panel.js";
import type { Vendor } from "./provider.js";

/** Per-1M-token prices, so a run reports what it actually cost rather than an estimate. */
export type PriceSheet = Record<string, { input: number; output: number }>;

export type ClassMetrics = { label: string; support: number; correct: number; recall: number | null };

export type ModelMetrics = {
  vendor: Vendor;
  modelId: string;
  role: "voter" | "decider" | "solo";
  /** Items where the model returned a usable verdict. */
  answered: number;
  /** Items where it failed to answer at all. Gate G2 lives here. */
  failed: number;
  /** Of answered items that carry a label. */
  scored: number;
  correct: number;
  accuracy: number | null;
  per_class: ClassMetrics[];
  /** Mean latency of successful calls, milliseconds. */
  mean_ms: number | null;
  input_tokens: number;
  output_tokens: number;
  usd: number | null;
};

export type StructureMetrics = {
  name: string;
  /** Items where the structure produced a verdict at all. */
  decided: number;
  /** Items where it abstained; for majority-only this is a split panel. */
  abstained: number;
  scored: number;
  correct: number;
  accuracy: number | null;
  /** Accuracy counting an abstention as a miss. What the compendium actually feels. */
  coverage_adjusted_accuracy: number | null;
  usd: number | null;
};

export type CorrelationCell = { a: string; b: string; phi: number | null; both_wrong: number; overlap: number };

export type DeciderBehaviour = {
  vendor: Vendor;
  modelId: string;
  mode: string;
  /** Majority was wrong, decider was right. */
  rescued: number;
  /** Majority was wrong, decider was wrong too. */
  missed: number;
  /** Majority was right, decider broke it. */
  broke: number;
  /** Majority was right, decider agreed. */
  held: number;
  rescue_rate: number | null;
  breakage_rate: number | null;
  /**
   * Voters split (no majority), decider got it right.
   *
   * On a two-voter panel this is where the decider does most of its work, and
   * rescue/breakage cannot see it: those only count items where the voters
   * agreed. Without this pair, a two-model panel's adjudicator would be judged
   * entirely on the minority of items it was least needed for.
   */
  split_resolved: number;
  /** Voters split, decider got it wrong. */
  split_missed: number;
  split_resolution_rate: number | null;
  /** Items where its own lab's voter was wrong and at least one other was right. */
  sibling_wrong_others_right: number;
  /** ...and it followed the sibling anyway. */
  followed_wrong_sibling: number;
  self_preference: number | null;
};

export type PanelMetrics = {
  items: number;
  labelled: number;
  models: ModelMetrics[];
  structures: StructureMetrics[];
  correlation: CorrelationCell[];
  decider_behaviour: DeciderBehaviour[];
  /** What happens when the labs disagree as blocs. */
  blocs: BlocAnalysis;
  /** Every smaller voter combination, re-derived from the stored votes. */
  subsets: SubsetResult[];
  /** Gate G2: did every model always return schema-valid output? */
  schema_failures: { vendor: Vendor; modelId: string; failures: number; sample: string[] }[];
};

function usdFor(prices: PriceSheet | undefined, modelId: string, inTok: number, outTok: number): number | null {
  const p = prices?.[modelId];
  if (p === undefined) return null;
  return (inTok / 1e6) * p.input + (outTok / 1e6) * p.output;
}

function mean(xs: readonly number[]): number | null {
  return xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;
}

/**
 * Phi over two binary error vectors.
 *
 * Chosen over raw agreement because raw agreement is inflated by the base rate:
 * two models that are each 95% accurate agree 90% of the time by luck alone,
 * and that looks like corroboration when it is arithmetic. Phi asks whether
 * they are wrong TOGETHER more than chance, which is the actual question.
 */
export function phi(a: readonly boolean[], b: readonly boolean[]): number | null {
  if (a.length !== b.length || a.length === 0) return null;
  let n11 = 0;
  let n10 = 0;
  let n01 = 0;
  let n00 = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] === true;
    const y = b[i] === true;
    if (x && y) n11 += 1;
    else if (x) n10 += 1;
    else if (y) n01 += 1;
    else n00 += 1;
  }
  const denom = Math.sqrt((n11 + n10) * (n01 + n00) * (n11 + n01) * (n10 + n00));
  // A zero denominator means one of the two never erred (or always did). There
  // is no correlation to report, and reporting 0 would read as "independent",
  // which is a different and unearned claim.
  if (denom === 0) return null;
  return (n11 * n00 - n10 * n01) / denom;
}

/**
 * Every vote from one vendor.
 *
 * Plural, because a three-voter panel drawn from two vendors gives one of them
 * two seats. An earlier single-vote lookup returned whichever happened to be
 * first, which would have made the self-preference number a measurement of
 * array order.
 */
function votesOf(record: VoteRecord, vendor: Vendor): Extract<VoterVote, { ok: true }>[] {
  return record.votes.filter((v): v is Extract<VoterVote, { ok: true }> => v.ok && v.vendor === vendor);
}

/**
 * When the labs disagree as blocs, who is right?
 *
 * The sharpest question a two-vendor panel can answer about itself. Voters from
 * one lab share training data, RLHF lineage and tokenizer, so four voters are
 * not four opinions — they are two opinions held with varying confidence. A
 * BLOC SPLIT is an item where each lab's voters agreed among themselves and the
 * labs disagreed with each other: the case where the panel's apparent breadth
 * collapses to a coin flip between two vendors.
 *
 * On an evenly-split panel these are exactly the items majority rule cannot
 * resolve, so they land on the adjudicator. Knowing which lab tends to be right
 * on them is worth more than any aggregate accuracy number, because it says
 * what a cheaper panel should be made of.
 */
export type BlocAnalysis = {
  /** Labelled items where each vendor's voters were internally unanimous and the vendors disagreed. */
  cases: number;
  /** Per vendor: how often that lab's bloc held the correct verdict on those items. */
  correct_by_vendor: Record<string, number>;
  /** Of those items, how many majority rule left undecided (an even split). */
  unresolved_by_majority: number;
};

/**
 * One candidate structure: some subset of the voters, majority rule, no decider.
 *
 * The reason this exists is that the roster will change. Rather than paying for
 * a new grid every time the question "do we need all four" comes up, every
 * smaller voter combination is re-derived from the votes already stored — the
 * models answered independently, so any subset's majority is exactly computable
 * after the fact.
 *
 * THE LIMIT, STATED SO IT IS NOT OVERCLAIMED: this works for majority-only
 * structures and not for decider structures. Each decider saw all four votes,
 * so what it would have said given only two of them is unknown and cannot be
 * reconstructed. A subset-plus-decider structure needs its own run.
 */
export type SubsetResult = {
  models: string[];
  vendors: string[];
  size: number;
  decided: number;
  scored: number;
  correct: number;
  accuracy: number | null;
  coverage_adjusted_accuracy: number | null;
  usd: number | null;
};

function labelOf(items: ReadonlyMap<string, PanelItem>, id: string): string | null {
  return items.get(id)?.label ?? null;
}

/**
 * Score a run.
 *
 * `prices` is optional: without it every usd field is null, which is honest.
 * Zero would not be.
 */
export function scorePanel(
  run: PanelRun,
  itemList: readonly PanelItem[],
  prices?: PriceSheet,
): PanelMetrics {
  const items = new Map(itemList.map((i) => [i.id, i]));
  const labelledIds = run.records.map((r) => r.item_id).filter((id) => labelOf(items, id) !== null);
  const labels = [...new Set(itemList.map((i) => i.label).filter((l): l is string => l !== null))].sort();

  // ---- per-model, voters -------------------------------------------------
  const models: ModelMetrics[] = [];
  const schema_failures: PanelMetrics["schema_failures"] = [];
  const errorVectors = new Map<string, boolean[]>();

  for (const voter of run.voters) {
    const answered: VoterVote[] = [];
    const failures: string[] = [];
    const errs: boolean[] = [];
    let correct = 0;
    let scored = 0;
    let inTok = 0;
    let outTok = 0;
    const perClass = new Map<string, { support: number; correct: number }>();

    for (const record of run.records) {
      // Keyed on model id, not vendor. With two voters from one lab, a
      // vendor-keyed lookup would score whichever came first twice and the
      // other never, and both would carry a plausible-looking accuracy.
      const vote = record.votes.find((v) => v.modelId === voter.modelId);
      if (vote === undefined) continue;
      if (!vote.ok) {
        failures.push(vote.error);
        continue;
      }
      answered.push(vote);
      inTok += vote.usage?.input_tokens ?? 0;
      outTok += vote.usage?.output_tokens ?? 0;
      const label = labelOf(items, record.item_id);
      if (label === null) continue;
      scored += 1;
      const hit = vote.verdict === label;
      if (hit) correct += 1;
      errs.push(!hit);
      const c = perClass.get(label) ?? { support: 0, correct: 0 };
      c.support += 1;
      if (hit) c.correct += 1;
      perClass.set(label, c);
    }

    const key = `${voter.vendor}:${voter.modelId}`;
    errorVectors.set(key, errs);
    models.push({
      vendor: voter.vendor,
      modelId: voter.modelId,
      role: "voter",
      answered: answered.length,
      failed: failures.length,
      scored,
      correct,
      accuracy: scored === 0 ? null : correct / scored,
      per_class: labels.map((l) => {
        const c = perClass.get(l);
        return {
          label: l,
          support: c?.support ?? 0,
          correct: c?.correct ?? 0,
          recall: c === undefined || c.support === 0 ? null : c.correct / c.support,
        };
      }),
      mean_ms: mean(answered.map((a) => a.ms)),
      input_tokens: inTok,
      output_tokens: outTok,
      usd: usdFor(prices, voter.modelId, inTok, outTok),
    });
    if (failures.length > 0) {
      schema_failures.push({
        vendor: voter.vendor,
        modelId: voter.modelId,
        failures: failures.length,
        sample: failures.slice(0, 3),
      });
    }
  }

  // ---- per-model, deciders and solos --------------------------------------
  const scoreVerdicts = (
    verdicts: readonly DeciderVerdict[],
    role: "decider" | "solo",
  ): void => {
    const groups = new Map<string, DeciderVerdict[]>();
    for (const d of verdicts) {
      const k = `${d.vendor}|${d.modelId}|${d.mode}|${role}`;
      const g = groups.get(k) ?? [];
      g.push(d);
      groups.set(k, g);
    }
    for (const [, group] of groups) {
      const first = group[0];
      if (first === undefined) continue;
      const okOnes = group.filter((g): g is Extract<DeciderVerdict, { ok: true }> => g.ok);
      const failures = group.filter((g) => !g.ok).map((g) => (g.ok ? "" : g.error));
      let correct = 0;
      let scored = 0;
      let inTok = 0;
      let outTok = 0;
      const errs: boolean[] = [];
      const perClass = new Map<string, { support: number; correct: number }>();
      for (const d of okOnes) {
        inTok += d.usage?.input_tokens ?? 0;
        outTok += d.usage?.output_tokens ?? 0;
        const label = labelOf(items, d.item_id);
        if (label === null) continue;
        scored += 1;
        const hit = d.verdict === label;
        if (hit) correct += 1;
        errs.push(!hit);
        const c = perClass.get(label) ?? { support: 0, correct: 0 };
        c.support += 1;
        if (hit) c.correct += 1;
        perClass.set(label, c);
      }
      const modelKey = `${first.vendor}:${first.modelId}:${role}:${first.mode}`;
      errorVectors.set(modelKey, errs);
      models.push({
        vendor: first.vendor,
        modelId: `${first.modelId}${role === "decider" ? ` (decider/${first.mode})` : " (solo)"}`,
        role,
        answered: okOnes.length,
        failed: failures.length,
        scored,
        correct,
        accuracy: scored === 0 ? null : correct / scored,
        per_class: labels.map((l) => {
          const c = perClass.get(l);
          return {
            label: l,
            support: c?.support ?? 0,
            correct: c?.correct ?? 0,
            recall: c === undefined || c.support === 0 ? null : c.correct / c.support,
          };
        }),
        mean_ms: mean(okOnes.map((a) => a.ms)),
        input_tokens: inTok,
        output_tokens: outTok,
        usd: usdFor(prices, first.modelId, inTok, outTok),
      });
      if (failures.length > 0) {
        schema_failures.push({
          vendor: first.vendor,
          modelId: first.modelId,
          failures: failures.length,
          sample: failures.slice(0, 3),
        });
      }
    }
  };
  scoreVerdicts(run.decisions, "decider");
  scoreVerdicts(run.solos, "solo");

  // ---- structures ---------------------------------------------------------
  const structures: StructureMetrics[] = [];
  const voterCost = models
    .filter((m) => m.role === "voter")
    .reduce<number | null>((acc, m) => (acc === null || m.usd === null ? null : acc + m.usd), 0);

  {
    let decided = 0;
    let correct = 0;
    // Labelled items where the panel actually produced a majority. The
    // denominator for "how good is the answer WHEN there is one".
    let scoredAndDecided = 0;
    // All labelled items, decided or not. The denominator the compendium feels,
    // because a split panel publishes nothing and an unpublished rating is a
    // miss from the reader's side of the table.
    let scored = 0;
    for (const r of run.records) {
      if (r.majority !== null) decided += 1;
      const label = labelOf(items, r.item_id);
      if (label === null) continue;
      scored += 1;
      if (r.majority === null) continue;
      scoredAndDecided += 1;
      if (r.majority === label) correct += 1;
    }
    structures.push({
      name: "S0 majority of three voters (no decider)",
      decided,
      abstained: run.records.length - decided,
      scored,
      correct,
      accuracy: scoredAndDecided === 0 ? null : correct / scoredAndDecided,
      coverage_adjusted_accuracy: scored === 0 ? null : correct / scored,
      usd: voterCost,
    });
  }

  const byDecider = new Map<string, DeciderVerdict[]>();
  for (const d of run.decisions) {
    const k = `${d.vendor}|${d.modelId}|${d.mode}`;
    const g = byDecider.get(k) ?? [];
    g.push(d);
    byDecider.set(k, g);
  }
  const decider_behaviour: DeciderBehaviour[] = [];
  for (const [, group] of byDecider) {
    const first = group[0];
    if (first === undefined) continue;
    let correct = 0;
    let scored = 0;
    let decided = 0;
    let rescued = 0;
    let missed = 0;
    let broke = 0;
    let held = 0;
    let splitResolved = 0;
    let splitMissed = 0;
    let siblingCases = 0;
    let followedSibling = 0;
    const recordById = new Map(run.records.map((r) => [r.item_id, r]));

    for (const d of group) {
      if (!d.ok) continue;
      decided += 1;
      const label = labelOf(items, d.item_id);
      if (label === null) continue;
      scored += 1;
      const hit = d.verdict === label;
      if (hit) correct += 1;

      const record = recordById.get(d.item_id);
      if (record === undefined) continue;
      if (record.majority === null) {
        if (hit) splitResolved += 1;
        else splitMissed += 1;
      } else if (record.majority === label) {
        if (hit) held += 1;
        else broke += 1;
      } else {
        if (hit) rescued += 1;
        else missed += 1;
      }

      // Siblings are every voter from the decider's own lab — two of them when
      // that lab holds two seats. The case only counts when ALL of them were
      // wrong and some other vendor's voter was right; following the family
      // then is following it against the available evidence.
      const siblings = votesOf(record, d.vendor);
      const others = record.votes.filter((v) => v.ok && v.vendor !== d.vendor);
      if (
        siblings.length > 0 &&
        siblings.every((s) => s.verdict !== label) &&
        others.some((o) => o.ok && o.verdict === label)
      ) {
        siblingCases += 1;
        if (siblings.some((s) => s.verdict === d.verdict)) followedSibling += 1;
      }
    }

    const deciderCost = models.find(
      (m) => m.role === "decider" && m.vendor === first.vendor && m.modelId.startsWith(first.modelId),
    )?.usd;
    structures.push({
      name: `S:${first.vendor} decider (${first.mode}) over three voters`,
      decided,
      abstained: group.length - decided,
      scored,
      correct,
      accuracy: scored === 0 ? null : correct / scored,
      coverage_adjusted_accuracy: labelledIds.length === 0 ? null : correct / labelledIds.length,
      usd: voterCost === null || deciderCost === null || deciderCost === undefined ? null : voterCost + deciderCost,
    });
    decider_behaviour.push({
      vendor: first.vendor,
      modelId: first.modelId,
      mode: first.mode,
      rescued,
      missed,
      broke,
      held,
      rescue_rate: rescued + missed === 0 ? null : rescued / (rescued + missed),
      breakage_rate: broke + held === 0 ? null : broke / (broke + held),
      split_resolved: splitResolved,
      split_missed: splitMissed,
      split_resolution_rate:
        splitResolved + splitMissed === 0 ? null : splitResolved / (splitResolved + splitMissed),
      sibling_wrong_others_right: siblingCases,
      followed_wrong_sibling: followedSibling,
      self_preference: siblingCases === 0 ? null : followedSibling / siblingCases,
    });
  }

  for (const m of models.filter((x) => x.role === "solo")) {
    structures.push({
      name: `S:solo ${m.modelId}`,
      decided: m.answered,
      abstained: m.failed,
      scored: m.scored,
      correct: m.correct,
      accuracy: m.accuracy,
      coverage_adjusted_accuracy: labelledIds.length === 0 ? null : m.correct / labelledIds.length,
      usd: m.usd,
    });
  }

  // ---- correlation --------------------------------------------------------
  const correlation: CorrelationCell[] = [];
  const keys = [...errorVectors.keys()].filter((k) => (errorVectors.get(k) ?? []).length > 0).sort();
  for (let i = 0; i < keys.length; i += 1) {
    for (let j = i + 1; j < keys.length; j += 1) {
      const a = keys[i]!;
      const b = keys[j]!;
      const va = errorVectors.get(a)!;
      const vb = errorVectors.get(b)!;
      const n = Math.min(va.length, vb.length);
      let bothWrong = 0;
      for (let k = 0; k < n; k += 1) if (va[k] === true && vb[k] === true) bothWrong += 1;
      correlation.push({ a, b, phi: phi(va.slice(0, n), vb.slice(0, n)), both_wrong: bothWrong, overlap: n });
    }
  }

  // ---- bloc analysis ------------------------------------------------------
  let blocCases = 0;
  let blocUnresolved = 0;
  const blocCorrect: Record<string, number> = {};
  for (const record of run.records) {
    const label = labelOf(items, record.item_id);
    if (label === null) continue;
    const good = record.votes.filter((v): v is Extract<VoterVote, { ok: true }> => v.ok);
    if (good.length < 2) continue;
    const byVendor = new Map<Vendor, Extract<VoterVote, { ok: true }>[]>();
    for (const g of good) byVendor.set(g.vendor, [...(byVendor.get(g.vendor) ?? []), g]);
    if (byVendor.size < 2) continue;
    // Each lab internally unanimous...
    const positions = [...byVendor.entries()].map(([vendor, votes]) => ({
      vendor,
      unanimous: new Set(votes.map((v) => v.verdict)).size === 1,
      verdict: votes[0]!.verdict,
    }));
    if (!positions.every((p) => p.unanimous)) continue;
    // ...and the labs disagreeing with each other.
    if (new Set(positions.map((p) => p.verdict)).size < 2) continue;
    blocCases += 1;
    if (record.majority === null) blocUnresolved += 1;
    for (const p of positions) {
      if (p.verdict === label) blocCorrect[p.vendor] = (blocCorrect[p.vendor] ?? 0) + 1;
    }
  }

  return {
    items: run.items,
    labelled: labelledIds.length,
    models,
    structures,
    correlation,
    decider_behaviour,
    blocs: {
      cases: blocCases,
      correct_by_vendor: blocCorrect,
      unresolved_by_majority: blocUnresolved,
    },
    subsets: voterSubsets(run, itemList, prices),
    schema_failures,
  };
}

/**
 * Re-derive every smaller voter combination from the stored votes.
 *
 * The models answered independently, so any subset's majority is exactly
 * computable after the fact — no re-running, no extra spend. This is what makes
 * "do we need all four, and which ones" an offline question.
 *
 * A subset of one is that model answering alone, which is the right reading:
 * there is no panel to abstain on. From two upwards the same rule as the live
 * panel applies, including that fewer than two usable votes is an abstention
 * rather than one model speaking for the group.
 */
export function voterSubsets(
  run: PanelRun,
  itemList: readonly PanelItem[],
  prices?: PriceSheet,
): SubsetResult[] {
  const items = new Map(itemList.map((i) => [i.id, i]));
  const voters = run.voters;
  const out: SubsetResult[] = [];

  for (let mask = 1; mask < 1 << voters.length; mask += 1) {
    const chosen = voters.filter((_, i) => (mask & (1 << i)) !== 0);
    const ids = new Set(chosen.map((c) => c.modelId));
    let decided = 0;
    let scored = 0;
    let scoredAndDecided = 0;
    let correct = 0;
    let inTok = 0;
    let outTok = 0;

    for (const record of run.records) {
      const good = record.votes.filter(
        (v): v is Extract<VoterVote, { ok: true }> => v.ok && ids.has(v.modelId),
      );
      for (const g of good) {
        inTok += g.usage?.input_tokens ?? 0;
        outTok += g.usage?.output_tokens ?? 0;
      }
      const verdict =
        chosen.length === 1
          ? (good[0]?.verdict ?? null)
          : good.length < 2
            ? null
            : majorityOf(good.map((g) => g.verdict));
      if (verdict !== null) decided += 1;
      const label = labelOf(items, record.item_id);
      if (label === null) continue;
      scored += 1;
      if (verdict === null) continue;
      scoredAndDecided += 1;
      if (verdict === label) correct += 1;
    }

    const usd = chosen.reduce<number | null>((acc, c) => {
      if (acc === null) return null;
      const p = prices?.[c.modelId];
      return p === undefined ? null : acc;
    }, 0);
    out.push({
      models: chosen.map((c) => c.modelId),
      vendors: [...new Set(chosen.map((c) => c.vendor))],
      size: chosen.length,
      decided,
      scored,
      correct,
      accuracy: scoredAndDecided === 0 ? null : correct / scoredAndDecided,
      coverage_adjusted_accuracy: scored === 0 ? null : correct / scored,
      usd: usd === null ? null : perSubsetUsd(chosen, inTok, outTok, prices),
    });
  }

  // Best first by the number that matters: correct over every labelled item.
  out.sort((a, b) => (b.coverage_adjusted_accuracy ?? -1) - (a.coverage_adjusted_accuracy ?? -1));
  return out;
}

/**
 * Cost of a subset.
 *
 * Token counts are pooled across the subset's members, so the split by model is
 * approximated by each member's share of calls. Good enough to rank structures
 * by cost; the per-model `usd` figures above are the exact ones.
 */
function perSubsetUsd(
  chosen: readonly { modelId: string }[],
  inTok: number,
  outTok: number,
  prices?: PriceSheet,
): number | null {
  if (prices === undefined || chosen.length === 0) return null;
  let total = 0;
  for (const c of chosen) {
    const p = prices[c.modelId];
    if (p === undefined) return null;
    total += (inTok / chosen.length / 1e6) * p.input + (outTok / chosen.length / 1e6) * p.output;
  }
  return total;
}

/** Convenience for the roster: price sheet keyed by model id. Filled from the note's table. */
export function priceSheet(entries: readonly { modelId: string; input: number; output: number }[]): PriceSheet {
  const out: PriceSheet = {};
  for (const e of entries) out[e.modelId] = { input: e.input, output: e.output };
  return out;
}
