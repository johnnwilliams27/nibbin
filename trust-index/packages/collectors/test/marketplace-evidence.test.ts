import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assessmentFor, mergeMarketplace, type EndpointResult } from "../scripts/merge-marketplace-assessments.mjs";

// Real committed transcripts, not invented subjects. Nothing goes on the network.
const probes = JSON.parse(readFileSync(new URL("../../../apps/bnb-marketplace/data/probes/endpoint-probes.json", import.meta.url), "utf8")) as { results: EndpointResult[] };
const at = (part: string): EndpointResult => structuredClone(probes.results.find((r) => r.endpoint.includes(part))!);

describe("marketplace evidence scope", () => {
  it("does not infer MCP from an HTTP auth wall on the Fraast blob", () => {
    const a = assessmentFor(at("a4d7ca6"));
    expect(a.protocol_spoken).toBeNull();
    expect(a.reachable).toBe(true);
    expect(a).toMatchObject({ evidence_state: "auth_walled", capability_source: null });
  });
  it("does not infer protocol liveness from a BORT agent card", () => {
    const a = assessmentFor(at("api.bortagent.xyz/.well-known"));
    expect(a.protocol_spoken).toBeNull();
    expect(a).toMatchObject({ evidence_state: "card_retrieved", capability_source: "agent_card" });
    expect(a.tools_or_skills.length).toBeGreaterThan(0);
  });
  it("marks a shared fallback card as host evidence, not identity evidence", () => {
    const a = assessmentFor(at("mpp.hyreagent.fun/agents/bobo"));
    expect(a).toMatchObject({ evidence_scope: "host", evidence_state: "card_retrieved",
      evidence_endpoint: "https://mpp.hyreagent.fun/.well-known/agent-card.json" });
  });
  it("retains an actual A2A liveness result", () => {
    const a = assessmentFor(at("cm-3c862a"));
    expect(a.protocol_spoken).toBe("a2a");
    expect(a).toMatchObject({ evidence_state: "protocol_confirmed" });
  });
  it("does not trust a legacy empty handshake marked successful", () => {
    const a = assessmentFor(at("mcp.ezcto.fun"));
    expect(a.protocol_spoken).toBeNull();
    expect(a.withheld_reason).not.toContain("declared no tools");
  });
  it("does not turn our unsupported npm transport into unreachability", () => {
    const a = assessmentFor(at("npm://"));
    expect(a.reachable).toBeNull();
    expect(a).toMatchObject({ evidence_state: "unsupported_transport" });
  });
  it("keeps an HTTP405 as our failed transport attempt, without guessing stdio", () => {
    const a = assessmentFor(at("q402.quackai.ai/api/mcp/info"));
    expect(a.reachable).toBe(true);
    expect(a).toMatchObject({ evidence_state: "response_received", evidence_provenance: "probe_observation" });
    expect(a.withheld_reason).toMatch(/our|we /i);
    expect(a.withheld_reason).not.toContain("declares stdio");
  });
  it("replays associations without pretending the registry or probes were refreshed", () => {
    const market = mkdtempSync(join(tmpdir(), "nibbin-replay-test-"));
    mkdirSync(join(market, "data", "probes"), { recursive: true });
    const r = at("app.singularry.org/api/mcp");
    const rows = [{ agent_id: "test:1", endpoint: r.endpoint, assessment: null, is_reference_agent: false },
      { agent_id: "test:2", endpoint: r.endpoint, assessment: null, is_reference_agent: false },
      { agent_id: "test:reference", endpoint: r.endpoint, assessment: null, is_reference_agent: true }];
    writeFileSync(join(market, "data", "agents.json"), JSON.stringify({ generated_at: "2026-09-09T05:37:50Z", agents: rows }));
    writeFileSync(join(market, "data", "probes", "endpoint-probes.json"), JSON.stringify({ results: [r] }));
    mergeMarketplace(market);
    const dataset = JSON.parse(readFileSync(join(market, "data", "agents.json"), "utf8"));
    expect(dataset.generated_at).toBe("2026-09-09T05:37:50Z");
    expect(dataset.agents[0].assessment.checked_at).toBe(r.mcp!.probed_at);
    expect(dataset.agents[0].assessment.shared_registration_count).toBe(2);
    expect(dataset.agents[1].assessment.protocol_spoken).toBe("mcp");
    expect(dataset.agents[2].assessment).toBeNull();
    expect(dataset.assessments_replayed_at).toEqual(expect.any(String));
    expect(dataset.assessment_probe_source_sha256).toMatch(/^[a-f0-9]{64}$/);
  });
  it("rejects a transcript attributed to a different endpoint", () => {
    const r = at("app.singularry.org/api/mcp");
    r.endpoint = "https://unrelated.example/mcp";
    expect(() => assessmentFor(r)).toThrow(/endpoint/);
  });
  it("selects the latest explicit artifact while retaining original sources and snapshot clock", () => {
    const market = mkdtempSync(join(tmpdir(), "nibbin-refresh-merge-"));
    mkdirSync(join(market, "data", "probes"), { recursive: true });
    const old = at("app.singularry.org/api/mcp");
    const fresh = structuredClone(old);
    fresh.probed_at = "2026-09-09T07:30:00Z";
    fresh.mcp!.probed_at = fresh.probed_at;
    fresh.mcp!.handshake = null;
    fresh.mcp!.tools = null;
    fresh.mcp!.auth = { required: true, status: 401, scheme: null };
    writeFileSync(join(market, "data", "agents.json"), JSON.stringify({ generated_at: "2026-09-09T05:37:50Z",
      agents: [{ agent_id: "test:1", endpoint: old.endpoint, assessment: null, is_reference_agent: false }] }));
    writeFileSync(join(market, "data", "probes", "endpoint-probes.json"), JSON.stringify({ results: [old] }));
    const freshPath = join(market, "data", "probes", "listed-refresh.json");
    writeFileSync(freshPath, JSON.stringify({ scope: "listed-preferred-endpoints-read-only-v1", status: "complete",
      generated_at: fresh.probed_at, selected_urls: [fresh.endpoint], results: [fresh] }));
    mergeMarketplace(market, [freshPath]);
    const dataset = JSON.parse(readFileSync(join(market, "data", "agents.json"), "utf8"));
    expect(dataset.generated_at).toBe("2026-09-09T05:37:50Z");
    expect(dataset.agents[0].assessment.evidence_state).toBe("auth_walled");
    expect(dataset.agents[0].assessment.checked_at).toBe(fresh.probed_at);
    expect(dataset.agents[0].assessment.evidence_source).toBe("data/probes/listed-refresh.json");
    expect(dataset.assessment_probe_sources).toHaveLength(2);
    expect(JSON.parse(readFileSync(join(market, "data", "probes", "endpoint-probes.json"), "utf8")).results[0].probed_at).toBe(old.probed_at);
    const skippedPath = join(market, "data", "probes", "skipped-refresh.json");
    writeFileSync(skippedPath, JSON.stringify({ scope: "listed-preferred-endpoints-read-only-v1", status: "complete",
      generated_at: "2026-09-09T08:00:00Z", selected_urls: [fresh.endpoint],
      results: [{ ...fresh, mcp: null, a2a: null, probed_at: "2026-09-09T08:00:00Z", skip_reason: "No request was sent" }] }));
    mergeMarketplace(market, [skippedPath]);
    const afterSkip = JSON.parse(readFileSync(join(market, "data", "agents.json"), "utf8"));
    expect(afterSkip.agents[0].assessment.evidence_state).toBe("auth_walled");
    expect(afterSkip.agents[0].assessment.checked_at).toBe(fresh.probed_at);
  });
});
