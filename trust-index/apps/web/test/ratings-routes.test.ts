/**
 * The compendium endpoints, exercised through the handlers.
 *
 * These run against whichever source getRatingsSource() picks, which with no
 * DATABASE_URL set is the committed fixture — so they pass with zero
 * infrastructure and pass again, unchanged, against the live store.
 *
 * What they check is the part a contract test on the source cannot: that the
 * invariants survive JSON serialization and the envelope. A withheld rating
 * that loses its reason on the way through `Response.json` is exactly as broken
 * as one that never had it.
 */
import { describe, expect, it } from "vitest";
import { GET as getKinds } from "@/app/api/v1/subjects/route";
import { GET as listSubjects } from "@/app/api/v1/subjects/[kind]/route";
import { GET as getSubject } from "@/app/api/v1/subjects/[kind]/[registry]/[...subject_id]/route";
import { GET as getSeries } from "@/app/api/v1/series/[kind]/[registry]/[...subject_id]/route";
import { GET as getRatingsHealth } from "@/app/api/v1/ratings/health/route";

const DAY = "2026-09-06";
const KIND = "mcp_server";
const REGISTRY = "mcp-registry";
/** Contains a slash, which is the point: real registry ids do. */
const WITHHELD_ID = ["ae.propick", "propick"];
const SCORED_ID = ["ai.name", "nameai-mcp"];

let ip = 0;
function req(url: string): Request {
  ip += 1;
  return new Request(url, { headers: { "x-real-ip": `10.9.0.${ip % 250}` } });
}

const params = (kind: string, registry: string, subject_id: string[]) =>
  Promise.resolve({ kind, registry, subject_id });

describe("GET /api/v1/subjects", () => {
  it("reports what is rated", async () => {
    const res = await getKinds(req("http://x/api/v1/subjects"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.kinds.some((k: { kind: string }) => k.kind === KIND)).toBe(true);
    expect(["postgres", "fixture"]).toContain(body.meta.served_from);
  });
});

describe("GET /api/v1/subjects/:kind", () => {
  it("returns a page with both coverage numbers on every row", async () => {
    const res = await listSubjects(req(`http://x/api/v1/subjects/${KIND}?through_day=${DAY}&limit=5`), {
      params: Promise.resolve({ kind: KIND }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.items.length).toBeGreaterThan(0);
    for (const item of body.data.items) {
      expect(item.coverage).toHaveProperty("dimension_coverage");
      expect(item.coverage).toHaveProperty("assessment_completeness");
    }
    // The note that keeps the two apart rides on every response carrying them.
    expect(body.meta.disclaimers.join(" ")).toContain("must not be combined");
  });

  it("filters to withheld without losing the denominator", async () => {
    const res = await listSubjects(
      req(`http://x/api/v1/subjects/${KIND}?through_day=${DAY}&state=withheld&limit=50`),
      { params: Promise.resolve({ kind: KIND }) },
    );
    const body = await res.json();
    expect(body.data.total).toBeGreaterThan(0);
    expect(body.data.total_unfiltered).toBeGreaterThanOrEqual(body.data.total);
    for (const item of body.data.items) {
      expect(item.rating.state).toBe("withheld");
      expect(item.rating).not.toHaveProperty("composite");
    }
  });

  it("404s a kind nobody rates, and 200s a filter that matches nothing", async () => {
    const missing = await listSubjects(req("http://x/api/v1/subjects/no_such_kind"), {
      params: Promise.resolve({ kind: "no_such_kind" }),
    });
    expect(missing.status).toBe(404);

    const empty = await listSubjects(
      req(`http://x/api/v1/subjects/${KIND}?through_day=1999-01-01&state=scored`),
      { params: Promise.resolve({ kind: KIND }) },
    );
    // Either the kind has no rows in that window (404) or it has rows and the
    // filter emptied the page (200 with total 0). Both are honest; what must
    // not happen is a 200 carrying invented rows.
    if (empty.status === 200) expect((await empty.json()).data.items).toEqual([]);
    else expect(empty.status).toBe(404);
  });
});

describe("GET /api/v1/subjects/:kind/:registry/:subject_id", () => {
  it("serves a subject id containing a slash", async () => {
    const res = await getSubject(
      req(`http://x/api/v1/subjects/${KIND}/${REGISTRY}/${WITHHELD_ID.join("/")}?through_day=${DAY}`),
      { params: params(KIND, REGISTRY, WITHHELD_ID) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.ref.subject_id).toBe(WITHHELD_ID.join("/"));
  });

  it("survives JSON with the withheld rating still withheld and still explained", async () => {
    const res = await getSubject(
      req(`http://x/api/v1/subjects/${KIND}/${REGISTRY}/${WITHHELD_ID.join("/")}?through_day=${DAY}`),
      { params: params(KIND, REGISTRY, WITHHELD_ID) },
    );
    const body = await res.json();
    expect(body.data.rating.state).toBe("withheld");
    expect(body.data.rating).not.toHaveProperty("composite");
    expect(body.data.rating.suppression_reason).toBeTruthy();
    expect(body.data.harness_gaps.length).toBeGreaterThan(0);
    // The envelope says whose fault it is, in words, on the payload itself.
    expect(body.meta.disclaimers.join(" ")).toContain("OUR harness");
  });

  it("serves a scored subject with its dimensions and an unmerged coverage pair", async () => {
    const res = await getSubject(
      req(`http://x/api/v1/subjects/${KIND}/${REGISTRY}/${SCORED_ID.join("/")}?through_day=${DAY}`),
      { params: params(KIND, REGISTRY, SCORED_ID) },
    );
    const body = await res.json();
    expect(body.data.rating.state).toBe("scored");
    expect(typeof body.data.rating.composite).toBe("string");
    expect(body.data.dimensions.length).toBeGreaterThan(0);
    expect(Object.keys(body.data.coverage).sort()).toEqual([
      "assessment_completeness",
      "dimension_coverage",
    ]);
  });

  it("400s a request with no subject id and 404s one we do not have", async () => {
    const bad = await getSubject(req(`http://x/api/v1/subjects/${KIND}/${REGISTRY}/`), {
      params: params(KIND, REGISTRY, []),
    });
    expect(bad.status).toBe(400);

    const missing = await getSubject(req(`http://x/api/v1/subjects/${KIND}/${REGISTRY}/nope/nope`), {
      params: params(KIND, REGISTRY, ["nope", "nope"]),
    });
    expect(missing.status).toBe(404);
  });
});

describe("GET /api/v1/series/:kind/:registry/:subject_id", () => {
  it("serves a dense series with the four states counted", async () => {
    const res = await getSeries(
      req(
        `http://x/api/v1/series/${KIND}/${REGISTRY}/${WITHHELD_ID.join("/")}?through_day=${DAY}&collector=mcp`,
      ),
      { params: params(KIND, REGISTRY, WITHHELD_ID) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.days.length).toBe(30);
    const counts = body.data.day_state_counts;
    expect(Object.values(counts).reduce((a: number, b) => a + (b as number), 0)).toBe(30);
    expect(counts.not_run).toBeGreaterThan(0);
    // The instruction not to interpolate travels with the data.
    expect(body.meta.disclaimers.join(" ")).toContain("Do not interpolate");
  });

  it("gives no day a composite unless it scored", async () => {
    const res = await getSeries(
      req(
        `http://x/api/v1/series/${KIND}/${REGISTRY}/${WITHHELD_ID.join("/")}?through_day=${DAY}&collector=mcp`,
      ),
      { params: params(KIND, REGISTRY, WITHHELD_ID) },
    );
    const body = await res.json();
    for (const d of body.data.days) {
      if (d.state === "scored") expect(d).toHaveProperty("composite");
      else expect(d).not.toHaveProperty("composite");
    }
  });
});

describe("GET /api/v1/ratings/health", () => {
  it("publishes the run ledger behind the not_run days", async () => {
    const res = await getRatingsHealth(req("http://x/api/v1/ratings/health"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data.runs)).toBe(true);
    expect(body.data.latest_stored_day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
