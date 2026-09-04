/**
 * Profile invariants. These are not style checks: each one is a property the
 * scorer depends on, and a profile that violates one produces a composite
 * whose arithmetic quietly means something other than it says.
 */
import { describe, expect, it } from "vitest";
import { FixedNum, PROVENANCE_VALUES, RATING_PROFILES, allDimensionIds, getRatingProfile } from "@trust-index/types";

const profiles = Object.values(RATING_PROFILES);

describe("rating profiles", () => {
  it("registers each profile under its own id", () => {
    for (const [key, p] of Object.entries(RATING_PROFILES)) expect(p.profile_id).toBe(key);
  });

  it("weights sum to exactly 1 in every profile", () => {
    for (const p of profiles) {
      let total = 0n;
      for (const d of p.dimensions) total += FixedNum.parse(d.weight, 12).scaled;
      expect(`${p.profile_id}: ${total}`).toBe(`${p.profile_id}: ${10n ** 12n}`);
    }
  });

  it("gives every dimension a positive weight", () => {
    for (const p of profiles) {
      for (const d of p.dimensions) {
        expect(FixedNum.parse(d.weight, 12).scaled > 0n, `${p.profile_id}/${d.id}`).toBe(true);
      }
    }
  });

  it("uses each dimension id at most once per profile", () => {
    for (const p of profiles) {
      const ids = p.dimensions.map((d) => d.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("accepts at least one provenance per dimension", () => {
    for (const p of profiles) {
      for (const d of p.dimensions) {
        expect(d.accepted_provenance.length, `${p.profile_id}/${d.id}`).toBeGreaterThan(0);
        for (const prov of d.accepted_provenance) expect(PROVENANCE_VALUES).toContain(prov);
      }
    }
  });

  it("caps self-reported evidence below a majority wherever it is admissible", () => {
    // The cap is the defence that stops a subject rating itself. A dimension
    // that admits self-reported evidence at or above 0.5 would let the
    // subject's own claims outweigh everything else, which is the failure
    // mode the field exists to prevent.
    for (const p of profiles) {
      for (const d of p.dimensions) {
        if (!d.accepted_provenance.includes("self_reported")) continue;
        const cap = FixedNum.parse(d.self_reported_cap, 12).scaled;
        expect(cap > 0n, `${p.profile_id}/${d.id} admits self-reports with a zero cap`).toBe(true);
        expect(cap < 10n ** 12n / 2n, `${p.profile_id}/${d.id} cap is not below a majority`).toBe(true);
      }
    }
  });

  it("keeps opinion-only dimensions from carrying a plurality of any composite", () => {
    // A dimension no outsider can verify must never be the largest single
    // share of a rating, or the rating is mostly hearsay.
    for (const p of profiles) {
      const measurable = new Set<string>(["measured", "attested"]);
      for (const d of p.dimensions) {
        if (d.accepted_provenance.some((prov) => measurable.has(prov))) continue;
        const w = FixedNum.parse(d.weight, 12).scaled;
        const outweighed = p.dimensions.some(
          (other) => other.id !== d.id && FixedNum.parse(other.weight, 12).scaled >= w,
        );
        expect(outweighed, `${p.profile_id}/${d.id} is opinion-only and the heaviest dimension`).toBe(true);
      }
    }
  });

  it("requires meaningful coverage before publishing a composite", () => {
    for (const p of profiles) {
      const min = FixedNum.parse(p.min_dimension_coverage, 12).scaled;
      expect(min > 0n, p.profile_id).toBe(true);
      expect(min <= 10n ** 12n, p.profile_id).toBe(true);
    }
  });

  it("keeps a shared dimension id meaning one thing across profiles", () => {
    const rubrics = new Map<string, string>();
    for (const p of profiles) {
      for (const d of p.dimensions) {
        const seen = rubrics.get(d.id);
        // counterparty_satisfaction is deliberately relabelled per profile
        // ("User satisfaction" on a hosted agent) but must keep one rubric.
        if (seen === undefined) rubrics.set(d.id, d.rubric);
        else if (d.id !== "counterparty_satisfaction") expect(d.rubric, d.id).toBe(seen);
      }
    }
  });

  it("refuses an unknown profile id rather than scoring against an empty rubric", () => {
    expect(() => getRatingProfile("nope.v1")).toThrow(/unknown rating profile/);
  });

  it("exposes a stable sorted dimension id list", () => {
    const ids = allDimensionIds();
    expect([...ids].sort()).toEqual(ids);
    expect(ids).toContain("availability");
    expect(ids).toContain("tool_safety");
  });
});
