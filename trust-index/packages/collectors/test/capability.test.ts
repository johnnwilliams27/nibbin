/**
 * The capability layer. Every test here is about one rule:
 *
 *   A GAP IN OUR HARNESS IS NEVER A FINDING ABOUT A SUBJECT.
 *
 * The engine enforces the second half of that (it refuses to score gaps). This
 * file enforces the first half: that a missing or broken capability is
 * detected before we touch a subject, attributed to us, and turned into a work
 * queue rather than into silence.
 */
import { describe, expect, it } from "vitest";
import {
  CAPABILITIES,
  harnessDefects,
  planBattery,
  preflight,
  subjectsBlockedBy,
  type CapabilityProbe,
  type CapabilityReport,
} from "../src/capability.js";
import type { AssessmentGap } from "@trust-index/types";

const healthy = (id: string): CapabilityProbe => ({
  id,
  provisioning_note: `provision ${id}`,
  check: async () => ({ available: true }),
});

const drained = (id: string): CapabilityProbe => ({
  id,
  provisioning_note: `provision ${id}`,
  check: async () => ({ available: false, reason: "exhausted", detail: "testnet balance below floor" }),
});

const absent = (id: string): CapabilityProbe => ({
  id,
  provisioning_note: `provision ${id}`,
  check: async () => ({ available: false, reason: "not_provisioned", detail: "no account created" }),
});

describe("preflight", () => {
  it("checks health before a run rather than discovering it by failure", async () => {
    const reports = await preflight([healthy(CAPABILITIES.mailbox), drained(CAPABILITIES.testnet_wallet)]);
    expect(reports.get(CAPABILITIES.mailbox)!.health.available).toBe(true);
    const wallet = reports.get(CAPABILITIES.testnet_wallet)!.health;
    expect(wallet.available).toBe(false);
    if (!wallet.available) expect(wallet.reason).toBe("exhausted");
  });

  it("treats a probe that throws as an unhealthy capability, not a crashed run", async () => {
    // A wallet RPC that times out must not take down a run over fifteen
    // thousand subjects. It is one capability being unreachable.
    const exploding: CapabilityProbe = {
      id: CAPABILITIES.testnet_wallet,
      provisioning_note: "fund two testnet wallets",
      check: async () => {
        throw new Error("RPC timeout after 15s");
      },
    };
    const reports = await preflight([exploding]);
    const h = reports.get(CAPABILITIES.testnet_wallet)!.health;
    expect(h.available).toBe(false);
    if (!h.available) {
      expect(h.reason).toBe("unreachable");
      expect(h.detail).toMatch(/RPC timeout/);
    }
  });
});

describe("planBattery", () => {
  const requirements = [
    { dimension: "availability", check: "reachable", requires: [CAPABILITIES.none] },
    { dimension: "functional_correctness", check: "email_round_trip", requires: [CAPABILITIES.mailbox] },
    { dimension: "tool_safety", check: "sandbox_diff", requires: [CAPABILITIES.repo_sandbox] },
    { dimension: "functional_correctness", check: "transfer_round_trip", requires: [CAPABILITIES.testnet_wallet] },
  ];

  it("runs what it can and records the rest as gaps, never as failures", async () => {
    const caps = await preflight([healthy(CAPABILITIES.mailbox), drained(CAPABILITIES.testnet_wallet)]);
    const { runnable, gaps } = planBattery(requirements, caps);

    expect(runnable.map((r) => r.check)).toEqual(["reachable", "email_round_trip"]);
    expect(gaps).toHaveLength(2);
    for (const g of gaps) {
      expect(["harness_capability_missing", "harness_capability_unhealthy"]).toContain(g.cause);
    }
  });

  it("separates never-provisioned from provisioned-and-broken", async () => {
    // Different fixes and different urgency. A drained wallet is usually worse
    // than a missing niche account, because it worked yesterday and will
    // silently degrade every run until someone notices.
    const caps = await preflight([drained(CAPABILITIES.testnet_wallet), absent(CAPABILITIES.repo_sandbox)]);
    const { gaps } = planBattery(requirements, caps);
    const byCheck = new Map(gaps.map((g) => [g.check, g]));
    expect(byCheck.get("transfer_round_trip")!.cause).toBe("harness_capability_unhealthy");
    expect(byCheck.get("sandbox_diff")!.cause).toBe("harness_capability_missing");
    expect(byCheck.get("transfer_round_trip")!.detail).toMatch(/balance below floor/);
  });

  it("treats an unknown capability as missing rather than as available", async () => {
    // Silence is not consent. A capability nobody registered is one we do not
    // have, and assuming otherwise would run a test that then fails for
    // reasons the subject gets blamed for.
    const caps = await preflight([]);
    const { runnable, gaps } = planBattery(requirements, caps);
    expect(runnable.map((r) => r.check)).toEqual(["reachable"]);
    expect(gaps.every((g) => g.cause === "harness_capability_missing")).toBe(true);
    expect(gaps[0]!.detail).toMatch(/never provisioned/);
  });

  it("carries the capability id on every gap, so the fix is identifiable", async () => {
    const caps = await preflight([]);
    const { gaps } = planBattery(requirements, caps);
    for (const g of gaps) expect(g.capability).not.toBeNull();
  });
});

describe("harnessDefects", () => {
  function gap(capability: string, dimension: string, cause: AssessmentGap["cause"] = "harness_capability_missing"): AssessmentGap {
    return { dimension, check: "c", cause, capability, detail: `${capability} unavailable` };
  }

  it("ranks by blast radius, not by how alarming the failure sounds", async () => {
    // A revoked token blocking most of the compendium outranks a missing niche
    // account blocking three subjects, however severe "revoked" reads alone.
    // The report is a work queue, so it has to be ordered by what to fix first.
    const gapsBySubject = new Map<string, AssessmentGap[]>();
    for (let i = 0; i < 90; i += 1) gapsBySubject.set(`s${i}`, [gap(CAPABILITIES.mailbox, "functional_correctness")]);
    for (let i = 0; i < 3; i += 1) {
      gapsBySubject.get(`s${i}`)!.push(gap(CAPABILITIES.testnet_wallet, "functional_correctness", "harness_capability_unhealthy"));
    }
    const caps = await preflight([absent(CAPABILITIES.mailbox), drained(CAPABILITIES.testnet_wallet)]);
    const defects = harnessDefects(gapsBySubject, caps, 100);

    expect(defects[0]!.capability).toBe(CAPABILITIES.mailbox);
    expect(defects[0]!.severity).toBe("critical");
    expect(defects[0]!.subjects_blocked).toBe(90);
    expect(defects[1]!.capability).toBe(CAPABILITIES.testnet_wallet);
    expect(defects[1]!.severity).toBe("low");
  });

  it("carries the provisioning note, so the report says what to actually do", async () => {
    const caps = await preflight([absent(CAPABILITIES.repo_sandbox)]);
    const defects = harnessDefects(new Map([["s1", [gap(CAPABILITIES.repo_sandbox, "tool_safety")]]]), caps, 1);
    expect(defects[0]!.provisioning_note).toBe("provision repo_sandbox");
    expect(defects[0]!.dimensions_affected).toEqual(["tool_safety"]);
  });

  it("ignores gaps that are not ours", async () => {
    // A subject that broke before we could check something is not a defect in
    // our harness and must not appear in our work queue.
    const notOurs: AssessmentGap = {
      dimension: "protocol_conformance",
      check: "tools_list",
      cause: "subject_blocked",
      capability: null,
      detail: "handshake failed",
    };
    const naGap: AssessmentGap = {
      dimension: "documentation",
      check: "parameters_described",
      cause: "not_applicable",
      capability: null,
      detail: "tool declares no parameters",
    };
    const defects = harnessDefects(new Map([["s1", [notOurs, naGap]]]), await preflight([]), 1);
    expect(defects).toHaveLength(0);
  });
});

describe("subjectsBlockedBy", () => {
  it("names everything to re-test once a capability is repaired", () => {
    // Recording a gap honestly is only half the rule. An un-retested subject
    // stays permanently under-assessed, and its rating stays quietly wrong.
    const gapsBySubject = new Map<string, AssessmentGap[]>([
      ["b", [{ dimension: "d", check: "c", cause: "harness_capability_missing", capability: "mailbox", detail: "" }]],
      ["a", [{ dimension: "d", check: "c", cause: "harness_capability_unhealthy", capability: "mailbox", detail: "" }]],
      ["c", [{ dimension: "d", check: "c", cause: "harness_capability_missing", capability: "repo_sandbox", detail: "" }]],
      ["d", [{ dimension: "d", check: "c", cause: "subject_blocked", capability: null, detail: "" }]],
    ]);
    expect(subjectsBlockedBy(gapsBySubject, "mailbox")).toEqual(["a", "b"]);
    expect(subjectsBlockedBy(gapsBySubject, "repo_sandbox")).toEqual(["c"]);
  });
});
