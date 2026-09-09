/**
 * The A2A battery's three judgement calls, each of which was measurably wrong
 * against live BSC agents before these tests existed.
 *
 * All three are the same error in different costumes, which is why they are in
 * one file: a limitation of OUR comparison written down as a fact about the
 * agent. Two of them scored against the subject and one scored FOR it, and the
 * one that scored for it is the more dangerous, because injection resistance
 * carries the harshest gate in the profile.
 */
import { describe, expect, it } from "vitest";
import { comparableBody, invokable } from "../src/a2a/battery.js";
import type { SkillDeclaration } from "../src/a2a/transcript.js";

function skill(over: Partial<SkillDeclaration> = {}): SkillDeclaration {
  return { id: "quote", name: "Quote", description: "", tags: [], examples: [], inputModes: [], outputModes: [], ...over };
}

describe("comparableBody", () => {
  /**
   * The measured case, verbatim in shape from agents.chainhelix.io: two replies
   * identical down to the error string and the hint, differing only in the
   * three UUIDs the protocol requires to be fresh. Raw JSON.stringify called
   * this non-determinism on 57 of 76 probed skills.
   */
  it("ignores the message ids the protocol requires to differ", () => {
    const reply = (m: string, c: string, t: string): unknown => ({
      kind: "message",
      role: "agent",
      messageId: m,
      parts: [{ kind: "data", data: { error: "unknown skill: undefined", skills: ["negotiate"] } }],
      contextId: c,
      taskId: t,
    });
    const a = reply("6a43b102-64a0-4e3b-a1d5-fd186f993220", "c35cc44c-c93c-471a-a801-57c4bab19775", "7daa2c4b-0d30-4c61-a905-adaa5091474d");
    const b = reply("c3c8a4fa-8c6f-44df-b2e3-110922c5afca", "1348d699-6c0b-4deb-afed-8de7f554e4e9", "41078d3c-0133-45b9-838f-43236a4afbab");
    expect(comparableBody(a)).toBe(comparableBody(b));
  });

  it("ignores uuids and timestamps buried inside a payload, not just in the envelope", () => {
    const a = { parts: [{ kind: "text", text: "ok" }], meta: { trace: "6a43b102-64a0-4e3b-a1d5-fd186f993220", at: "2026-09-09T10:00:00Z" } };
    const b = { parts: [{ kind: "text", text: "ok" }], meta: { trace: "c3c8a4fa-8c6f-44df-b2e3-110922c5afca", at: "2026-09-09T10:00:31.204Z" } };
    expect(comparableBody(a)).toBe(comparableBody(b));
  });

  it("still sees a genuinely different answer", () => {
    const a = { messageId: "x", parts: [{ kind: "text", text: "BNB is at 612" }] };
    const b = { messageId: "y", parts: [{ kind: "text", text: "BNB is at 588" }] };
    expect(comparableBody(a)).not.toBe(comparableBody(b));
  });

  it("collapses a pure-envelope reply to nothing, so it cannot read as agreement", () => {
    // Two replies carrying no content at all would compare equal and report
    // perfect determinism from zero evidence. The caller treats this value as
    // undecidable rather than as a pass.
    expect(comparableBody({ messageId: "a", taskId: "b", contextId: "c" })).toBe("{}");
  });
});

describe("invokable", () => {
  it("refuses a skill whose id carries a mutating verb", () => {
    expect(invokable(skill({ id: "swap_tokens" })).ok).toBe(false);
    expect(invokable(skill({ id: "quote", tags: ["transfer"] })).ok).toBe(false);
  });

  it("refuses a skill whose own published example reads as an instruction to act", () => {
    const v = invokable(skill({ id: "quote", examples: ["Swap 100 USDC for BNB"] }));
    expect(v.ok).toBe(false);
    expect(v.reason).toContain("example");
  });

  /**
   * The regression that matters most for coverage. `name` and `description` are
   * PROSE in A2A. Scanning them refused 16 of 20 skills against four live
   * agents — `deep_report` on "Pay" inside a sentence, `compare_agents` on
   * "Put", and a skill with id `rebalance_plan` named "Portfolio rebalance,
   * priced against the pools that would execute it" refused on "execute", a
   * word describing the pools. A screen that hides four fifths of the
   * population behind itself costs the measurement.
   */
  it("does not scan the display name or the description, which are prose", () => {
    expect(
      invokable(
        skill({
          id: "rebalance_plan",
          name: "Portfolio rebalance, priced against the pools that would execute it",
          description: "Pay attention to slippage; we put the plan together from live depth.",
        }),
      ).ok,
    ).toBe(true);
  });
});

/**
 * The financial-verb screen, added after a live run invoked `swap-quote`,
 * `swap-build` and `trade`.
 *
 * `invokable` delegated its identifier check to `isMutatingName`, which carries
 * the MCP vocabulary: create, delete, transfer, pay — verbs for tools that edit
 * documents. It has no swap, buy, sell, trade, mint, burn, stake or withdraw,
 * which are the verbs this file's header names as the ones that matter here,
 * because these subjects are DeFi agents and 13,715 of them declare a live
 * payment rail. The financial list was reaching only the EXAMPLES check, so a
 * skill whose id says it swaps and which published no example was called.
 */
describe("the financial-verb screen", () => {
  const refused = (id: string): boolean => !invokable(skill({ id })).ok;

  it("refuses the identifiers a live run actually invoked", () => {
    for (const id of ["swap-quote", "swap-build", "trade"]) {
      expect(refused(id), id).toBe(true);
    }
  });

  it("catches the verb in snake, kebab and camel", () => {
    for (const id of ["stake_bnb", "withdraw-all", "mintNFT", "approveSpender", "burn"]) {
      expect(refused(id), id).toBe(true);
    }
  });

  it("refuses when the verb is only in a tag", () => {
    expect(invokable(skill({ id: "helper", tags: ["defi", "swap"] })).ok).toBe(false);
  });

  it("does not fire on a word that merely contains a verb", () => {
    for (const id of ["signal_strength", "bridgehead_report", "claimant_lookup", "market_summary"]) {
      expect(refused(id), id).toBe(false);
    }
  });
});
