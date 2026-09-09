/**
 * End-to-end validation of the calibration pipeline.
 *
 * These tests do not check that the index predicts anything real. They check
 * that the harness behaves correctly on data whose answer is known by
 * construction: it must find signal that was planted, find none when none was
 * planted, and never let a post-split label reach the feature side.
 */
import { describe, expect, it } from "vitest";
import { ONE, format, parse } from "./fixed.js";
import { collapseLabel, labelFor } from "./labels.js";
import { splitAt, splitCohort } from "./split.js";
import { runCalibration, beatsAllBaselines, MIN_EVALUABLE_AGENTS } from "./run.js";
import { syntheticCohort } from "./synthetic.js";
import { indexScorePredictor } from "./predictors.js";

describe("labels", () => {
  it("maps outcomes to the success view", () => {
    expect(labelFor("completed", "success")).toBe(1);
    expect(labelFor("disputed", "success")).toBe(0);
    expect(labelFor("rejected", "success")).toBe(0);
    expect(labelFor("abandoned", "success")).toBe(0);
  });

  it("restricts the discrimination view to completed versus disputed", () => {
    expect(labelFor("completed", "discrimination")).toBe(1);
    expect(labelFor("disputed", "discrimination")).toBe(0);
    expect(labelFor("rejected", "discrimination")).toBeNull();
    expect(labelFor("abandoned", "discrimination")).toBeNull();
  });

  it("collapses an agent's outcomes conservatively: any failure is a failure", () => {
    const base = { chain_slug: "base", agent_id: "1" };
    expect(collapseLabel({ ...base, outcomes: [{ outcome: "completed", ts: "x" }] }, "success")).toBe(1);
    expect(
      collapseLabel(
        { ...base, outcomes: [{ outcome: "completed", ts: "x" }, { outcome: "disputed", ts: "y" }] },
        "success",
      ),
    ).toBe(0);
    expect(collapseLabel({ ...base, outcomes: [] }, "success")).toBeNull();
  });
});

describe("temporal split", () => {
  const cohort = syntheticCohort({ agents: 5, seed: 7, signalStrength: 1, splitDaysAgo: 30 });

  it("keeps only pre-split evidence on the feature side", () => {
    const s = cohort.snapshots[0]!;
    const { asOf, labels } = splitAt(s, cohort.splitTs, cohort.splitBlock);
    expect(asOf.as_of_ts).toBe(cohort.splitTs);
    for (const f of asOf.feedback) expect(f.ts <= cohort.splitTs).toBe(true);
    for (const c of asOf.commerce) expect(c.ts <= cohort.splitTs).toBe(true);
    // Every label is strictly after the split.
    for (const o of labels.outcomes) expect(o.ts > cohort.splitTs).toBe(true);
  });

  it("clears a reviewer commerce flag whose evidence is post-split (leakage guard)", () => {
    const s = structuredClone(cohort.snapshots[0]!);
    const reviewerAddress = Object.keys(s.reviewers)[0]!;
    // Plant the leak: the reviewer is flagged as having commerce with the
    // agent, but the only commerce record is after the split.
    s.reviewers[reviewerAddress]!.has_commerce_with_agent = true;
    s.commerce = [
      {
        counterparty: s.reviewers[reviewerAddress]!.address,
        outcome: "completed",
        ts: s.as_of_ts,
        block: s.as_of_block,
      },
    ];
    const { asOf, commerceFlagsAdjusted } = splitAt(s, cohort.splitTs, cohort.splitBlock);
    expect(commerceFlagsAdjusted).toBe(true);
    expect(asOf.reviewers[reviewerAddress]!.has_commerce_with_agent).toBe(false);
  });

  it("keeps a reviewer commerce flag whose evidence is pre-split", () => {
    const s = structuredClone(cohort.snapshots[0]!);
    const reviewerAddress = Object.keys(s.reviewers)[0]!;
    s.reviewers[reviewerAddress]!.has_commerce_with_agent = true;
    s.commerce = [
      {
        counterparty: s.reviewers[reviewerAddress]!.address,
        outcome: "completed",
        // 200 days ago, comfortably before a 30-day split.
        ts: "2026-01-13T00:00:00Z",
        block: 1,
      },
    ];
    const { asOf } = splitAt(s, cohort.splitTs, cohort.splitBlock);
    expect(asOf.reviewers[reviewerAddress]!.has_commerce_with_agent).toBe(true);
  });

  it("re-indexes transfer linkages when transfers are truncated", () => {
    const s = structuredClone(cohort.snapshots[0]!);
    s.transfers = [
      { from_address: s.owner_address, to_address: s.owner_address, block: 1, ts: "2026-01-01T00:00:00Z", tx_hash: `0x${"1".repeat(64)}` },
      { from_address: s.owner_address, to_address: s.owner_address, block: 2, ts: s.as_of_ts, tx_hash: `0x${"2".repeat(64)}` },
    ];
    s.transfer_linkages = [
      { transfer_index: 0, same_funder: true, bidirectional_history: false },
      { transfer_index: 1, same_funder: false, bidirectional_history: false },
    ];
    const { asOf } = splitAt(s, cohort.splitTs, cohort.splitBlock);
    expect(asOf.transfers).toHaveLength(1);
    expect(asOf.transfer_linkages).toHaveLength(1);
    expect(asOf.transfer_linkages[0]!.transfer_index).toBe(0);
    expect(asOf.transfer_linkages[0]!.same_funder).toBe(true);
  });

  it("excludes agents with no post-split outcome and counts them", () => {
    const s = structuredClone(cohort.snapshots[0]!);
    s.commerce = [];
    const { evaluable, excludedNoLabel } = splitCohort([s], cohort.splitTs, cohort.splitBlock);
    expect(evaluable).toHaveLength(0);
    expect(excludedNoLabel).toBe(1);
  });
});

describe("calibration run on synthetic data", () => {
  it("detects a planted signal: the index beats chance when outcomes follow quality", () => {
    const cohort = syntheticCohort({ agents: 200, seed: 42, signalStrength: 1, splitDaysAgo: 30 });
    const run = runCalibration(cohort.snapshots, cohort.splitTs, cohort.splitBlock);
    expect(run.evaluated).toBeGreaterThanOrEqual(MIN_EVALUABLE_AGENTS);
    expect(run.underpowered).toBe(false);
    const model = run.results.find((r) => r.name === "index_score")!;
    // With outcomes driven by the same quality the feedback reflects, the
    // score must rank agents better than a coin flip.
    expect(model.metrics.aucFx).not.toBeNull();
    expect(model.metrics.aucFx! > parse("0.5")).toBe(true);
  });

  it("finds no discrimination when outcomes are independent of the evidence", () => {
    const cohort = syntheticCohort({ agents: 200, seed: 99, signalStrength: 0, splitDaysAgo: 30 });
    const run = runCalibration(cohort.snapshots, cohort.splitTs, cohort.splitBlock);
    const model = run.results.find((r) => r.name === "index_score")!;
    // Pure noise: AUC must sit near chance. A harness that reported strong
    // discrimination here would be measuring itself, not the data.
    const auc = model.metrics.aucFx!;
    expect(auc > parse("0.35")).toBe(true);
    expect(auc < parse("0.65")).toBe(true);
  });

  it("runs every baseline and reports a gate verdict", () => {
    const cohort = syntheticCohort({ agents: 120, seed: 5, signalStrength: 1, splitDaysAgo: 30 });
    const run = runCalibration(cohort.snapshots, cohort.splitTs, cohort.splitBlock);
    expect(run.results.map((r) => r.name)).toEqual([
      "index_score",
      "raw_mean",
      "review_count",
      "wallet_age",
    ]);
    const gate = beatsAllBaselines(run);
    expect(typeof gate.passed).toBe("boolean");
    expect(gate.detail.length).toBeGreaterThan(0);
  });

  it("flags an underpowered run rather than reporting it as a result", () => {
    const cohort = syntheticCohort({ agents: 5, seed: 3, signalStrength: 1, splitDaysAgo: 30 });
    const run = runCalibration(cohort.snapshots, cohort.splitTs, cohort.splitBlock);
    expect(run.underpowered).toBe(true);
  });

  it("is deterministic: the same cohort and split reproduce the same Brier", () => {
    const a = syntheticCohort({ agents: 60, seed: 11, signalStrength: 1, splitDaysAgo: 30 });
    const b = syntheticCohort({ agents: 60, seed: 11, signalStrength: 1, splitDaysAgo: 30 });
    const ra = runCalibration(a.snapshots, a.splitTs, a.splitBlock, { predictors: [indexScorePredictor] });
    const rb = runCalibration(b.snapshots, b.splitTs, b.splitBlock, { predictors: [indexScorePredictor] });
    expect(format(ra.results[0]!.metrics.brierFx, 12)).toBe(format(rb.results[0]!.metrics.brierFx, 12));
  });

  it("keeps every predicted probability inside [0,1]", () => {
    const cohort = syntheticCohort({ agents: 50, seed: 21, signalStrength: 1, splitDaysAgo: 30 });
    const { evaluable } = splitCohort(cohort.snapshots, cohort.splitTs, cohort.splitBlock);
    const snapshots = evaluable.map((e) => e.asOf);
    for (const p of indexScorePredictor.predict(snapshots)) {
      expect(p.pFx >= 0n && p.pFx <= ONE).toBe(true);
    }
  });
});
