import { describe, expect, it } from "vitest";
import { planListedRefresh } from "../scripts/refresh-listed.mjs";

// This planner covers the original four-category, explicitly bounded refresh.
// Use a fixed scope fixture rather than treating a growing live dataset as 40 URLs.
const dataset = { agents: [
  ...Array.from({ length: 29 }, (_, index) => ({ agent_id: `56:${index}`, name: 'Shared service', category: 'yield', endpoint: 'https://app.singularry.org/api/mcp', protocols: ['MCP'], is_reference_agent: false })),
  ...Array.from({ length: 39 }, (_, index) => ({ agent_id: `56:${index + 29}`, name: 'Service', category: 'yield', endpoint: `https://service${index}.example/mcp`, protocols: ['MCP'], is_reference_agent: false })),
  { agent_id: '56:99', name: 'Outside original scope', category: 'other', endpoint: 'https://q402.quackai.example/mcp', protocols: ['MCP'], is_reference_agent: false },
] };

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
