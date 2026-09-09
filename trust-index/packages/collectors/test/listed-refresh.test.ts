import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { planListedRefresh } from "../scripts/refresh-listed.mjs";

const dataset = JSON.parse(readFileSync(new URL("../../../apps/bnb-marketplace/data/agents.json", import.meta.url), "utf8"));

describe("bounded listed endpoint refresh planning", () => {
  it("selects exactly the40 declared preferred URLs, not the remaining indexed URLs", () => {
    const targets = planListedRefresh(dataset.agents);
    expect(targets).toHaveLength(40);
    expect(new Set(targets.map((t) => t.endpoint)).size).toBe(40);
    expect(targets.some((t) => t.endpoint.includes("q402.quackai"))).toBe(false);
    expect(targets.find((t) => t.endpoint === "https://app.singularry.org/api/mcp")?.agent_ids).toHaveLength(29);
  });
  it("excludes reference agents and null endpoints even inside a listed category", () => {
    const row = dataset.agents.find((a: { endpoint: unknown; category: string }) => a.endpoint && a.category !== "other");
    expect(planListedRefresh([{ ...row, is_reference_agent: true }, { ...row, endpoint: null }])).toEqual([]);
  });
});
