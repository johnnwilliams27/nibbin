/**
 * Regressions for the API/MCP defects found in the adversarial review pass.
 */
import { describe, expect, it } from "vitest";
import { clientKey } from "@/lib/api-handler";
import { bucketForTool, handleMcpCall, isExpensiveTool, MAX_COMPARE_AGENTS } from "@/lib/mcp";
import { FixtureDataSource } from "@/lib/fixture-data-source";

function req(headers: Record<string, string>): Request {
  return new Request("https://example.test/api/v1/agents/base/9006", { headers });
}

describe("rate-limit key derivation (XFF bypass)", () => {
  it("ignores client-controlled x-forwarded-for", () => {
    // Two different spoofed XFF values must not yield two different buckets.
    const a = clientKey(req({ "x-forwarded-for": "1.1.1.1" }));
    const b = clientKey(req({ "x-forwarded-for": "2.2.2.2" }));
    expect(a).toBe(b);
    expect(a).toBe("untrusted-shared");
  });

  it("keys on a platform-trusted header when present", () => {
    expect(clientKey(req({ "x-real-ip": "9.9.9.9", "x-forwarded-for": "1.1.1.1" }))).toBe("9.9.9.9");
  });
});

describe("compare_agents hardening", () => {
  const ds = new FixtureDataSource();

  it("is charged against the expensive bucket", () => {
    expect(isExpensiveTool("compare_agents")).toBe(true);
    expect(bucketForTool("compare_agents")).toBe("expensive");
  });

  it("rejects a fan-out larger than the cap", async () => {
    const ids = Array.from({ length: MAX_COMPARE_AGENTS + 1 }, (_, i) => String(i));
    const res = await handleMcpCall(ds, { jsonrpc: "2.0", id: 1, method: "compare_agents", params: { chain: "base", ids } });
    expect("error" in res && res.error.message).toContain("maximum");
  });

  it("carries the coverage disclaimer when any compared agent is none or thin", async () => {
    // 9001 is the placeholder fixture (tier none); pairing it with any agent
    // must still surface the disclaimer at the envelope level.
    const res = await handleMcpCall(ds, {
      jsonrpc: "2.0",
      id: 1,
      method: "compare_agents",
      params: { chain: "base", ids: ["9001", "9006"] },
    });
    if (!("result" in res)) throw new Error("expected a result");
    const meta = (res.result as { meta: { coverage_disclaimer?: string } }).meta;
    expect(meta.coverage_disclaimer).toBeTruthy();
  });
});
