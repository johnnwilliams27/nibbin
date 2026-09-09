/**
 * The chain path expressed through the generic contract.
 *
 * The claim being tested is narrow and worth stating precisely: on a snapshot
 * where every chain-only reviewer signal is inactive, and with the provenance
 * multiplier neutralized, the generic engine reproduces the chain engine's
 * number exactly, to the last published digit.
 *
 * Conditions for "chain-only signals inactive":
 *   - no two reviewers created within cohort_window_hours of each other
 *   - no shared first funder (independence_group is the generic twin, and it
 *     is set from funder_address, so a shared funder is not "inactive" here;
 *     it is a signal both paths have and they weight it differently)
 *   - no reviewer past the velocity threshold
 *   - exactly one review per reviewer, so the chain repeat bonus is 1
 *   - no commerce corroboration
 *   - portfolio concentration 0
 *
 * Under those conditions both paths compute weight = age multiplier, decay the
 * same way, cap per reviewer the same way, and shrink toward the same prior
 * with the same k. If they disagree, one of them has a bug, and that is the
 * point of running it.
 *
 * The equivalence is deliberately not asserted with the provenance multiplier
 * live. Third-party reviews are down-weighted to 0.60 on the generic path and
 * to 1.00 on the chain path, because the generic path knows something the
 * chain path does not: that a review is an opinion sitting alongside
 * measurements. That difference is the methodology and not a defect, so the
 * test neutralizes it rather than pretending it is absent.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_CONSTANTS, type FeedbackEntry, type ReviewerSnapshot } from "@trust-index/types";
import { score } from "../src/index.js";
import { scoreSubject } from "../src/rating/index.js";
import { agentSnapshotToSubject, ratingConstantsFromMethodology } from "../src/rating/adapter.js";
import { makeSnapshot } from "./helpers.js";
import { neutralProvenance } from "./rating-helpers.js";

const ADDRESSES = [
  "0x00000000000000000000000000000000000000c1",
  "0x00000000000000000000000000000000000000c2",
  "0x00000000000000000000000000000000000000c3",
  "0x00000000000000000000000000000000000000c4",
] as const;

/** Reviewers spread far enough apart in creation time that no cohort forms. */
function reviewer(address: string, firstSeenTs: string): ReviewerSnapshot {
  return {
    address: address as ReviewerSnapshot["address"],
    first_seen_block: 10,
    first_seen_ts: firstSeenTs,
    total_reviews: 3,
    distinct_agents_reviewed: 3,
    max_reviews_single_day: 1,
    funder_address: null,
    portfolio_top_funder_share: "0.000000",
    has_commerce_with_agent: false,
  };
}

function feedback(address: string, index: number, value: string, ts: string): FeedbackEntry {
  return {
    client_address: address as FeedbackEntry["client_address"],
    feedback_index: index,
    value_raw: value,
    value_decimals: 0,
    tag1: "code-review",
    tag2: "",
    block: 500,
    ts,
    is_revoked: false,
    detected_scale: { min_raw: "0", max_raw: "100" },
  };
}

const NEUTRAL_SNAPSHOT = makeSnapshot({
  feedback: [
    feedback(ADDRESSES[0], 0, "80", "2026-06-01T00:00:00Z"),
    feedback(ADDRESSES[1], 0, "60", "2026-05-01T00:00:00Z"),
    feedback(ADDRESSES[2], 0, "95", "2026-07-01T00:00:00Z"),
    feedback(ADDRESSES[3], 0, "40", "2026-04-01T00:00:00Z"),
  ],
  reviewers: {
    [ADDRESSES[0]]: reviewer(ADDRESSES[0], "2024-01-01T00:00:00Z"),
    [ADDRESSES[1]]: reviewer(ADDRESSES[1], "2024-06-01T00:00:00Z"),
    [ADDRESSES[2]]: reviewer(ADDRESSES[2], "2025-01-01T00:00:00Z"),
    [ADDRESSES[3]]: reviewer(ADDRESSES[3], "2025-06-01T00:00:00Z"),
  },
  priors: {
    global: "0.550000",
    by_context: {},
    basis: "high_weight_weighted_mean",
    n_basis: "100.00",
  },
});

describe("agentSnapshotToSubject", () => {
  it("reproduces the chain score exactly on a snapshot with no chain-only signals", () => {
    const chain = score(NEUTRAL_SNAPSHOT).result;
    const subject = agentSnapshotToSubject(NEUTRAL_SNAPSHOT, {
      constants: neutralProvenance(ratingConstantsFromMethodology(NEUTRAL_SNAPSHOT)),
    });
    const generic = scoreSubject(subject).result;
    const satisfaction = generic.dimensions.find((d) => d.dimension === "counterparty_satisfaction")!;

    expect(satisfaction.n_eff).toBe(chain.n_eff);
    expect(satisfaction.score).toBe(chain.score);
    expect(satisfaction.score_low).toBe(chain.score_low);
    expect(satisfaction.score_high).toBe(chain.score_high);
    expect(satisfaction.confidence).toBe(chain.confidence);
    expect(satisfaction.distinct_observers).toBe(chain.signals.distinct_counterparties);
    expect(satisfaction.span_days).toBe(chain.signals.feedback_span_days);
  });

  it("gives each reviewer the same weight on both paths", () => {
    const chain = score(NEUTRAL_SNAPSHOT).result;
    const generic = scoreSubject(
      agentSnapshotToSubject(NEUTRAL_SNAPSHOT, {
        constants: neutralProvenance(ratingConstantsFromMethodology(NEUTRAL_SNAPSHOT)),
      }),
    ).result;
    for (const w of chain.reviewer_weights) {
      const g = generic.observer_weights.find((x) => x.observer_id === w.address);
      expect(g, w.address).toBeDefined();
      expect(g!.weight, w.address).toBe(w.weight);
    }
  });

  it("down-weights reviews relative to measurements once provenance is live", () => {
    const neutral = scoreSubject(
      agentSnapshotToSubject(NEUTRAL_SNAPSHOT, {
        constants: neutralProvenance(ratingConstantsFromMethodology(NEUTRAL_SNAPSHOT)),
      }),
    ).result;
    const live = scoreSubject(agentSnapshotToSubject(NEUTRAL_SNAPSHOT)).result;
    const nEffNeutral = neutral.dimensions.find((d) => d.dimension === "counterparty_satisfaction")!.n_eff;
    const nEffLive = live.dimensions.find((d) => d.dimension === "counterparty_satisfaction")!.n_eff;
    expect(nEffLive).toBeLessThan(nEffNeutral);
    // Less evidence means a wider interval, which is the whole intent.
    const wide = live.dimensions.find((d) => d.dimension === "counterparty_satisfaction")!;
    const narrow = neutral.dimensions.find((d) => d.dimension === "counterparty_satisfaction")!;
    expect(wide.score_high! - wide.score_low!).toBeGreaterThan(narrow.score_high! - narrow.score_low!);
  });

  it("applies ownership epochs before the evidence leaves the chain side", () => {
    // SPEC 11.6: pre-transfer feedback does not carry across a sale. The
    // generic engine has no epochs, so the adapter must have filtered it.
    const transferred = makeSnapshot({
      ...NEUTRAL_SNAPSHOT,
      transfers: [
        {
          from_address: "0x000000000000000000000000000000000000000a",
          to_address: "0x000000000000000000000000000000000000000f",
          block: 600,
          ts: "2026-07-15T00:00:00Z",
          tx_hash: "0xaa",
        },
      ],
      transfer_linkages: [],
    });
    const subject = agentSnapshotToSubject(transferred);
    expect(subject.observations.filter((o) => o.dimension === "counterparty_satisfaction")).toHaveLength(0);
  });

  it("emits no availability evidence, because a snapshot holds none", () => {
    const subject = agentSnapshotToSubject(NEUTRAL_SNAPSHOT);
    expect(subject.observations.some((o) => o.dimension === "availability")).toBe(false);
    const { result } = scoreSubject(subject);
    const availability = result.dimensions.find((d) => d.dimension === "availability")!;
    expect(availability.score).toBeNull();
    expect(availability.suppression_reason).toMatch(/no observations/);
    // Declaring an endpoint is reachability, and it is reported as that.
    expect(subject.reachable).toBe(true);
  });

  it("maps a shared funder to a shared independence group", () => {
    const clustered = makeSnapshot({
      ...NEUTRAL_SNAPSHOT,
      reviewers: Object.fromEntries(
        Object.entries(NEUTRAL_SNAPSHOT.reviewers).map(([k, r]) => [
          k,
          { ...r, funder_address: "0x00000000000000000000000000000000000000ff" as ReviewerSnapshot["address"] },
        ]),
      ),
    });
    const subject = agentSnapshotToSubject(clustered);
    for (const o of Object.values(subject.observers)) {
      if (o.observer_kind !== "reviewer") continue;
      expect(o.independence_group).toBe("0x00000000000000000000000000000000000000ff");
    }
    const clusteredScore = scoreSubject(subject).result;
    const cleanScore = scoreSubject(agentSnapshotToSubject(NEUTRAL_SNAPSHOT)).result;
    const nEff = (r: typeof cleanScore): number =>
      r.dimensions.find((d) => d.dimension === "counterparty_satisfaction")!.n_eff;
    expect(nEff(clusteredScore)).toBeLessThan(nEff(cleanScore));
  });

  it("carries the shared constants across so a comparison is of methodology, not settings", () => {
    const c = ratingConstantsFromMethodology(NEUTRAL_SNAPSHOT);
    expect(c.shrinkage_k).toBe(DEFAULT_CONSTANTS.shrinkage_k.value);
    expect(c.decay_half_life_days).toBe(DEFAULT_CONSTANTS.decay_half_life_days.value);
    expect(c.age_ramp_days).toBe(DEFAULT_CONSTANTS.weight.age_ramp_days.value);
    expect(c.age_floor).toBe(DEFAULT_CONSTANTS.weight.age_floor.value);
    expect(c.weight_floor).toBe(DEFAULT_CONSTANTS.weight.weight_floor.value);
    expect(c.suppression_neff_floor).toBe(DEFAULT_CONSTANTS.suppression_neff_floor.value);
  });

  it("turns settlement records into measured delivery evidence", () => {
    const withCommerce = makeSnapshot({
      ...NEUTRAL_SNAPSHOT,
      commerce: [
        { counterparty: ADDRESSES[0], outcome: "completed", ts: "2026-06-10T00:00:00Z", block: 550 },
        { counterparty: ADDRESSES[1], outcome: "rejected", ts: "2026-06-11T00:00:00Z", block: 551 },
        { counterparty: ADDRESSES[2], outcome: "completed", ts: "2026-06-12T00:00:00Z", block: 552 },
      ],
    });
    const subject = agentSnapshotToSubject(withCommerce);
    const delivery = subject.observations.filter((o) => o.dimension === "delivery");
    expect(delivery).toHaveLength(3);
    expect(delivery.every((o) => o.provenance === "measured")).toBe(true);
    const { result } = scoreSubject(subject);
    expect(result.dimensions.find((d) => d.dimension === "delivery")!.score).not.toBeNull();
  });

  it("rates identity integrity from three separate measurements by one observer", () => {
    const subject = agentSnapshotToSubject(NEUTRAL_SNAPSHOT);
    const integrity = subject.observations.filter((o) => o.dimension === "identity_integrity");
    expect(integrity).toHaveLength(3);
    expect(new Set(integrity.map((o) => o.observer_id)).size).toBe(1);
    // Three checks by one party are not three independent voices: the
    // per-observer cap holds them to one observer's weight.
    const { result } = scoreSubject(subject);
    const d = result.dimensions.find((x) => x.dimension === "identity_integrity")!;
    expect(d.observation_count).toBe(3);
    expect(d.distinct_observers).toBe(1);
    expect(d.n_eff).toBeLessThanOrEqual(1);
  });
});
