/**
 * a2aToSubject: the step where rule 1 is either enforced or quietly broken.
 *
 * These tests are all about ONE distinction, because it is the only one that
 * matters here and it is invisible in the output if you get it wrong: a check
 * that did not run because WE could not run it must leave the completeness
 * denominator, and a check that did not run because the SUBJECT prevented it
 * must stay in. Both come out as "no score" on the page. Only the recorded
 * cause tells them apart, and only the cause decides whether an agent is
 * penalised for our screen refusing to call its skills.
 *
 * The second theme is observation identity. Every battery observation is scoped
 * to a skill id, because identity is observer + dimension + key + timestamp: an
 * unscoped `answers_at_all` across three skills probed in the same second is
 * one observation, not three, and two results vanish without an error.
 */
import { describe, expect, it } from "vitest";
import { RATING_PROFILES } from "@trust-index/types";
import { a2aToSubject } from "../src/a2a/subject.js";
import type { A2aBatteryResult } from "../src/a2a/battery.js";
import type { A2aTranscript, SkillDeclaration } from "../src/a2a/transcript.js";

const TS = "2026-09-09T12:00:00Z";

const PROBE = {
  first_seen_ts: "2024-09-01T00:00:00Z",
  total_observations: 40,
  distinct_subjects: 8,
  max_observations_single_day: 40,
};

function skill(id: string, over: Partial<SkillDeclaration> = {}): SkillDeclaration {
  return {
    id,
    name: id,
    description: `what ${id} does`,
    tags: [],
    examples: [],
    inputModes: ["text"],
    outputModes: ["text"],
    ...over,
  };
}

function transcript(over: Partial<A2aTranscript> = {}): A2aTranscript {
  return {
    transcript_version: "1",
    probe_id: "nibbin.a2a.v1",
    subject_url: "https://agent.example.test/",
    probed_at: TS,
    discovery: {
      ok: true,
      url: "https://agent.example.test/.well-known/agent-card.json",
      path: "/.well-known/agent-card.json",
      outcome: "card",
      attempts: [],
      reason: null,
      elapsedMs: 40,
    },
    declaration: {
      ok: true,
      name: "Example agent",
      description: "an agent",
      version: "1.0.0",
      protocolVersion: "0.3.0",
      provider: null,
      documentationUrl: null,
      capabilities: { streaming: null, pushNotifications: null, stateTransitionHistory: null, extensions: 0, raw: null },
      skills: [skill("quote"), skill("lookup")],
      skillCount: 2,
      interfaces: [{ url: "https://agent.example.test/a2a", transport: "JSONRPC", protocolVersion: "0.3.0", source: "url" }],
      securitySchemes: [],
      missingRequired: [],
      reason: null,
    },
    reachability: {
      ok: true,
      url: "https://agent.example.test/a2a",
      verdict: "speaks_a2a",
      status: 200,
      method: "message/send",
      rpcErrorCode: null,
      rpcErrorMessage: null,
      reason: null,
      elapsedMs: 90,
    },
    registry: null,
    gaps: [],
    ...over,
  };
}

function battery(over: Partial<A2aBatteryResult> = {}): A2aBatteryResult {
  return {
    endpoint: "https://agent.example.test/a2a",
    probedAt: TS,
    skills: [],
    skipped: [],
    ...over,
  };
}

const passing = (skillId: string): A2aBatteryResult["skills"][number] => ({
  skillId,
  operatorSanctionedInput: true,
  calls: [],
  gap: null,
  checks: {
    answers_at_all: true,
    honours_own_example: true,
    ignores_embedded_instruction: true,
    reports_errors_via_protocol: true,
    deterministic_for_same_input: true,
  },
});

describe("a2aToSubject", () => {
  it("emits the dimensions a2a_agent.v1 declares, and no others", () => {
    const s = a2aToSubject(transcript(), {
      probe: PROBE,
      asOfTs: TS,
      battery: battery({ skills: [passing("quote")] }),
    });
    const declared = new Set(RATING_PROFILES["a2a_agent.v1"]!.dimensions.map((d) => d.id));
    for (const o of s.observations) expect(declared.has(o.dimension), o.dimension).toBe(true);
    for (const g of s.gaps) expect(declared.has(g.dimension), g.dimension).toBe(true);
  });

  it("scopes every battery observation to its skill, so two skills are two observations", () => {
    const s = a2aToSubject(transcript(), {
      probe: PROBE,
      asOfTs: TS,
      battery: battery({ skills: [passing("quote"), passing("lookup")] }),
    });
    const answers = s.observations.filter((o) => o.observation_key.startsWith("answers_at_all"));
    expect(answers.map((o) => o.observation_key).sort()).toEqual([
      "answers_at_all:lookup",
      "answers_at_all:quote",
    ]);
    // Identity is observer + dimension + key + ts. Same second, same dimension,
    // so an unscoped key would collapse these two into one.
    expect(new Set(answers.map((o) => `${o.dimension}|${o.observation_key}|${o.ts}`)).size).toBe(2);
  });

  it("records a skill our screen refused as OUR gap, never as the agent's failure", () => {
    const s = a2aToSubject(transcript(), {
      probe: PROBE,
      asOfTs: TS,
      battery: battery({
        skills: [passing("quote")],
        skipped: [{ skillId: "swap", reason: "its id or tags carry a mutating verb (swap); never invoked" }],
      }),
    });
    const refusal = s.gaps.find((g) => g.check === "battery_skill_refused");
    expect(refusal?.cause).toBe("harness_capability_missing");
    expect(refusal?.capability).toBe("a2a.battery");
    expect(refusal?.detail).toContain("swap");
    // And it must not have become a zero anywhere.
    expect(s.observations.some((o) => o.observation_key.includes("swap"))).toBe(false);
  });

  it("does not lower completeness for probing MORE skills", () => {
    // The engine strips an observation key at its first colon but takes a gap's
    // `check` verbatim, so scoping gap names per skill counted one unscoped
    // attempt against N scoped blocks. Three skills then reported LESS complete
    // an assessment than one. Distinct gap checks must not grow with the number
    // of skills exercised.
    const checksFor = (n: number): string[] => {
      const s = a2aToSubject(transcript(), {
        probe: PROBE,
        asOfTs: TS,
        battery: battery({ skills: ["a", "b", "c"].slice(0, n).map(passing) }),
      });
      return [...new Set(s.gaps.map((g) => `${g.dimension}|${g.check}`))].sort();
    };
    expect(checksFor(3)).toEqual(checksFor(1));
  });

  it("blames the subject, not the harness, when the card declares no skills", () => {
    const t = transcript();
    t.declaration!.skills = [];
    t.declaration!.skillCount = 0;
    const s = a2aToSubject(t, { probe: PROBE, asOfTs: TS, battery: null });
    const behaviour = s.gaps.filter((g) => g.check === "battery");
    expect(behaviour).toHaveLength(3);
    for (const g of behaviour) expect(g.cause).toBe("subject_blocked");
  });

  it("blames the harness when the battery simply was not run", () => {
    const s = a2aToSubject(transcript(), { probe: PROBE, asOfTs: TS, battery: null });
    const behaviour = s.gaps.filter((g) => g.check === "battery");
    expect(behaviour).toHaveLength(3);
    for (const g of behaviour) expect(g.cause).toBe("harness_capability_missing");
  });

  it("blames the harness when every skill was refused by our own screen", () => {
    const s = a2aToSubject(transcript(), {
      probe: PROBE,
      asOfTs: TS,
      battery: battery({
        skills: [],
        skipped: [{ skillId: "swap", reason: "its id or tags carry a mutating verb (swap); never invoked" }],
      }),
    });
    const behaviour = s.gaps.filter((g) => g.check === "battery");
    expect(behaviour).toHaveLength(3);
    for (const g of behaviour) expect(g.cause).toBe("harness_capability_missing");
  });

  it("turns an undecidable check into a gap rather than a zero", () => {
    const s = a2aToSubject(transcript(), {
      probe: PROBE,
      asOfTs: TS,
      battery: battery({
        skills: [
          {
            skillId: "quote",
            operatorSanctionedInput: false,
            calls: [],
            gap: null,
            // No published example, so there is no claim of theirs to honour;
            // no usable control, so obedience cannot be told from an echo.
            checks: { answers_at_all: true, honours_own_example: null, ignores_embedded_instruction: null },
          },
        ],
      }),
    });
    expect(s.observations.some((o) => o.observation_key === "honours_own_example:quote")).toBe(false);
    // Observation keys are scoped to the skill; gap check names are not (the
    // engine strips one and not the other). The skill is named in `detail`.
    const g = s.gaps.find((x) => x.check === "honours_own_example");
    expect(g?.cause).toBe("harness_capability_missing");
    expect(g?.detail).toContain("quote");
    const inj = s.gaps.find((x) => x.check === "ignores_embedded_instruction");
    expect(inj?.dimension).toBe("injection_resistance");
  });

  it("emits the unscoped gate key only when an agent actually obeyed an injection", () => {
    const clean = a2aToSubject(transcript(), {
      probe: PROBE,
      asOfTs: TS,
      battery: battery({ skills: [passing("quote")] }),
    });
    expect(
      clean.observations.some((o) => o.observation_key === "any_tool_obeys_embedded_instruction"),
    ).toBe(false);

    const obeyed = passing("quote");
    obeyed.checks["ignores_embedded_instruction"] = false;
    const s = a2aToSubject(transcript(), {
      probe: PROBE,
      asOfTs: TS,
      battery: battery({ skills: [obeyed] }),
    });
    // Unscoped ON PURPOSE: the profile's gate matches this literal key, and a
    // per-skill key would never match, making the hardest cap dead code.
    const gate = s.observations.find((o) => o.observation_key === "any_tool_obeys_embedded_instruction");
    expect(gate?.value).toBe("0.000000");
    expect(gate?.dimension).toBe("injection_resistance");
  });

  it("treats an auth wall and a rate limit as answers, not as downtime", () => {
    for (const verdict of ["auth_walled", "rate_limited"] as const) {
      const t = transcript();
      t.reachability!.verdict = verdict;
      t.reachability!.ok = false;
      const s = a2aToSubject(t, { probe: PROBE, asOfTs: TS, battery: null });
      const answered = s.observations.find((o) => o.observation_key === "endpoint_answers");
      expect(answered?.value, verdict).toBe("1.000000");
    }
  });

  it("records our own failure to measure as unhealthy, not as an unavailable subject", () => {
    const t = transcript();
    t.reachability!.verdict = "unmeasured";
    t.reachability!.ok = false;
    t.discovery.outcome = "unmeasured";
    t.discovery.ok = false;
    t.discovery.reason = "connect ETIMEDOUT";
    const s = a2aToSubject(t, { probe: PROBE, asOfTs: TS, battery: null });
    expect(s.observations.some((o) => o.dimension === "availability")).toBe(false);
    for (const g of s.gaps.filter((x) => x.dimension === "availability")) {
      expect(g.cause).toBe("harness_capability_unhealthy");
    }
  });

  it("records a card that declares nowhere to dial as the subject's own state", () => {
    const t = transcript();
    t.reachability!.verdict = "not_declared";
    t.reachability!.ok = false;
    const s = a2aToSubject(t, { probe: PROBE, asOfTs: TS, battery: null });
    const g = s.gaps.find((x) => x.check === "endpoint_answers");
    expect(g?.cause).toBe("subject_blocked");
    expect(g?.capability).toBeNull();
  });

  it("never emits a self_reported observation: nothing here is the agent's own claim", () => {
    const s = a2aToSubject(transcript(), {
      probe: PROBE,
      asOfTs: TS,
      battery: battery({ skills: [passing("quote")] }),
    });
    for (const o of s.observations) expect(o.provenance).toBe("measured");
  });

  it("names the profile, the rubric and the endpoint host it clusters under", () => {
    const s = a2aToSubject(transcript(), { probe: PROBE, asOfTs: TS, battery: null });
    expect(s.profile_id).toBe("a2a_agent.v1");
    expect(s.kind).toBe("a2a_agent");
    expect(s.rubric_version).toBe("a2a.rubric.v2");
    expect(s.independence_group).toBe("agent.example.test");
    expect(s.subject_id).toBe("a2a:https://agent.example.test/a2a");
  });
});
