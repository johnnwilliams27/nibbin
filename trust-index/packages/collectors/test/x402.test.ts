/**
 * The spend guard. These are the tests that matter most in this package:
 * an automated prober with a funded wallet on a schedule is a machine for
 * spending money in a loop, and the caps are the only thing between it and
 * an unbounded bill.
 */
import { describe, expect, it } from "vitest";
import { atomicToUsd, parsePaymentRequired, SpendGuard, DEFAULT_CAPS } from "../src/x402.js";

const req = (atomic: string) => ({
  scheme: "exact", network: "base", maxAmountRequired: BigInt(atomic),
  asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", payTo: "0xabc",
  resource: null, description: null, maxTimeoutSeconds: null, extra: {},
});

describe("parsePaymentRequired", () => {
  it("reads the x402 accepts array", () => {
    const out = parsePaymentRequired(JSON.stringify({
      accepts: [{ scheme: "exact", network: "base", maxAmountRequired: "5000", asset: "0xUSDC", payTo: "0xabc" }],
    }));
    expect(out).toHaveLength(1);
    expect(out[0]?.maxAmountRequired).toBe(5000n);
    expect(atomicToUsd(out[0]!.maxAmountRequired!)).toBeCloseTo(0.005, 6);
  });

  it("finds options nested inside a JSON-RPC error, which is where MCP servers put them", () => {
    const out = parsePaymentRequired(JSON.stringify({
      jsonrpc: "2.0", id: 1,
      error: { code: -32000, message: "payment required", data: { accepts: [{ scheme: "exact", network: "base", maxAmountRequired: "160000" }] } },
    }));
    expect(out).toHaveLength(1);
    expect(atomicToUsd(out[0]!.maxAmountRequired!)).toBeCloseTo(0.16, 6);
  });

  it("returns an UNREADABLE amount rather than guessing one", () => {
    // The dangerous failure is a missing price defaulting to something cheap.
    const out = parsePaymentRequired(JSON.stringify({ accepts: [{ scheme: "exact", network: "base" }] }));
    expect(out[0]?.maxAmountRequired).toBeNull();
  });

  it("survives a body that is not JSON at all", () => {
    expect(parsePaymentRequired("<html>402</html>")).toEqual([]);
  });
});

describe("SpendGuard", () => {
  it("refuses a price it cannot read", () => {
    const g = new SpendGuard();
    const d = g.check("https://x/mcp", { ...req("1"), maxAmountRequired: null });
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toMatch(/did not state a readable price/);
  });

  it("refuses a single call above the per-endpoint cap, and says it is unpayable", () => {
    const g = new SpendGuard({ perSweepUsd: 100, perEndpointUsd: 20 });
    // $25 in one call: no amount of waiting makes this payable.
    const d = g.check("https://x/mcp", req("25000000"));
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toMatch(/above the \$20 per-endpoint cap/);
  });

  it("stops one endpoint draining the sweep", () => {
    const g = new SpendGuard({ perSweepUsd: 100, perEndpointUsd: 20 });
    for (let i = 0; i < 4; i += 1) {
      const d = g.check("https://greedy/mcp", req("5000000")); // $5
      expect(d.allowed).toBe(true);
      if (d.allowed) g.commit("https://greedy/mcp", d.amountUsd);
    }
    expect(g.spentUsd).toBeCloseTo(20, 6);
    const next = g.check("https://greedy/mcp", req("5000000"));
    expect(next.allowed).toBe(false);
    // A different endpoint is still fine: the endpoint cap is per endpoint.
    expect(g.check("https://other/mcp", req("5000000")).allowed).toBe(true);
  });

  it("enforces the sweep cap across many endpoints", () => {
    const g = new SpendGuard({ perSweepUsd: 100, perEndpointUsd: 20 });
    for (let i = 0; i < 5; i += 1) {
      const ep = `https://s${i}/mcp`;
      for (let j = 0; j < 4; j += 1) {
        const d = g.check(ep, req("5000000"));
        expect(d.allowed).toBe(true);
        if (d.allowed) g.commit(ep, d.amountUsd);
      }
    }
    expect(g.spentUsd).toBeCloseTo(100, 6);
    expect(g.check("https://s9/mcp", req("10000")).allowed).toBe(false); // even 1 cent
  });

  it("records every refusal so it can be filed as a gap, not a finding", () => {
    const g = new SpendGuard({ perSweepUsd: 1, perEndpointUsd: 1 });
    g.check("https://a/mcp", req("2000000"));
    g.check("https://b/mcp", { ...req("1"), maxAmountRequired: null });
    expect(g.declined).toHaveLength(2);
    expect(g.declined.map((d) => d.endpoint)).toEqual(["https://a/mcp", "https://b/mcp"]);
  });

  it("ships with the caps the owner set", () => {
    expect(DEFAULT_CAPS).toEqual({ perSweepUsd: 100, perEndpointUsd: 20 });
  });
});

describe("the shape MCP servers actually use", () => {
  it("reads a price out of an in-band JSON-RPC error inside an HTTP 200", () => {
    // Measured: not one of 61 metered tools answered HTTP 402 with a structured
    // accepts array. This is what they send instead, and a parser that only
    // understands 402 reports a sweep costs nothing.
    const body = JSON.stringify({
      jsonrpc: "2.0", id: 1,
      result: { isError: true, content: [{ type: "text", text: "Payment required: $0.01 via x402 — GET /v1/kev/fresh at https://api.aislabs.ai (any x402 client pays automatically)" }] },
    });
    const out = parsePaymentRequired(body);
    expect(out).toHaveLength(1);
    expect(atomicToUsd(out[0]!.maxAmountRequired!)).toBeCloseTo(0.01, 6);
    expect(out[0]!.resource).toBe("https://api.aislabs.ai/v1/kev/fresh");
    expect(out[0]!.extra.method).toBe("GET");
  });

  it("still caps a prose-quoted price", () => {
    const g = new SpendGuard({ perSweepUsd: 100, perEndpointUsd: 20 });
    const [req] = parsePaymentRequired(JSON.stringify({ error: { message: "Payment required: $25.00 via x402" } }));
    expect(g.check("https://x/mcp", req!).allowed).toBe(false);
  });
});
