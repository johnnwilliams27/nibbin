/**
 * The MCP collector, end to end and entirely offline.
 *
 * Every request goes through an injected fetch, so these tests exercise the
 * real listing, probe, rubric and Subject construction without touching
 * anyone's server. The last test carries a transcript all the way through
 * scoreSubject, which is the point of the whole layer: a thing that is not on
 * a chain, rated by the engine that rates things on a chain.
 */
import { describe, expect, it } from "vitest";
import { scoreSubject } from "@trust-index/scoring/rating";
import {
  assessTranscript,
  isCredentialParam,
  isMutatingName,
  listServers,
  maintenanceValue,
  parseEntry,
  parseRpcBody,
  probeMcpServer,
  ratio,
  readTools,
  repositoryOwner,
  transcriptToSubject,
  transcriptsToSubject,
  type ProbeTranscript,
} from "../src/mcp/index.js";

const AS_OF = "2026-08-01T00:00:00Z";

const PROBE_IDENTITY = {
  first_seen_ts: "2025-01-01T00:00:00Z",
  total_observations: 5000,
  distinct_subjects: 900,
  max_observations_single_day: 40,
};

function goodTranscript(overrides: Partial<ProbeTranscript> = {}): ProbeTranscript {
  return {
    transcript_version: "1",
    probe_id: "probe:mcp:v1",
    endpoint: "https://example.com/mcp",
    probed_at: "2026-07-20T00:00:00Z",
    attempts: [
      { attempt: 1, ts: "2026-07-20T00:00:00Z", reachable: true, status: 200, reason: null, elapsedMs: 120 },
      { attempt: 2, ts: "2026-07-20T00:00:01Z", reachable: true, status: 200, reason: null, elapsedMs: 110 },
      { attempt: 3, ts: "2026-07-20T00:00:02Z", reachable: true, status: 200, reason: null, elapsedMs: 130 },
    ],
    handshake: {
      ok: true,
      protocolVersion: "2025-06-18",
      serverName: "example",
      serverVersion: "1.2.0",
      instructions: "Call search_docs before answering questions about the corpus.",
      reason: null,
    },
    tools: {
      ok: true,
      reason: null,
      declared: [
        {
          name: "search_docs",
          description: "Search the indexed document corpus and return matching passages.",
          inputSchema: {
            type: "object",
            properties: { query: { type: "string", description: "The search query." } },
            required: ["query"],
          },
          outputSchema: null,
          annotations: null,
        },
        {
          name: "delete_document",
          description: "Permanently remove a document from the corpus. This cannot be undone.",
          inputSchema: {
            type: "object",
            properties: { id: { type: "string", description: "Document id to delete." } },
            required: ["id"],
          },
          outputSchema: null,
          annotations: null,
        },
      ],
    },
    registry: {
      name: "com.example/docs",
      description: "A document search server backed by an indexed corpus of internal documentation.",
      version: "1.2.0",
      published_at: "2026-07-01T00:00:00Z",
      first_published_at: "2025-03-01T00:00:00Z",
      repository_url: "https://github.com/example/docs-mcp",
    },
    ...overrides,
  };
}

describe("rubric helpers", () => {
  it("computes ratios in integer arithmetic", () => {
    expect(ratio(1, 2)).toBe("0.500000");
    expect(ratio(2, 3)).toBe("0.666667");
    expect(ratio(0, 4)).toBe("0.000000");
    expect(ratio(4, 4)).toBe("1.000000");
    expect(() => ratio(1, 0)).toThrow(/denominator/);
  });

  it("recognizes mutating tool names across naming conventions", () => {
    for (const n of ["delete_document", "deleteDocument", "delete-document", "sendEmail", "run_query"]) {
      expect(isMutatingName(n), n).toBe(true);
    }
    for (const n of ["search_docs", "list_items", "get_user", "readFile", "summarize"]) {
      expect(isMutatingName(n), n).toBe(false);
    }
  });

  it("does not mistake a substring for a mutating verb", () => {
    // "updated" contains "update"; whole-word matching is the difference
    // between a finding and a false positive on every read-only tool.
    expect(isMutatingName("get_updated_at")).toBe(false);
    expect(isMutatingName("increate")).toBe(false);
  });

  it("recognizes parameters that ask for a secret", () => {
    for (const n of ["apiKey", "api_key", "token", "password", "private_key"]) {
      expect(isCredentialParam(n), n).toBe(true);
    }
    for (const n of ["query", "tokens_used", "id"]) expect(isCredentialParam(n), n).toBe(false);
  });

  it("ramps maintenance rather than cliffing it", () => {
    expect(maintenanceValue(0)).toBe("1.000000");
    expect(maintenanceValue(90)).toBe("1.000000");
    expect(maintenanceValue(730)).toBe("0.000000");
    expect(maintenanceValue(9999)).toBe("0.000000");
    const mid = Number(maintenanceValue(410));
    expect(mid).toBeGreaterThan(0.45);
    expect(mid).toBeLessThan(0.55);
  });

  it("reads a repository owner as an independence group", () => {
    expect(repositoryOwner("https://github.com/Example/docs-mcp")).toBe("github.com/example");
    expect(repositoryOwner(null)).toBeNull();
    expect(repositoryOwner("not a url")).toBeNull();
  });
});

describe("assessTranscript", () => {
  it("emits a measurement per attempt and per check", () => {
    const obs = assessTranscript(goodTranscript(), AS_OF);
    const dims = new Set(obs.map((o) => o.dimension));
    expect(dims).toEqual(new Set(["availability", "protocol_conformance", "tool_safety", "documentation", "maintenance"]));
    expect(obs.filter((o) => o.dimension === "availability")).toHaveLength(3);
    expect(obs.every((o) => o.value.length > 0)).toBe(true);
  });

  it("emits nothing, rather than a zero, for a check that could not run", () => {
    // The failure mode this guards against: an unreachable server scoring
    // badly on conformance it was never given the chance to demonstrate.
    const unreachable = goodTranscript({
      attempts: [
        { attempt: 1, ts: "2026-07-20T00:00:00Z", reachable: false, status: null, reason: "timeout", elapsedMs: 10_000 },
      ],
      handshake: null,
      tools: null,
    });
    const obs = assessTranscript(unreachable, AS_OF);
    expect(obs.filter((o) => o.dimension === "protocol_conformance")).toHaveLength(0);
    expect(obs.filter((o) => o.dimension === "tool_safety")).toHaveLength(0);
    const availability = obs.filter((o) => o.dimension === "availability");
    expect(availability).toHaveLength(1);
    expect(availability[0]!.value).toBe("0.000000");
  });

  it("does not judge tool schemas when the handshake failed", () => {
    const t = goodTranscript({
      handshake: {
        ok: false,
        protocolVersion: null,
        serverName: null,
        serverVersion: null,
        instructions: null,
        reason: "initialize error: unsupported protocol version",
      },
      tools: null,
    });
    const obs = assessTranscript(t, AS_OF);
    const conformance = obs.filter((o) => o.dimension === "protocol_conformance");
    expect(conformance).toHaveLength(1);
    expect(conformance[0]!.observation_key).toBe("handshake");
    expect(conformance[0]!.value).toBe("0.000000");
  });

  it("flags an undocumented mutating tool", () => {
    const t = goodTranscript();
    t.tools!.declared[1]!.description = null;
    const obs = assessTranscript(t, AS_OF);
    const documented = obs.find((o) => o.observation_key === "mutating_tools_documented")!;
    expect(documented.value).toBe("0.000000");
  });

  it("flags a tool that asks the caller for a credential", () => {
    const t = goodTranscript();
    t.tools!.declared[0]!.inputSchema = {
      type: "object",
      properties: { query: { type: "string", description: "q" }, api_key: { type: "string", description: "key" } },
    };
    const obs = assessTranscript(t, AS_OF);
    expect(obs.find((o) => o.observation_key === "no_credential_parameters")!.value).toBe("0.500000");
  });

  it("flags a schema that constrains nothing", () => {
    const t = goodTranscript();
    t.tools!.declared[0]!.inputSchema = { type: "object" };
    const obs = assessTranscript(t, AS_OF);
    expect(obs.find((o) => o.observation_key === "schemas_constrain_input")!.value).toBe("0.500000");
    expect(obs.find((o) => o.observation_key === "tool_schemas_callable")!.value).toBe("0.500000");
  });

  it("marks the publisher's own description as self-reported", () => {
    const obs = assessTranscript(goodTranscript(), AS_OF);
    const registryDescription = obs.find((o) => o.observation_key === "registry_description")!;
    expect(registryDescription.provenance).toBe("self_reported");
    expect(registryDescription.observer_id).toBe("publisher:com.example/docs");
    // Everything the probe produced is measured.
    for (const o of obs.filter((x) => x.observer_id === "probe:mcp:v1")) {
      expect(o.provenance, o.observation_key).toBe("measured");
    }
  });

  it("is a pure function of the transcript and the as-of time", () => {
    const t = goodTranscript();
    expect(assessTranscript(t, AS_OF)).toEqual(assessTranscript(t, AS_OF));
  });
});

describe("probeMcpServer", () => {
  function jsonResponse(payload: unknown, headers: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json", ...headers },
    });
  }

  const INITIALIZE_RESULT = {
    jsonrpc: "2.0",
    id: 1,
    result: {
      protocolVersion: "2025-06-18",
      serverInfo: { name: "example", version: "1.0.0" },
      instructions: "Use search first.",
      capabilities: { tools: {} },
    },
  };

  const TOOLS_RESULT = {
    jsonrpc: "2.0",
    id: 2,
    result: {
      tools: [
        { name: "search", description: "Search the corpus for matching text.", inputSchema: { type: "object", properties: {} }, outputSchema: null, annotations: null },
      ],
    },
  };

  function serverFetch(): typeof fetch {
    return (async (_url: string | URL, init?: RequestInit) => {
      const body = typeof init?.body === "string" ? (JSON.parse(init.body) as { method: string }) : { method: "" };
      if (body.method === "initialize") return jsonResponse(INITIALIZE_RESULT, { "mcp-session-id": "s-1" });
      if (body.method === "tools/list") return jsonResponse(TOOLS_RESULT);
      return new Response("", { status: 202 });
    }) as unknown as typeof fetch;
  }

  const opts = {
    fetchImpl: serverFetch(),
    nowIso: () => "2026-07-20T00:00:00Z",
    sleep: async () => {},
    attempts: 2,
  };

  it("records a successful handshake and tool listing", async () => {
    const t = await probeMcpServer("https://example.com/mcp", null, opts);
    expect(t.attempts).toHaveLength(2);
    expect(t.attempts.every((a) => a.reachable)).toBe(true);
    expect(t.handshake?.ok).toBe(true);
    expect(t.handshake?.serverName).toBe("example");
    expect(t.tools?.ok).toBe(true);
    expect(t.tools?.declared).toHaveLength(1);
  });

  it("refuses an endpoint the guard blocks, and says so", async () => {
    const t = await probeMcpServer("http://169.254.169.254/mcp", null, opts);
    expect(t.attempts).toHaveLength(1);
    expect(t.attempts[0]!.reachable).toBe(false);
    expect(t.attempts[0]!.reason).toMatch(/refused: blocked host/);
    expect(t.handshake).toBeNull();
  });

  it("records a JSON-RPC error as a failed handshake, not an unreachable server", async () => {
    const failing = (async () =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32602, message: "bad protocol version" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;
    const t = await probeMcpServer("https://example.com/mcp", null, { ...opts, fetchImpl: failing, attempts: 1 });
    expect(t.attempts[0]!.reachable).toBe(true);
    expect(t.handshake?.ok).toBe(false);
    expect(t.handshake?.reason).toMatch(/bad protocol version/);
  });

  it("reads a reply delivered as an event stream", () => {
    const sse = `event: message\ndata: ${JSON.stringify(INITIALIZE_RESULT)}\n\n`;
    const parsed = parseRpcBody(sse, "text/event-stream");
    expect("parseError" in parsed).toBe(false);
    if (!("parseError" in parsed)) {
      expect((parsed.result as { serverInfo: { name: string } }).serverInfo.name).toBe("example");
    }
  });

  it("skips event-stream frames that are not the reply", () => {
    const sse = `data: {"jsonrpc":"2.0","method":"notifications/message"}\n\ndata: ${JSON.stringify(TOOLS_RESULT)}\n\n`;
    const parsed = parseRpcBody(sse, "text/event-stream");
    expect("parseError" in parsed).toBe(false);
    if (!("parseError" in parsed)) expect(readTools(parsed.result)).toHaveLength(1);
  });

  it("reads tool declarations without trusting their shape", () => {
    expect(readTools(null)).toEqual([]);
    expect(readTools({ tools: "nope" })).toEqual([]);
    expect(readTools({ tools: [null, 3, { name: 7 }] })).toEqual([
      { name: "", description: null, inputSchema: null, outputSchema: null, annotations: null },
    ]);
  });
});

describe("listServers", () => {
  function page(servers: unknown[], nextCursor: string | null): Response {
    return new Response(JSON.stringify({ servers, metadata: nextCursor === null ? {} : { next_cursor: nextCursor } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  function entry(name: string, version: string, isLatest: boolean, remote = true): unknown {
    return {
      name,
      description: "A server.",
      version,
      ...(remote ? { remotes: [{ type: "streamable-http", url: `https://${name.replace(/[^a-z]/g, "")}.example.com/mcp` }] } : {}),
      repository: { url: `https://github.com/example/${name.replace(/[^a-z]/g, "")}` },
      _meta: {
        "io.modelcontextprotocol.registry/official": {
          published_at: "2025-01-01T00:00:00Z",
          updated_at: "2026-06-01T00:00:00Z",
          is_latest: isLatest,
        },
      },
    };
  }

  it("counts distinct servers separately from version rows", async () => {
    // The mistake this test exists to prevent: reporting version rows as
    // servers, which once turned 26,906 servers into "90,152".
    const pages = [
      page([entry("a", "1.0.0", false), entry("a", "2.0.0", true)], "c1"),
      page([entry("b", "1.0.0", true)], null),
    ];
    let i = 0;
    const fetchImpl = (async () => pages[i++]!) as unknown as typeof fetch;
    const res = await listServers({ fetchImpl, sleep: async () => {} });
    expect(res.rowCount).toBe(3);
    expect(res.distinctServers).toBe(2);
    expect(res.entries).toHaveLength(2);
    expect(res.entries.find((e) => e.facts.name === "a")!.facts.version).toBe("2.0.0");
  });

  it("keeps only entries with a remote endpoint when asked", async () => {
    const fetchImpl = (async () =>
      page([entry("a", "1.0.0", true, true), entry("b", "1.0.0", true, false)], null)) as unknown as typeof fetch;
    const res = await listServers({ fetchImpl, sleep: async () => {} });
    expect(res.entries.map((e) => e.facts.name)).toEqual(["a"]);
    expect(res.distinctServers).toBe(2);
  });

  it("stops and records a failed page instead of reporting a partial listing as whole", async () => {
    let i = 0;
    const fetchImpl = (async () => {
      i += 1;
      if (i === 1) return page([entry("a", "1.0.0", true)], "c1");
      return new Response("upstream error", { status: 500 });
    }) as unknown as typeof fetch;
    const res = await listServers({ fetchImpl, sleep: async () => {} });
    expect(res.entries).toHaveLength(1);
    expect(res.failures).toHaveLength(1);
    expect(res.failures[0]).toMatch(/HTTP 500/);
  });

  it("marks a listing cut short by the page cap", async () => {
    const fetchImpl = (async () => page([entry("a", "1.0.0", true)], "always-more")) as unknown as typeof fetch;
    const res = await listServers({ fetchImpl, sleep: async () => {}, maxPages: 3 });
    expect(res.pages).toBe(3);
    expect(res.truncated).toBe(true);
  });

  it("skips a row with no usable name", () => {
    expect(parseEntry({ description: "no name" })).toBeNull();
    expect(parseEntry(null)).toBeNull();
    expect(parseEntry(parseEntry({ name: "x" }))).toBeNull();
  });
});

describe("transcript to score", () => {
  it("scores an MCP server through the same engine that scores an on-chain agent", () => {
    const subject = transcriptToSubject(goodTranscript(), { probe: PROBE_IDENTITY, asOfTs: AS_OF });
    expect(subject.kind).toBe("mcp_server");
    expect(subject.profile_id).toBe("mcp_server.v1");

    const { result, canonicalBytes } = scoreSubject(subject);
    expect(JSON.parse(canonicalBytes)).toEqual(result);
    expect(result.composite).not.toBeNull();
    expect(result.lifecycle).toBe("live");

    const byDim = new Map(result.dimensions.map((d) => [d.dimension, d]));
    for (const id of ["availability", "protocol_conformance", "tool_safety"]) {
      expect(byDim.get(id)!.score, id).not.toBeNull();
    }
    // Every attempt fell on one day, so the probe holds one voice and the
    // estimate is shrunk hard toward the prior. A perfect availability run
    // does NOT read as 100, and saying so is the interval's whole job: the
    // score sits above the 55 prior and well below the 100 observation, and
    // the confidence is low because a single day of probing is thin evidence.
    const availability = byDim.get("availability")!;
    expect(availability.score!).toBeGreaterThan(55);
    expect(availability.score!).toBeLessThan(80);
    expect(availability.confidence).toBeLessThan(0.5);
    expect(availability.coverage_tier).toBe("thin");
    // Maintenance rests on a single recency measurement. It clears the
    // suppression floor and is published as thin, with a wide interval, which
    // is the honest reading of one observation rather than a withheld one.
    const maintenance = byDim.get("maintenance")!;
    expect(maintenance.observation_count).toBe(1);
    expect(maintenance.coverage_tier).toBe("thin");
    expect(maintenance.score_high! - maintenance.score_low!).toBeGreaterThan(20);
    // Documentation carries the publisher's own claim alongside the probe's
    // measurements, and the cap holds that claim to a minority share.
    expect(byDim.get("documentation")!.self_reported_share).toBeLessThanOrEqual(0.4001);
  });

  it("separates a genuinely good server from a failing one across a real probe window", () => {
    // The single-day transcript above cannot tell them apart, which is the
    // honest answer for a single day. Probing daily is what buys separation.
    // The window ends the day before as_of on purpose: availability decays on
    // a 14-day half-life, so a fortnight of probing that stopped two weeks ago
    // is deliberately worth about half of one that ran up to yesterday.
    const window = (reachable: boolean): ProbeTranscript =>
      goodTranscript({
        attempts: Array.from({ length: 14 }, (_, i) => ({
          attempt: i + 1,
          ts: `2026-07-${String(18 + i).padStart(2, "0")}T00:00:00Z`,
          reachable,
          status: reachable ? 200 : null,
          reason: reachable ? null : "timeout",
          elapsedMs: 120,
        })),
      });
    const scoreOf = (t: ProbeTranscript) =>
      scoreSubject(transcriptToSubject(t, { probe: PROBE_IDENTITY, asOfTs: AS_OF })).result.dimensions.find(
        (d) => d.dimension === "availability",
      )!;
    const up = scoreOf(window(true));
    const down = scoreOf(window(false));
    // Never 100 and never 0: fourteen days of probing is real evidence but not
    // proof, so the estimate stays inside the prior's pull. What matters is
    // that the two are now far apart and the interval says why.
    expect(up.score!).toBeGreaterThan(80);
    expect(down.score!).toBeLessThan(20);
    expect(up.score! - down.score!).toBeGreaterThan(60);
    expect(up.confidence).toBeGreaterThan(0.5);
    expect(up.n_eff).toBeGreaterThan(8);
    // Confidence is still only moderate after a fortnight, which is the point
    // of publishing it: nothing here claims more certainty than it has.
    expect(up.confidence).toBeLessThan(0.8);
  });

  it("rates an unreachable server on availability alone and withholds the composite", () => {
    const t = goodTranscript({
      attempts: [
        { attempt: 1, ts: "2026-07-20T00:00:00Z", reachable: false, status: null, reason: "timeout", elapsedMs: 10_000 },
        { attempt: 2, ts: "2026-07-20T00:00:01Z", reachable: false, status: null, reason: "timeout", elapsedMs: 10_000 },
      ],
      handshake: null,
      tools: null,
    });
    const subject = transcriptToSubject(t, { probe: PROBE_IDENTITY, asOfTs: AS_OF });
    const { result } = scoreSubject(subject);
    expect(subject.reachable).toBe(false);
    // Two failed attempts on one day is one sample, so the estimate is pulled
    // most of the way back toward the prior. It reads as "below average, and
    // we barely know", not as a confident zero, which is correct for one day.
    const availability = result.dimensions.find((d) => d.dimension === "availability")!;
    expect(availability.score!).toBeLessThan(55);
    expect(availability.confidence).toBeLessThan(0.5);
    // 0.25 of the profile is under the 0.60 coverage floor, so no headline
    // number: an unreachable server has not been rated, it has been found
    // unreachable.
    expect(result.composite).toBeNull();
    expect(result.composite_suppression_reason).toMatch(/too little of the profile/);
  });

  it("is deterministic: the same transcript yields the same bytes", () => {
    const build = () => transcriptToSubject(goodTranscript(), { probe: PROBE_IDENTITY, asOfTs: AS_OF });
    expect(scoreSubject(build()).canonicalBytes).toBe(scoreSubject(build()).canonicalBytes);
  });

  it("cannot be moved by a publisher's own description", () => {
    const withClaim = goodTranscript();
    const withoutClaim = goodTranscript({
      registry: { ...goodTranscript().registry!, description: null },
    });
    const scoreOf = (t: ProbeTranscript): number | null =>
      scoreSubject(transcriptToSubject(t, { probe: PROBE_IDENTITY, asOfTs: AS_OF })).result.composite;
    // The publisher's claim is admissible on documentation and capped there,
    // and documentation has no independent measurement in this transcript
    // besides the probe's, so the claim moves the composite by nothing
    // material either way.
    const withA = scoreOf(withClaim)!;
    const withoutA = scoreOf(withoutClaim)!;
    expect(Math.abs(withA - withoutA)).toBeLessThan(1);
  });
});

describe("gates from a real transcript", () => {
  it("caps a server whose tool asks the caller for an API key", () => {
    const t = goodTranscript();
    t.tools!.declared[0]!.inputSchema = {
      type: "object",
      properties: {
        query: { type: "string", description: "The search query." },
        api_key: { type: "string", description: "Your API key." },
      },
      required: ["query", "api_key"],
    };
    const clean = scoreSubject(transcriptToSubject(goodTranscript(), { probe: PROBE_IDENTITY, asOfTs: AS_OF })).result;
    const flagged = scoreSubject(transcriptToSubject(t, { probe: PROBE_IDENTITY, asOfTs: AS_OF })).result;

    expect(clean.gates_fired).toHaveLength(0);
    expect(flagged.gates_fired.map((g) => g.gate_id)).toEqual(["mcp.credential_parameter"]);
    expect(flagged.composite!).toBeLessThanOrEqual(45);
    expect(flagged.composite!).toBeLessThan(clean.composite!);
    // The reason is published verbatim, so a reader sees what was found rather
    // than only a lower number.
    expect(flagged.gates_fired[0]!.reason).toMatch(/credential/);
  });

  it("caps a server with an undocumented destructive tool", () => {
    const t = goodTranscript();
    t.tools!.declared[1]!.description = null;
    const { result } = scoreSubject(transcriptToSubject(t, { probe: PROBE_IDENTITY, asOfTs: AS_OF }));
    expect(result.gates_fired.map((g) => g.gate_id)).toEqual(["mcp.undocumented_destructive_tool"]);
    expect(result.composite!).toBeLessThanOrEqual(60);
  });

  it("emits both the rate and the occurrence, because they answer different questions", () => {
    // One undescribed delete tool among fifty well-described tools is a ratio
    // of 0.98 and a hazard of 1. The average needs the first; the gate needs
    // the second.
    const t = goodTranscript();
    t.tools!.declared = [
      ...Array.from({ length: 20 }, (_, i) => ({
        name: `search_${i}`,
        description: "Search the indexed document corpus and return matching passages.",
        inputSchema: { type: "object", properties: { q: { type: "string", description: "query" } } },
        outputSchema: null,
        annotations: null,
      })),
      { name: "delete_everything", description: null, inputSchema: { type: "object", properties: {} }, outputSchema: null, annotations: null },
    ];
    const obs = assessTranscript(t, AS_OF);
    expect(obs.find((o) => o.observation_key === "mutating_tools_documented")!.value).toBe("0.000000");
    expect(obs.find((o) => o.observation_key === "undocumented_mutating_tool_present")!.value).toBe("0.000000");
    const { result } = scoreSubject(transcriptToSubject(t, { probe: PROBE_IDENTITY, asOfTs: AS_OF }));
    expect(result.gates_fired.map((g) => g.gate_id)).toContain("mcp.undocumented_destructive_tool");
  });

  it("carries tags without letting them touch the score", () => {
    const options = { probe: PROBE_IDENTITY, asOfTs: AS_OF };
    const plain = scoreSubject(transcriptToSubject(goodTranscript(), options));
    const tagged = scoreSubject(
      transcriptToSubject(goodTranscript(), { ...options, tags: ["search", "documentation", "search"] }),
    );
    expect(transcriptToSubject(goodTranscript(), { ...options, tags: ["b", "a", "a"] }).tags).toEqual(["a", "b"]);
    expect(tagged.canonicalBytes).toBe(plain.canonicalBytes);
  });
});

describe("run histories", () => {
  function day(d: number, up: boolean, tools = goodTranscript().tools!.declared): ProbeTranscript {
    const ts = `2026-07-${String(d).padStart(2, "0")}T00:00:00Z`;
    return goodTranscript({
      probed_at: ts,
      attempts: [{ attempt: 1, ts, reachable: up, status: up ? 200 : null, reason: up ? null : "timeout", elapsedMs: 120 }],
      handshake: up ? goodTranscript().handshake : null,
      tools: up ? { ok: true, declared: tools, reason: null } : null,
    });
  }
  const history = (n: number, up = true): ProbeTranscript[] =>
    Array.from({ length: n }, (_, i) => day(31 - n + 1 + i, up));

  it("publishes every dimension once a run history exists, where one run cannot", () => {
    // Found by a worked example. Scoring a single run left every dimension
    // except availability resting on one observation, below the suppression
    // floor, and the composite was withheld for want of coverage. The fix is
    // more days, not a looser floor.
    const one = scoreSubject(transcriptsToSubject(history(1), { probe: PROBE_IDENTITY, asOfTs: AS_OF })).result;
    const many = scoreSubject(transcriptsToSubject(history(21), { probe: PROBE_IDENTITY, asOfTs: AS_OF })).result;

    expect(many.dimension_coverage).toBe(1);
    expect(many.composite).not.toBeNull();
    expect(many.composite!).toBeGreaterThan(one.composite!);
    // More days is more evidence, and the interval says so.
    expect(many.composite_confidence).toBeGreaterThan(one.composite_confidence * 3);
    for (const d of many.dimensions) expect(d.n_eff, d.dimension).toBeGreaterThan(5);
  });

  it("does not penalize the probe for measuring many subjects a day", () => {
    // The velocity signal is about opinions produced faster than they can be
    // formed. A harness measuring 400 endpoints a day is doing its job, and
    // penalizing throughput would mean the more of the world we cover, the
    // less any of it counts.
    const busy = { ...PROBE_IDENTITY, max_observations_single_day: 4000 };
    const quiet = { ...PROBE_IDENTITY, max_observations_single_day: 3 };
    const scoreWith = (probe: typeof PROBE_IDENTITY) =>
      scoreSubject(transcriptsToSubject(history(21), { probe, asOfTs: AS_OF })).result.composite;
    expect(scoreWith(busy)).toBe(scoreWith(quiet));
  });

  it("keeps a check name stable across runs, so gates still match", () => {
    // The other half of the same bug. Namespacing observation keys per run
    // preserved the daily samples and silently stopped every gate matching.
    const withFinding = history(21).map((t) => ({
      ...t,
      tools: {
        ok: true,
        reason: null,
        declared: [
          { ...goodTranscript().tools!.declared[0]!, inputSchema: { type: "object", properties: { api_key: { type: "string", description: "key" } } } },
          goodTranscript().tools!.declared[1]!,
        ],
      },
    }));
    const subject = transcriptsToSubject(withFinding, { probe: PROBE_IDENTITY, asOfTs: AS_OF });
    const keys = subject.observations.filter((o) => o.observation_key === "credential_parameter_present");
    expect(keys).toHaveLength(21);
    // 21 distinct timestamps, one shared key: identity is the check AT A MOMENT.
    expect(new Set(keys.map((o) => o.ts)).size).toBe(21);
    const { result } = scoreSubject(subject);
    expect(result.gates_fired.map((g) => g.gate_id)).toEqual(["mcp.credential_parameter"]);
    expect(result.composite!).toBeLessThanOrEqual(45);
  });

  it("still collapses a genuinely duplicated run", () => {
    const once = transcriptsToSubject(history(5), { probe: PROBE_IDENTITY, asOfTs: AS_OF });
    const twice = transcriptsToSubject([...history(5), ...history(5)], { probe: PROBE_IDENTITY, asOfTs: AS_OF });
    expect(scoreSubject(twice).canonicalBytes).toBe(scoreSubject(once).canonicalBytes);
  });

  it("refuses transcripts for different endpoints", () => {
    const other = { ...day(20, true), endpoint: "https://elsewhere.example.com/mcp" };
    expect(() =>
      transcriptsToSubject([day(19, true), other], { probe: PROBE_IDENTITY, asOfTs: AS_OF }),
    ).toThrow(/span 2 endpoints/);
    expect(() => transcriptsToSubject([], { probe: PROBE_IDENTITY, asOfTs: AS_OF })).toThrow(/no transcripts/);
  });
});
