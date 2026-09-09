/**
 * One contract, two sources.
 *
 * Every test in `contract()` runs against FixtureRatingsSource and, when
 * TRUST_INDEX_TEST_DB_URL or DATABASE_URL points at a populated store, against
 * PostgresRatingsSource as well. That is what "drop-in compatible" has to mean:
 * not that the two classes implement the same TypeScript interface — the
 * compiler already checks that, and it would not have caught a fixture source
 * that sorted nulls first — but that they answer the same questions the same
 * way.
 *
 * The invariant tests are the point of the file. Each one corresponds to a way
 * this product could quietly start lying:
 *   - a withheld rating served as a zero
 *   - a withheld rating dropped from a listing
 *   - coverage and completeness collapsed into one number
 *   - a series that omits the days nothing ran
 *   - an absent bound filled in with a default
 */
import { afterAll, describe, expect, it } from "vitest";
import { FixtureRatingsSource } from "@/lib/fixture-ratings-source";
import { PostgresRatingsSource, closeRatingsPool } from "@/lib/postgres-ratings-source";
import type { RatingsSource, SubjectRef, SubjectSnapshot } from "@/lib/ratings-source";

const DB_URL = process.env["TRUST_INDEX_TEST_DB_URL"] ?? process.env["DATABASE_URL"] ?? "";

/**
 * The day the committed fixture covers. Both sources are pinned to it, because
 * a contract suite whose two halves look at different days is comparing
 * nothing. The Postgres half reads the same day out of the live store.
 */
const DAY = "2026-09-06";
const KIND = "mcp_server";
const REGISTRY = "mcp-registry";

/** Subjects the fixture carries, chosen to cover every state. */
const SCORED: SubjectRef = { kind: KIND, source_registry: REGISTRY, subject_id: "ai.name/nameai-mcp" };
/** Withheld, a gate fired, and three harness gaps. */
const WITHHELD_GATED: SubjectRef = { kind: KIND, source_registry: REGISTRY, subject_id: "ai.aislabs/recorder" };
/** The case the whole schema exists for: coverage 1.00, completeness 0.13. */
const WITHHELD_INCOMPLETE: SubjectRef = { kind: KIND, source_registry: REGISTRY, subject_id: "ae.propick/propick" };

afterAll(async () => {
  await closeRatingsPool();
});

function contract(name: string, make: () => RatingsSource): void {
  describe(name, () => {
    const src = make();

    it("serves a withheld rating with no composite field at all", async () => {
      const d = await src.getSubject(WITHHELD_INCOMPLETE, { through_day: DAY });
      expect(d).not.toBeNull();
      expect(d!.rating.state).toBe("withheld");
      // Not "composite is null" — the key is absent, so nothing downstream can
      // reach for it, coerce it, or render it as 0.
      expect("composite" in d!.rating).toBe(false);
      expect(JSON.stringify(d!.rating)).not.toContain('"composite"');
    });

    it("keeps the withheld reason all the way to the reader", async () => {
      const d = await src.getSubject(WITHHELD_INCOMPLETE, { through_day: DAY });
      const rating = d!.rating;
      expect(rating.state === "withheld" && rating.suppression_reason).toBe(
        "too little of the profile could be assessed at all; see harness_gaps",
      );
    });

    it("serves coverage and completeness together, unmerged and distinct", async () => {
      const d = await src.getSubject(WITHHELD_INCOMPLETE, { through_day: DAY });
      // The relationship, not the constants: this subject is the case where
      // everything we could reach passed and we could reach a fraction of the
      // profile. Coverage is full, completeness is not, and the two are
      // different numbers. Pinning the exact values in the shared contract
      // would make it fail whenever the engine is retuned, which changes what
      // the numbers ARE and not whether they may be merged. The frozen fixture
      // carries the literals; see the block after the contract.
      expect(Number(d!.coverage.dimension_coverage)).toBe(1);
      expect(Number(d!.coverage.assessment_completeness)).toBeLessThan(1);
      expect(d!.coverage.dimension_coverage).not.toBe(d!.coverage.assessment_completeness);
      // Both are exact decimals, not floats that happen to print.
      expect(d!.coverage.dimension_coverage).toMatch(/^\d\.\d+$/);
      expect(d!.coverage.assessment_completeness).toMatch(/^\d\.\d+$/);
    });

    it("attributes the shortfall to our harness, with the capability each check needed", async () => {
      const d = await src.getSubject(WITHHELD_INCOMPLETE, { through_day: DAY });
      expect(d!.harness_gaps.length).toBeGreaterThan(0);
      for (const g of d!.harness_gaps) {
        expect(g.dimension).toBeTruthy();
        expect(g.check).toBeTruthy();
        expect(g.detail).toBeTruthy();
      }
    });

    it("serves gates that fired even when the composite was withheld anyway", async () => {
      const d = await src.getSubject(WITHHELD_GATED, { through_day: DAY });
      expect(d!.rating.state).toBe("withheld");
      expect(d!.gates_fired.length).toBeGreaterThan(0);
      expect(d!.gates_fired[0]!.gate_id).toBeTruthy();
      expect(d!.gates_fired[0]!.reason).toBeTruthy();
    });

    it("serves a scored rating as an exact decimal string, not a float", async () => {
      const d = await src.getSubject(SCORED, { through_day: DAY });
      const rating = d!.rating;
      expect(rating.state).toBe("scored");
      if (rating.state !== "scored") throw new Error("unreachable");
      expect(typeof rating.composite).toBe("string");
      expect(rating.composite).toMatch(/^\d+\.\d{2}$/);
    });

    it("gives a withheld dimension no score field either", async () => {
      const d = await src.getSubject(WITHHELD_INCOMPLETE, { through_day: DAY });
      const withheld = d!.dimensions.filter((x) => x.state === "withheld");
      expect(withheld.length).toBeGreaterThan(0);
      for (const dim of withheld) {
        expect("score" in dim).toBe(false);
        // The evidence counters survive: "we looked and found nothing
        // admissible" is a different statement from "we did not look".
        expect(typeof dim.n_eff).toBe("string");
        expect(typeof dim.observation_count).toBe("number");
      }
    });

    it("lists withheld subjects rather than hiding them", async () => {
      const all = await src.listSubjects({ kind: KIND, through_day: DAY, limit: 100 });
      const withheld = await src.listSubjects({
        kind: KIND,
        through_day: DAY,
        state: "withheld",
        limit: 100,
      });
      const scored = await src.listSubjects({ kind: KIND, through_day: DAY, state: "scored", limit: 100 });
      expect(withheld.total).toBeGreaterThan(0);
      expect(withheld.total + scored.total).toBe(all.total);
      expect(withheld.total_unfiltered).toBe(all.total);
    });

    it("sorts withheld ratings last, not lowest", async () => {
      const page = await src.listSubjects({
        kind: KIND,
        through_day: DAY,
        order: "composite_asc",
        limit: 100,
      });
      const states = page.items.map((s) => s.rating.state);
      const firstWithheld = states.indexOf("withheld");
      // Ascending by composite: if null sorted as a low number, withheld rows
      // would lead. NULLS LAST means they trail in both directions.
      if (firstWithheld !== -1) {
        expect(states.slice(firstWithheld).every((s) => s === "withheld")).toBe(true);
      }
    });

    it("paginates without repeating or skipping a subject", async () => {
      const first = await src.listSubjects({ kind: KIND, through_day: DAY, limit: 2 });
      expect(first.items.length).toBe(2);
      expect(first.next_cursor).not.toBeNull();
      const second = await src.listSubjects({
        kind: KIND,
        through_day: DAY,
        limit: 2,
        cursor: first.next_cursor,
      });
      const ids = (p: { items: SubjectSnapshot[] }) => p.items.map((s) => s.ref.subject_id);
      expect(new Set([...ids(first), ...ids(second)]).size).toBe(ids(first).length + ids(second).length);
    });

    it("carries coverage on every listing row, both numbers", async () => {
      const page = await src.listSubjects({ kind: KIND, through_day: DAY, limit: 25 });
      for (const s of page.items) {
        expect(typeof s.coverage.dimension_coverage).toBe("string");
        expect(typeof s.coverage.assessment_completeness).toBe("string");
        expect(s.utc_day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    });

    it("returns a dense series with every day present", async () => {
      const s = await src.getSubjectSeries(WITHHELD_INCOMPLETE, { through_day: DAY, collector: "mcp" });
      expect(s).not.toBeNull();
      expect(s!.days.length).toBe(30);
      expect(s!.days[s!.days.length - 1]!.utc_day).toBe(DAY);
      // Consecutive, oldest first, no holes in the array.
      for (let i = 1; i < s!.days.length; i += 1) {
        const prev = new Date(`${s!.days[i - 1]!.utc_day}T00:00:00Z`).getTime();
        const cur = new Date(`${s!.days[i]!.utc_day}T00:00:00Z`).getTime();
        expect(cur - prev).toBe(86_400_000);
      }
    });

    it("distinguishes not_run from not_assessed from withheld", async () => {
      const s = await src.getSubjectSeries(WITHHELD_INCOMPLETE, { through_day: DAY, collector: "mcp" });
      const states = new Set(s!.days.map((d) => d.state));
      expect(states.has("not_run")).toBe(true);
      expect(states.has("withheld")).toBe(true);
      // Only scored days carry a composite. A day the collector never ran must
      // not be plottable as a value of any kind.
      for (const d of s!.days) {
        if (d.state === "scored") expect(typeof d.composite).toBe("string");
        else expect("composite" in d).toBe(false);
      }
    });

    it("gives non-scored days no coverage numbers to misread", async () => {
      const s = await src.getSubjectSeries(WITHHELD_INCOMPLETE, { through_day: DAY, collector: "mcp" });
      for (const d of s!.days) {
        if (d.state === "not_run" || d.state === "not_assessed") {
          expect("coverage" in d).toBe(false);
          expect("observation_count" in d).toBe(false);
        } else {
          expect(d.coverage.dimension_coverage).toBeTruthy();
          expect(d.coverage.assessment_completeness).toBeTruthy();
        }
      }
    });

    it("returns null rather than an empty chart for a subject it does not have", async () => {
      const missing: SubjectRef = { kind: KIND, source_registry: REGISTRY, subject_id: "nope/not-a-server" };
      expect(await src.getSubject(missing, { through_day: DAY })).toBeNull();
      expect(await src.getSubjectSeries(missing, { through_day: DAY })).toBeNull();
    });

    it("reports what it rates, and the run ledger behind the day-states", async () => {
      const kinds = await src.listKinds();
      expect(kinds.some((k) => k.kind === KIND && k.source_registry === REGISTRY)).toBe(true);
      const health = await src.getHealth();
      expect(health.latest_stored_day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Array.isArray(health.runs)).toBe(true);
    });
  });
}

contract("FixtureRatingsSource", () => new FixtureRatingsSource());

/**
 * The committed sample is frozen, so it can carry the exact numbers the shared
 * contract deliberately does not. This is the case the whole schema exists for,
 * written down as a literal: full coverage of what we could assess, thirteen
 * percent of the profile attempted.
 */
describe("the coverage/completeness case, exactly", () => {
  it("keeps 1.0000 and 0.1300 apart", async () => {
    const d = await new FixtureRatingsSource().getSubject(WITHHELD_INCOMPLETE, { through_day: DAY });
    expect(d!.coverage).toEqual({ dimension_coverage: "1.0000", assessment_completeness: "0.1300" });
  });
});

// Skips loudly rather than silently: the name says which half of the contract
// did not run, so a green suite on a machine with no database cannot be
// mistaken for a green suite with one.
if (DB_URL === "") {
  describe.skip("PostgresRatingsSource (needs TRUST_INDEX_TEST_DB_URL or DATABASE_URL)", () => {
    it("skipped", () => undefined);
  });
} else {
  contract("PostgresRatingsSource", () => new PostgresRatingsSource(DB_URL));
}
