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
        ts: "2026-07-30T00:00:00Z",
      }),
    );
    observations.push(
      makeObservation({
        observer_id: "probe:harness",
        dimension: "protocol_conformance",
        value: "0.900000",
        observation_key: `conf-${i}`,
        ts: "2026-07-30T00:00:00Z",
      }),
    );
    observations.push(
      makeObservation({
        observer_id: "probe:harness",
        dimension: "tool_safety",
        value: "1.000000",
        observation_key: `safe-${i}`,
        ts: "2026-07-30T00:00:00Z",
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
            ts: `2026-07-${String(22 + Math.floor(i / perDay)).padStart(2, "0")}T00:00:00Z`,
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

  it("changes when the collector rubric changes", () => {
    // The hole this closes: maintenanceValue was retuned from a 90/730-day
    // ramp to 14/180 to spread the population. Every maintenance score in the
    // compendium moved and no digest changed, because profile_digest covers
    // the scoring rules and inputs_hash covered only the observations — not
    // the code that decides what an observation is worth.
    const s = probedServer();
    const retuned = { ...s, rubric_version: "mcp.rubric.v2" };
    expect(subjectInputsHash(retuned)).not.toBe(subjectInputsHash(s));
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

describe("gates", () => {
  /** A hosted agent with enough measured evidence for a composite to publish. */
  function agent(overrides: Partial<Subject> = {}): Subject {
    const observations: Observation[] = [];
    for (let i = 0; i < 8; i += 1) {
      observations.push(
        makeObservation({
          observer_id: "probe:harness",
          dimension: "task_success",
          value: "0.900000",
          observation_key: `task-${i}`,
          ts: `2026-07-${String(24 + (i % 7)).padStart(2, "0")}T00:00:00Z`,
        }),
      );
      observations.push(
        makeObservation({
          observer_id: "probe:harness",
          dimension: "availability",
          value: "1.000000",
          observation_key: `avail-${i}`,
          ts: `2026-07-${String(24 + (i % 7)).padStart(2, "0")}T00:00:00Z`,
        }),
      );
    }
    return makeSubject({
      kind: "hosted_agent",
      profile_id: "hosted_agent.v1",
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

  /** An MCP server whose tool_safety carries a finding. */
  function serverWithFinding(key: string | null): Subject {
    const base = probedServer();
    if (key === null) return base;
    return makeSubject({
      observations: [
        ...base.observations,
        makeObservation({
          observer_id: "probe:harness",
          dimension: "tool_safety",
          provenance: "measured",
          value: "0.000000",
          observation_key: key,
          ts: "2026-07-30T00:00:00Z",
        }),
      ],
      observers: base.observers,
    });
  }

  it("caps a composite on a single finding, however good everything else is", () => {
    // The case that motivated gates: a weighted average lets four good
    // dimensions dilute one hazard to a couple of points.
    const clean = scoreSubject(serverWithFinding(null)).result;
    const flagged = scoreSubject(serverWithFinding("credential_parameter_present")).result;

    expect(clean.gates_fired).toHaveLength(0);
    expect(flagged.gates_fired).toHaveLength(1);
    expect(flagged.gates_fired[0]!.gate_id).toBe("mcp.credential_parameter");
    expect(flagged.gates_fired[0]!.trigger).toBe("credential_parameter_present");
    expect(flagged.gates_fired[0]!.reason).toMatch(/credential/);

    // The ceiling is 0.45, published on the 0-100 scale.
    expect(flagged.composite!).toBeLessThanOrEqual(45);
    expect(clean.composite!).toBeGreaterThan(flagged.composite!);
    expect(flagged.composite_suppression_reason).toMatch(/gate/);
  });

  it("caps the triggering dimension too, and names the gate that did it", () => {
    const flagged = scoreSubject(serverWithFinding("credential_parameter_present")).result;
    const safety = dim(flagged, "tool_safety");
    expect(safety.gate_capped_by).toBe("mcp.credential_parameter");
    expect(safety.score!).toBeLessThanOrEqual(30);
    // The lower bound is untouched and the upper bound comes down to the cap:
    // a gate says "no better than this", never "exactly this".
    expect(safety.score_high!).toBeLessThanOrEqual(30);
    expect(safety.score_low!).toBeLessThanOrEqual(safety.score!);
  });

  it("takes the strictest ceiling when several gates fire", () => {
    const base = probedServer();
    const both = makeSubject({
      observations: [
        ...base.observations,
        makeObservation({
          observer_id: "probe:harness",
          dimension: "tool_safety",
          value: "0.000000",
          observation_key: "credential_parameter_present",
          ts: "2026-07-30T00:00:00Z",
        }),
        makeObservation({
          observer_id: "probe:harness",
          dimension: "tool_safety",
          value: "0.000000",
          observation_key: "undocumented_mutating_tool_present",
          ts: "2026-07-30T00:00:00Z",
        }),
      ],
      observers: base.observers,
    });
    const { result } = scoreSubject(both);
    expect(result.gates_fired.map((g) => g.gate_id)).toEqual([
      "mcp.credential_parameter",
      "mcp.undocumented_destructive_tool",
    ]);
    // 0.45 is stricter than 0.60, so 0.45 wins.
    expect(result.composite!).toBeLessThanOrEqual(45);
  });

  it("cannot be fired by a review, so nobody can cap a rival by posting one", () => {
    // The gate's trigger_provenance is checked independently of the
    // dimension's accepted_provenance. Without that separation, any dimension
    // that took opinions would hand every competitor a weapon.
    const base = probedServer();
    const viaReview = makeSubject({
      kind: "hosted_agent",
      profile_id: "hosted_agent.v1",
      observations: [
        ...agent().observations,
        makeObservation({
          observer_id: "rival",
          dimension: "availability",
          provenance: "third_party_review",
          value: "0.000000",
          observation_key: "avail-claim",
          ts: "2026-07-30T00:00:00Z",
        }),
      ],
      observers: {
        ...agent().observers,
        rival: makeObserver({ observer_id: "rival", first_seen_ts: "2020-01-01T00:00:00Z" }),
      },
    });
    const { result } = scoreSubject(viaReview);
    expect(result.gates_fired).toHaveLength(0);
    // The review was not admissible on availability at all, so it is counted
    // as rejected rather than quietly absorbed.
    expect(dim(result, "availability").rejected_provenance_count).toBe(1);
    expect(base.kind).toBe("mcp_server");
  });

  it("does not fire an estimate gate on thin evidence", () => {
    // A single failed probe is a bad minute. The estimate gate reads the
    // UPPER bound, which is high when evidence is thin, so it cannot fire.
    const oneFailure = agent({
      observations: [
        ...agent().observations.filter((o) => o.dimension === "task_success"),
        makeObservation({
          observer_id: "probe:harness",
          dimension: "availability",
          value: "0.000000",
          observation_key: "avail-0",
          ts: "2026-07-30T00:00:00Z",
        }),
      ],
    });
    const { result } = scoreSubject(oneFailure);
    expect(dim(result, "availability").score_high!).toBeGreaterThan(50);
    expect(result.gates_fired).toHaveLength(0);
  });

  it("fires an estimate gate once a probe window establishes the failure", () => {
    const downForWeeks = agent({
      observations: [
        ...agent().observations.filter((o) => o.dimension === "task_success"),
        ...Array.from({ length: 20 }, (_, i) =>
          makeObservation({
            observer_id: "probe:harness",
            dimension: "availability",
            value: "0.000000",
            observation_key: `avail-${i}`,
            ts: `2026-07-${String(12 + i).padStart(2, "0")}T00:00:00Z`,
          }),
        ),
      ],
    });
    const { result } = scoreSubject(downForWeeks);
    expect(result.gates_fired.map((g) => g.gate_id)).toEqual(["hosted.persistently_unavailable"]);
    expect(result.gates_fired[0]!.trigger).toBe("score_high");
    expect(result.composite!).toBeLessThanOrEqual(50);
  });

  it("does not fire on a dimension with no evidence", () => {
    // Absence of evidence is not a finding. A gate that fired on silence would
    // cap every subject nobody has probed yet.
    const noSafetyEvidence = probedServer({
      observations: probedServer().observations.filter((o) => o.dimension !== "tool_safety"),
    });
    const { result } = scoreSubject(noSafetyEvidence);
    expect(dim(result, "tool_safety").suppression_reason).toMatch(/no observations/);
    expect(result.gates_fired).toHaveLength(0);
  });

  it("does not raise a score: a gate is a ceiling, never a floor", () => {
    // caps_composite_at 0.60 must not lift a composite that is already lower.
    const weak = probedServer({
      observations: [
        ...probedServer()
          .observations.filter((o) => o.dimension !== "tool_safety")
          .map((o) => ({ ...o, value: "0.100000" })),
        makeObservation({
          observer_id: "probe:harness",
          dimension: "tool_safety",
          value: "0.000000",
          observation_key: "undocumented_mutating_tool_present",
          ts: "2026-07-30T00:00:00Z",
        }),
      ],
    });
    const { result } = scoreSubject(weak);
    expect(result.gates_fired).toHaveLength(1);
    expect(result.composite!).toBeLessThan(60);
  });
});

describe("per-dimension constants", () => {
  it("decays availability far faster than maintenance", () => {
    // A 120-day global half-life would leave a month-old uptime probe at 84
    // percent of its weight, which is not what an availability rating means.
    const aged = (dimension: string, ts: string): Subject =>
      makeSubject({
        observations: Array.from({ length: 8 }, (_, i) =>
          makeObservation({
            observer_id: "probe:harness",
            dimension,
            value: "1.000000",
            observation_key: `k-${i}`,
            ts: `${ts.slice(0, 8)}${String(Number(ts.slice(8, 10)) + i).padStart(2, "0")}${ts.slice(10)}`,
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
    const freshAvail = dim(scoreSubject(aged("availability", "2026-07-20T00:00:00Z")).result, "availability");
    const staleAvail = dim(scoreSubject(aged("availability", "2026-05-01T00:00:00Z")).result, "availability");
    const staleMaint = dim(scoreSubject(aged("maintenance", "2026-05-01T00:00:00Z")).result, "maintenance");

    // Availability at 14 days: three months of age erases nearly all of it.
    expect(staleAvail.n_eff).toBeLessThan(freshAvail.n_eff / 10);
    // Maintenance at 365 days, same age, keeps most of its weight.
    expect(staleMaint.n_eff).toBeGreaterThan(staleAvail.n_eff * 10);
  });

  it("hashes the profile so a rubric change is visible in the result", () => {
    const { result } = scoreSubject(probedServer());
    expect(result.profile_digest).toMatch(/^[0-9a-f]{64}$/);
    // A different profile is a different digest.
    const other = scoreSubject(
      makeSubject({
        kind: "hosted_agent",
        profile_id: "hosted_agent.v1",
        observations: probedServer().observations.filter((o) => o.dimension === "availability"),
        observers: probedServer().observers,
      }),
    ).result;
    expect(other.profile_digest).not.toBe(result.profile_digest);
  });
});

describe("tags", () => {
  it("never change the score or the inputs hash", () => {
    // The whole reason tags are a separate field: a mislabelled subject is
    // misfiled, not mis-rated, and two reproducers of identical evidence agree
    // even when one of them tagged it.
    const untagged = probedServer();
    const tagged = probedServer({ tags: ["finance", "research"] });
    const a = scoreSubject(untagged);
    const b = scoreSubject(tagged);
    expect(b.canonicalBytes).toBe(a.canonicalBytes);
    expect(subjectInputsHash(tagged)).toBe(subjectInputsHash(untagged));
  });

  it("hashes the prior cohort, because a prior does enter the score", () => {
    const wide = probedServer();
    const narrow = probedServer({ priors: { ...wide.priors, cohort: "mcp_server/finance" } });
    expect(subjectInputsHash(narrow)).not.toBe(subjectInputsHash(wide));
  });
});

describe("harness gaps are never findings", () => {
  /**
   * The rule with no exceptions. Testing other people's software means most
   * checks need something on our side: an account, a funded testnet wallet, a
   * scoped token. All of those can be missing, expired or drained. Recording
   * that as an absence of evidence would publish our operational failures as
   * their scores, at scale, in a product whose whole claim is careful
   * measurement.
   */
  const withGap = (cause: "harness_capability_missing" | "harness_capability_unhealthy" | "subject_blocked") =>
    probedServer({
      observations: probedServer().observations.filter((o) => o.dimension !== "tool_safety"),
      gaps: [
        {
          dimension: "tool_safety",
          check: "sandbox_diff",
          cause,
          capability: cause === "subject_blocked" ? null : "repo_sandbox",
          detail: "testnet wallet out of funds",
        },
      ],
    });

  it("never converts a gap into an observation", () => {
    const { result } = scoreSubject(withGap("harness_capability_missing"));
    const safety = dim(result, "tool_safety");
    expect(safety.observation_count).toBe(0);
    expect(safety.score).toBeNull();
    // Crucially not a zero, and not a low score.
    expect(safety.suppression_reason).toMatch(/no observations/);
  });

  it("does not let our missing credential cost the subject its rating", () => {
    // tool_safety is 0.25 of mcp_server.v1. Counting it against the full
    // profile would drop coverage to 0.75 of the whole, and a second blocked
    // dimension would push it under the 0.60 floor and withhold the rating
    // entirely, as though the subject had failed to provide evidence.
    const blocked = scoreSubject(withGap("harness_capability_missing")).result;
    // tool_safety drops out of the denominator: we could not attempt it.
    expect(blocked.assessment_completeness).toBe(0.75);
    // Two of the four assessable dimensions produced a score, so coverage is
    // 0.50/0.75 rather than 0.50/1.00. The difference is exactly the credential
    // we were missing, and it is the difference between publishing and not.
    expect(blocked.dimension_coverage).toBe(0.6667);
    expect(blocked.composite).not.toBeNull();
  });

  it("keeps a subject-caused absence separate from a harness-caused one", () => {
    // A subject that broke before we could check something HAS told us
    // nothing, and completeness stays whole: we were able to ask.
    const subjectFault = scoreSubject(withGap("subject_blocked")).result;
    expect(subjectFault.assessment_completeness).toBe(1);
    expect(subjectFault.harness_gaps).toHaveLength(0);
    expect(subjectFault.signals.subject_blocked_checks).toBe(1);

    const ourFault = scoreSubject(withGap("harness_capability_unhealthy")).result;
    expect(ourFault.assessment_completeness).toBeLessThan(1);
    expect(ourFault.harness_gaps).toHaveLength(1);
    expect(ourFault.signals.harness_blocked_checks).toBe(1);
  });

  it("publishes the capability that blocked it, so the defect is actionable", () => {
    const { result } = scoreSubject(withGap("harness_capability_unhealthy"));
    expect(result.harness_gaps[0]).toEqual({
      dimension: "tool_safety",
      check: "sandbox_diff",
      capability: "repo_sandbox",
      detail: "testnet wallet out of funds",
    });
  });

  it("does not change any score it computes, nor the inputs hash", () => {
    // A gap is a statement about our run, not about the subject. It must not
    // move a single number computed from the evidence, and two reproducers who
    // differ only in what they were able to attempt must still agree on what
    // they did measure.
    const noGap = probedServer({
      observations: probedServer().observations.filter((o) => o.dimension !== "tool_safety"),
    });
    const gap = withGap("harness_capability_missing");
    const a = scoreSubject(noGap).result;
    const b = scoreSubject(gap).result;
    for (const id of ["availability", "protocol_conformance"]) {
      expect(dim(b, id).score, id).toBe(dim(a, id).score);
      expect(dim(b, id).n_eff, id).toBe(dim(a, id).n_eff);
      expect(dim(b, id).confidence, id).toBe(dim(a, id).confidence);
    }
    expect(subjectInputsHash(gap)).toBe(subjectInputsHash(noGap));
  });

  it("withholds when the subject yielded nothing, publishes when we never asked", () => {
    // The asymmetry this design deliberately creates, stated plainly because
    // it is not obvious. Identical evidence, two runs:
    //
    //   no gap recorded  -> tool_safety was assessable and yielded nothing.
    //                       That is information about the subject. Coverage is
    //                       0.50 of the profile, under the 0.60 floor, withheld.
    //   gap recorded     -> tool_safety was never assessable by us. Holding it
    //                       against the subject would be publishing our own
    //                       missing credential as their shortfall. Coverage is
    //                       measured over the rest, clears the floor, published.
    //
    // The whole point of the gap field is to make these two cases distinguishable
    // instead of identical-looking.
    const noGap = probedServer({
      observations: probedServer().observations.filter((o) => o.dimension !== "tool_safety"),
    });
    expect(scoreSubject(noGap).result.composite).toBeNull();
    expect(scoreSubject(noGap).result.composite_suppression_reason).toMatch(/too little of the profile/);
    expect(scoreSubject(withGap("harness_capability_missing")).result.composite).not.toBeNull();
  });

  it("counts a partly blocked dimension in proportion to the checks that ran", () => {
    // One check blocked out of several does not make the dimension
    // unassessable — it is still scored, still published, still carries its
    // weight. That much has always been right and is unchanged here.
    //
    // What changed in r0.2.0 is that assessability stopped being BINARY. The
    // old rule dropped a blocked dimension from the completeness denominator
    // only when it published nothing at all, so any dimension that got one
    // check through counted as fully assessed. Read at dimension granularity
    // that is defensible; read at check granularity it is not, and it fails
    // hardest exactly where it matters most — four checks of five blocked by a
    // credential we lack reported assessment_completeness 1.00 alongside four
    // harness gaps, which is "we assessed all of this" and "we could not
    // assess most of this" in one result.
    //
    // Proportional keeps the old intent (the dimension is assessed) without
    // the false claim (we saw everything). Here one blocked check of several
    // costs a few points of completeness rather than zero or all of them.
    const partial = probedServer({
      gaps: [
        {
          dimension: "tool_safety",
          check: "sandbox_diff",
          cause: "harness_capability_missing",
          capability: "repo_sandbox",
          detail: "no sandbox repo provisioned",
        },
      ],
    });
    const { result } = scoreSubject(partial);
    expect(dim(result, "tool_safety").score).not.toBeNull();
    expect(result.assessment_completeness).toBeGreaterThan(0.9);
    expect(result.assessment_completeness).toBeLessThan(1);
    // The gap is still reported, because it is still work for us.
    expect(result.harness_gaps).toHaveLength(1);
  });
});
