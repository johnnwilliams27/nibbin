/**
 * The generic rating engine. Most of these are the gameability defences: the
 * cheapest way to make a ratings source worthless is to let the rated thing
 * move its own number, so the tests that matter here are the ones that try.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_RATING_CONSTANTS, type Observation, type Subject } from "@trust-index/types";
import { scoreSubject } from "../src/rating/index.js";
import { subjectInputsCanonical, subjectInputsHash } from "../src/rating/hash.js";
import { makeObservation, makeObserver, makeSubject } from "./rating-helpers.js";

function dim(result: ReturnType<typeof scoreSubject>["result"], id: string) {
  const d = result.dimensions.find((x) => x.dimension === id);
  if (d === undefined) throw new Error(`no dimension ${id}`);
  return d;
}

/** A subject with enough measured evidence to publish availability and conformance. */
function probedServer(overrides: Partial<Subject> = {}): Subject {
  const observations: Observation[] = [];
  for (let i = 0; i < 6; i += 1) {
    observations.push(
      makeObservation({
        observer_id: "probe:harness",
        dimension: "availability",
        value: "1.000000",
        observation_key: `avail-${i}`,
        ts: "2026-07-01T00:00:00Z",
      }),
    );
    observations.push(
      makeObservation({
        observer_id: "probe:harness",
        dimension: "protocol_conformance",
        value: "0.900000",
        observation_key: `conf-${i}`,
        ts: "2026-07-01T00:00:00Z",
      }),
    );
    observations.push(
      makeObservation({
        observer_id: "probe:harness",
        dimension: "tool_safety",
        value: "1.000000",
        observation_key: `safe-${i}`,
        ts: "2026-07-01T00:00:00Z",
      }),
    );
  }
  return makeSubject({
    observations,
    observers: {
      "probe:harness": makeObserver({
        observer_id: "probe:harness",
        observer_kind: "probe",
        first_seen_ts: "2024-01-01T00:00:00Z",
      }),
    },
    ...overrides,
  });
}

describe("scoreSubject", () => {
  it("returns bytes that parse to exactly the result", () => {
    const { result, canonicalBytes } = scoreSubject(probedServer());
    expect(JSON.parse(canonicalBytes)).toEqual(result);
  });

  it("is deterministic under observation reordering", () => {
    const s = probedServer();
    const a = scoreSubject(s).canonicalBytes;
    const b = scoreSubject({ ...s, observations: [...s.observations].reverse() }).canonicalBytes;
    expect(b).toBe(a);
  });

  it("publishes a composite once enough dimension weight has scores", () => {
    const { result } = scoreSubject(probedServer());
    expect(result.composite).not.toBeNull();
    expect(result.composite_suppression_reason).toBeNull();
    // availability + protocol_conformance + tool_safety = 0.75 of the profile.
    expect(result.dimension_coverage).toBe(0.75);
    expect(dim(result, "documentation").score).toBeNull();
    expect(dim(result, "maintenance").score).toBeNull();
  });

  it("withholds the composite when too little of the profile is evidenced", () => {
    // Availability alone is 0.25 of mcp_server.v1, under its 0.60 floor.
    const s = probedServer({
      observations: probedServer().observations.filter((o) => o.dimension === "availability"),
    });
    const { result } = scoreSubject(s);
    expect(dim(result, "availability").score).not.toBeNull();
    expect(result.composite).toBeNull();
    expect(result.composite_suppression_reason).toMatch(/too little of the profile/);
  });

  it("bounds the composite by its widest published dimension", () => {
    // The composite assumes perfect correlation, so its interval is the
    // weighted mean of the dimension intervals and can never be narrower than
    // the narrowest one nor wider than the widest.
    const { result } = scoreSubject(probedServer());
    const published = result.dimensions.filter((d) => d.score !== null);
    const widths = published.map((d) => d.score_high! - d.score_low!);
    const compositeWidth = result.composite_high! - result.composite_low!;
    expect(compositeWidth).toBeGreaterThanOrEqual(Math.min(...widths) - 0.01);
    expect(compositeWidth).toBeLessThanOrEqual(Math.max(...widths) + 0.01);
  });
});

describe("gameability defences", () => {
  it("drops evidence a dimension does not accept, and says how much", () => {
    const s = probedServer({
      observations: [
        ...probedServer().observations,
        // Reviews are inadmissible on a measured-only dimension, however many.
        ...Array.from({ length: 50 }, (_, i) =>
          makeObservation({
            observer_id: `shill-${i}`,
            dimension: "availability",
            provenance: "third_party_review",
            value: "1.000000",
            observation_key: `r-${i}`,
          }),
        ),
      ],
    });
    const { result } = scoreSubject(s);
    expect(dim(result, "availability").rejected_provenance_count).toBe(50);
    // n_eff is unchanged: the reviews contributed nothing at all.
    const clean = scoreSubject(probedServer()).result;
    expect(dim(result, "availability").n_eff).toBe(dim(clean, "availability").n_eff);
  });

  it("caps self-reported evidence at its dimension's share", () => {
    const base = probedServer();
    const withDocs = makeSubject({
      observations: [
        ...base.observations,
        makeObservation({
          observer_id: "probe:harness",
          dimension: "documentation",
          provenance: "measured",
          value: "0.400000",
          observation_key: "doc-measured",
        }),
        // The subject insisting, at length, that its documentation is perfect.
        ...Array.from({ length: 100 }, (_, i) =>
          makeObservation({
            observer_id: "publisher:self",
            dimension: "documentation",
            provenance: "self_reported",
            value: "1.000000",
            observation_key: `self-${i}`,
          }),
        ),
      ],
      observers: {
        ...base.observers,
        "publisher:self": makeObserver({
          observer_id: "publisher:self",
          observer_kind: "publisher",
          first_seen_ts: "2020-01-01T00:00:00Z",
        }),
      },
    });
    const { result } = scoreSubject(withDocs);
    const doc = dim(result, "documentation");
    expect(doc.self_reported_capped).toBe(true);
    // The cap on documentation is 0.40; the reported share sits at it.
    expect(doc.self_reported_share).toBeLessThanOrEqual(0.4001);
    expect(doc.self_reported_share).toBeGreaterThan(0.39);
    // And the score stays nearer the measurement than the claim.
    expect(doc.score!).toBeLessThan(75);
  });

  it("gives self-reported evidence no share at all when nothing else is present", () => {
    // With no independent evidence there is no share a self-report can hold
    // without being the whole score, so it holds none and the dimension is
    // suppressed rather than published at the subject's own number.
    const base = probedServer();
    const s = makeSubject({
      observations: [
        ...base.observations,
        ...Array.from({ length: 20 }, (_, i) =>
          makeObservation({
            observer_id: "publisher:self",
            dimension: "documentation",
            provenance: "self_reported",
            value: "1.000000",
            observation_key: `self-${i}`,
          }),
        ),
      ],
      observers: {
        ...base.observers,
        "publisher:self": makeObserver({ observer_id: "publisher:self", observer_kind: "publisher" }),
      },
    });
    const doc = dim(scoreSubject(s).result, "documentation");
    expect(doc.observation_count).toBe(20);
    expect(doc.score).toBeNull();
    expect(doc.suppression_reason).toMatch(/n_eff below/);
  });

  it("dilutes observers that share an independence group", () => {
    const reviews = (group: string | null): Subject =>
      makeSubject({
        kind: "hosted_agent",
        profile_id: "hosted_agent.v1",
        observations: Array.from({ length: 8 }, (_, i) =>
          makeObservation({
            observer_id: `r-${i}`,
            dimension: "counterparty_satisfaction",
            provenance: "third_party_review",
            value: "1.000000",
            observation_key: "1",
          }),
        ),
        observers: Object.fromEntries(
          Array.from({ length: 8 }, (_, i) => [
            `r-${i}`,
            makeObserver({
              observer_id: `r-${i}`,
              first_seen_ts: "2024-01-01T00:00:00Z",
              independence_group: group,
            }),
          ]),
        ),
      });
    const clustered = dim(scoreSubject(reviews("farm-1")).result, "counterparty_satisfaction");
    const independent = dim(scoreSubject(reviews(null)).result, "counterparty_satisfaction");
    expect(clustered.n_eff).toBeLessThan(independent.n_eff);
    expect(clustered.score!).toBeLessThan(independent.score!);
  });

  it("stops one observer outvoting the rest by volume", () => {
    const many = (n: number): Subject =>
      makeSubject({
        kind: "hosted_agent",
        profile_id: "hosted_agent.v1",
        observations: Array.from({ length: n }, (_, i) =>
          makeObservation({
            observer_id: "loud",
            dimension: "counterparty_satisfaction",
            provenance: "third_party_review",
            value: "1.000000",
            observation_key: `k-${i}`,
          }),
        ),
        observers: {
          loud: makeObserver({ observer_id: "loud", first_seen_ts: "2024-01-01T00:00:00Z" }),
        },
      });
    const one = dim(scoreSubject(many(1)).result, "counterparty_satisfaction");
    const forty = dim(scoreSubject(many(40)).result, "counterparty_satisfaction");
    expect(forty.observation_count).toBe(40);
    expect(forty.n_eff).toBeCloseTo(one.n_eff, 2);
  });

  it("counts repeated measurements on separate days but not within one day", () => {
    // The rule the MCP collector forced into existence. Ten probes on ten
    // days are ten samples of whether an endpoint answers; ten probes in one
    // minute are one. Without the day bucket every measured dimension would
    // sit at one observer's weight and shrink to the prior.
    const probeDays = (days: number, perDay: number): Subject =>
      makeSubject({
        observations: Array.from({ length: days * perDay }, (_, i) =>
          makeObservation({
            observer_id: "probe:harness",
            dimension: "availability",
            value: "1.000000",
            observation_key: `a-${i}`,
            ts: `2026-06-${String(1 + Math.floor(i / perDay)).padStart(2, "0")}T00:00:00Z`,
          }),
        ),
        observers: {
          "probe:harness": makeObserver({
            observer_id: "probe:harness",
            observer_kind: "probe",
            first_seen_ts: "2024-01-01T00:00:00Z",
          }),
        },
      });
    const oneDay = dim(scoreSubject(probeDays(1, 10)).result, "availability");
    const tenDays = dim(scoreSubject(probeDays(10, 1)).result, "availability");
    const tenDaysBusy = dim(scoreSubject(probeDays(10, 10)).result, "availability");

    expect(oneDay.observation_count).toBe(10);
    expect(oneDay.n_eff).toBeLessThanOrEqual(1);
    expect(tenDays.n_eff).toBeGreaterThan(5);
    // Looping inside a day buys nothing: ten days is ten days either way.
    expect(tenDaysBusy.n_eff).toBeCloseTo(tenDays.n_eff, 1);
    // And more evidence means a narrower interval and a higher confidence.
    expect(tenDays.confidence).toBeGreaterThan(oneDay.confidence);
  });

  it("keeps opinions capped per observer, with no day bucket", () => {
    // The same volume that buys a probe ten samples must buy a reviewer one
    // voice, or the anti-flooding rule is gone.
    const spread = (days: number): Subject =>
      makeSubject({
        kind: "hosted_agent",
        profile_id: "hosted_agent.v1",
        observations: Array.from({ length: days }, (_, i) =>
          makeObservation({
            observer_id: "loud",
            dimension: "counterparty_satisfaction",
            provenance: "third_party_review",
            value: "1.000000",
            observation_key: `k-${i}`,
            ts: `2026-06-${String(1 + i).padStart(2, "0")}T00:00:00Z`,
          }),
        ),
        observers: { loud: makeObserver({ observer_id: "loud", first_seen_ts: "2024-01-01T00:00:00Z" }) },
      });
    // Compared against a single review dated on the same last day, since the
    // per-observer ceiling is the reviewer's strongest DECAYED contribution
    // and a later review has decayed less.
    const onlyLast = makeSubject({
      kind: "hosted_agent",
      profile_id: "hosted_agent.v1",
      observations: [
        makeObservation({
          observer_id: "loud",
          dimension: "counterparty_satisfaction",
          provenance: "third_party_review",
          value: "1.000000",
          observation_key: "k-19",
          ts: "2026-06-20T00:00:00Z",
        }),
      ],
      observers: { loud: makeObserver({ observer_id: "loud", first_seen_ts: "2024-01-01T00:00:00Z" }) },
    });
    const one = dim(scoreSubject(onlyLast).result, "counterparty_satisfaction");
    const twenty = dim(scoreSubject(spread(20)).result, "counterparty_satisfaction");
    expect(twenty.observation_count).toBe(20);
    expect(twenty.n_eff).toBeCloseTo(one.n_eff, 2);
  });

  it("counts observations on dimensions the profile does not define", () => {
    const s = probedServer({
      observations: [
        ...probedServer().observations,
        makeObservation({ observer_id: "probe:harness", dimension: "vibes", observation_key: "v" }),
      ],
    });
    const { result } = scoreSubject(s);
    expect(result.signals.unknown_dimension_observations).toBe(1);
  });

  it("refuses a profile that does not rate this kind of subject", () => {
    expect(() => scoreSubject(makeSubject({ profile_id: "code_package.v1" }))).toThrow(/rates/);
  });

  it("refuses a prior with unvouched provenance", () => {
    const s = makeSubject();
    expect(() =>
      scoreSubject({ ...s, priors: { ...s.priors, basis: "whatever" as never } }),
    ).toThrow(/allowed provenance/);
    expect(() => scoreSubject({ ...s, priors: { ...s.priors, n_basis: "0" } })).toThrow(/positive/);
    expect(() => scoreSubject({ ...s, priors: { ...s.priors, global: "1.5" } })).toThrow(/\[0,1\]/);
  });
});

describe("lifecycle and observer handling", () => {
  it("classifies by last observed activity", () => {
    const at = (ts: string | null, reachable = true): string =>
      scoreSubject(makeSubject({ last_active_ts: ts, reachable })).result.lifecycle;
    expect(at("2026-07-20T00:00:00Z")).toBe("live");
    expect(at("2026-01-01T00:00:00Z")).toBe("dormant");
    expect(at(null)).toBe("reachable");
    expect(at(null, false)).toBe("declared");
  });

  it("synthesizes a conservative observer for an id with no stats row", () => {
    const s = makeSubject({
      observations: [makeObservation({ observer_id: "orphan", dimension: "availability" })],
      observers: {},
    });
    const { result } = scoreSubject(s);
    expect(result.signals.synthesized_observer_count).toBe(1);
    const w = result.observer_weights.find((x) => x.observer_id === "orphan");
    // Age floor 0.20 times full concentration penalty 0.70 -> 0.06.
    expect(w!.weight).toBeCloseTo(0.06, 4);
  });

  it("treats an observer id that collides with a prototype member as an own key", () => {
    const s = makeSubject({
      observations: [makeObservation({ observer_id: "__proto__", dimension: "availability" })],
      observers: {},
    });
    expect(() => scoreSubject(s)).not.toThrow();
    expect(scoreSubject(s).result.signals.synthesized_observer_count).toBe(1);
  });
});

describe("subject inputs hash", () => {
  it("ignores evidence_ref, which does not enter the estimator", () => {
    const s = probedServer();
    const withRefs = {
      ...s,
      observations: s.observations.map((o) => ({ ...o, evidence_ref: "https://example.com/run/1" })),
    };
    expect(subjectInputsHash(withRefs)).toBe(subjectInputsHash(s));
  });

  it("changes when a constant value changes", () => {
    const s = probedServer();
    const tweaked = {
      ...s,
      constants: { ...DEFAULT_RATING_CONSTANTS, shrinkage_k: "6.00" },
    };
    expect(subjectInputsHash(tweaked)).not.toBe(subjectInputsHash(s));
  });

  it("is invariant to how a decimal was spelled", () => {
    const s = probedServer();
    const spelled = { ...s, constants: { ...DEFAULT_RATING_CONSTANTS, shrinkage_k: "5" } };
    expect(subjectInputsHash(spelled)).toBe(subjectInputsHash(s));
  });

  it("is invariant to observation order and to duplicates", () => {
    const s = probedServer();
    const shuffled = { ...s, observations: [...s.observations].reverse() };
    const duplicated = { ...s, observations: [...s.observations, ...s.observations] };
    expect(subjectInputsCanonical(shuffled)).toBe(subjectInputsCanonical(s));
    expect(subjectInputsCanonical(duplicated)).toBe(subjectInputsCanonical(s));
  });
});
