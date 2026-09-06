/**
 * Which tools we probe.
 *
 * Every test here is a regression against one of three shipped defects, all of
 * which were replayed over the 600 persisted transcripts before being fixed:
 *
 *   1. Tools were taken IN DECLARATION ORDER, so the operator chose what we
 *      tested. `ai.mitosislabs_mitosis` declares six private-memory reads that
 *      all return 401 before it declares the three public tools that need no
 *      sign-in at all, and the server was recorded as entirely un-ratable.
 *   2. The per-shape cap was GLOBAL and printed nothing. 36 of 161 eligible
 *      servers were probed and 125 got zero tools; at three tools per server it
 *      was 22 probed and 139 starved.
 *   3. `maxToolsPerServer` defaulted to 1 while the comment above it argued for
 *      3, so a hostile tool anywhere but first was never called — the exact
 *      dilution the occurrence gates exist to catch.
 */
import { describe, expect, it } from "vitest";
import {
  describeSelection,
  diversityGroup,
  informativeness,
  MAX_TOOLS_PER_SERVER,
  readsCallerOwnedData,
  selectToolsForAssessment,
  type SelectionInput,
} from "../src/mcp/select.js";
import type { ProbeTranscript, ToolDeclaration } from "../src/mcp/transcript.js";

const SEED = { TRUST_INDEX_PROBE_SEED: "test-seed-that-is-long-enough-to-count" } as NodeJS.ProcessEnv;
const OTHER_SEED = { TRUST_INDEX_PROBE_SEED: "a-completely-different-test-seed-value" } as NodeJS.ProcessEnv;

function tool(over: Partial<ToolDeclaration> & { name: string }): ToolDeclaration {
  return {
    description: "Look up a record in the published catalogue and return what was found.",
    inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    outputSchema: null,
    annotations: { readOnlyHint: true },
    ...over,
  };
}

function server(name: string, declared: ToolDeclaration[]): SelectionInput {
  return {
    server: name,
    transcript: {
      transcript_version: "1",
      probe_id: "probe:mcp:v1",
      endpoint: `https://${name}.example.com/mcp`,
      probed_at: "2026-09-01T00:00:00Z",
      attempts: [],
      handshake: { ok: true, protocolVersion: "2025-06-18", serverName: name, serverVersion: "1", instructions: null, reason: null },
      tools: { ok: true, declared, reason: null },
      registry: null,
      auth: { required: false, status: 200, scheme: null },
    } satisfies ProbeTranscript,
  };
}

const names = (r: ReturnType<typeof selectToolsForAssessment>): string[] =>
  r.selected.map((s) => s.declaration.name).sort();

// ---------------------------------------------------------------------------
// Defect 1: declaration order must not decide what we test.
// ---------------------------------------------------------------------------

describe("the operator does not choose what we test", () => {
  /**
   * The mitosis shape, reduced to its essentials: the tools that cannot tell us
   * anything are declared first, the tools that can are declared last.
   */
  const mitosisShaped = [
    tool({
      name: "cortex_ask",
      description: "Searches the user's real, private memory — the email, calendar, files and notes they have connected.",
    }),
    tool({
      name: "cortex_recall",
      description: "Semantic-only vector search over the user's memory, returning source excerpts from their documents.",
    }),
    tool({
      name: "cortex_manifest",
      description: "A table of contents for this user's memory: which sources are connected and how many items each holds.",
      inputSchema: { type: "object", properties: {}, required: [] },
    }),
    tool({
      name: "search_docs",
      description: "Keyword-search the published product documentation. Returns ranked results with URLs, for any how-do-I question.",
    }),
    tool({
      name: "list_skills",
      description: "List the agent skills this platform publishes, with a link to each manifest. Needs no sign-in of any kind.",
      inputSchema: { type: "object", properties: {}, required: [] },
    }),
    tool({
      name: "get_platform_status",
      description: "Operational status of the website, API and MCP server. Use before reporting an outage or debugging connectivity.",
      inputSchema: { type: "object", properties: {}, required: [] },
    }),
  ];

  it("reaches the no-sign-in tools declared last, which the old loop never called", () => {
    const r = selectToolsForAssessment([server("mitosis", mitosisShaped)], { env: SEED });
    expect(r.selected).toHaveLength(3);
    // The whole point. Positional selection took cortex_ask, cortex_recall and
    // cortex_manifest and rated the server un-ratable on three 401s.
    expect(names(r)).toEqual(["get_platform_status", "list_skills", "search_docs"]);
  });

  it("selects the same tools however the operator orders the list", () => {
    const forwards = selectToolsForAssessment([server("mitosis", mitosisShaped)], { env: SEED });
    const backwards = selectToolsForAssessment([server("mitosis", [...mitosisShaped].reverse())], { env: SEED });
    const rotated = selectToolsForAssessment(
      [server("mitosis", [...mitosisShaped.slice(4), ...mitosisShaped.slice(0, 4)])],
      { env: SEED },
    );
    expect(names(backwards)).toEqual(names(forwards));
    expect(names(rotated)).toEqual(names(forwards));
  });

  it("does not let a tool jump the queue by being declared first", () => {
    const weak = tool({
      name: "aaa_first_in_the_list",
      description: "Short.",
      inputSchema: { type: "object", properties: { api_key: { type: "string" } }, required: ["api_key"] },
    });
    const r = selectToolsForAssessment([server("s", [weak, ...mitosisShaped])], { env: SEED, perServer: 3 });
    expect(names(r)).not.toContain("aaa_first_in_the_list");
  });
});

// ---------------------------------------------------------------------------
// Defect 3: one tool cannot answer "is there a bad tool in here".
// ---------------------------------------------------------------------------

describe("the per-server budget matches the reasoning written next to it", () => {
  it("defaults to three, not one", () => {
    expect(MAX_TOOLS_PER_SERVER).toBe(3);
  });

  it("probes three tools of a wide surface by default", () => {
    const wide = Array.from({ length: 20 }, (_, i) =>
      tool({ name: `search_corpus_${i}`, description: `Search partition ${i} of the published corpus and return matching records.` }),
    );
    const r = selectToolsForAssessment([server("wide", wide)], { env: SEED });
    expect(r.selected).toHaveLength(3);
  });

  it("takes fewer than the budget when the server has fewer eligible tools", () => {
    const r = selectToolsForAssessment([server("small", [tool({ name: "search_things" })])], { env: SEED });
    expect(r.selected).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Defect 2: a global budget must not starve servers, and never in silence.
// ---------------------------------------------------------------------------

describe("every eligible server gets its allotment", () => {
  const population = Array.from({ length: 40 }, (_, i) =>
    server(`srv${String(i).padStart(2, "0")}`, [
      tool({ name: "search_records", description: "Search the published record set and return ranked matches with identifiers." }),
      tool({ name: "get_record", description: "Fetch one published record by its identifier and return the whole thing." }),
      tool({ name: "list_categories", description: "List every category in the published catalogue, with counts.", inputSchema: { type: "object", properties: {}, required: [] } }),
    ]),
  );

  it("probes all of them when no global cap is set", () => {
    const r = selectToolsForAssessment(population, { env: SEED });
    expect(new Set(r.selected.map((s) => s.server)).size).toBe(40);
    expect(r.selected).toHaveLength(120);
    expect(r.starvedByGlobalCap).toEqual([]);
  });

  it("spends a global cap breadth-first, so a cap of 40 gives 40 servers one tool each rather than 13 servers three", () => {
    const r = selectToolsForAssessment(population, { env: SEED, perShape: 40 });
    // Every shape here is `retrieval`, so 40 is the whole budget.
    expect(r.selected).toHaveLength(40);
    expect(new Set(r.selected.map((s) => s.server)).size).toBe(40);
    expect(r.starvedByGlobalCap).toEqual([]);
    // What each server kept is its FIRST choice, not an arbitrary one.
    expect(r.selected.every((s) => s.rankInServer === 1)).toBe(true);
  });

  it("reports every server the cap takes tools from, and every server it zeroes", () => {
    const r = selectToolsForAssessment(population, { env: SEED, perShape: 10 });
    expect(r.selected).toHaveLength(10);
    expect(r.starvedByGlobalCap).toHaveLength(30);
    expect(r.trimmedByGlobalCap).toHaveLength(40);
    // Dropping to zero is an event, not an absence: it names the server.
    for (const e of r.starvedByGlobalCap) {
      expect(e.kept).toBe(0);
      expect(e.dropped).toBeGreaterThan(0);
      expect(e.server).toMatch(/^srv\d\d$/);
    }
  });

  it("prints the starvation rather than swallowing it", () => {
    const r = selectToolsForAssessment(population, { env: SEED, perShape: 10 });
    const printed = describeSelection(r, 10).join("\n");
    expect(printed).toContain("SERVERS DROPPED TO ZERO TOOLS");
    for (const e of r.starvedByGlobalCap) expect(printed).toContain(e.server);
  });

  it("says so, in as many words, when there is no global cap", () => {
    const r = selectToolsForAssessment(population, { env: SEED });
    expect(describeSelection(r, null).join("\n")).toContain("every eligible server keeps its full allotment");
  });
});

// ---------------------------------------------------------------------------
// Tie-breaks.
// ---------------------------------------------------------------------------

describe("ties are broken by the seed, not by anything an operator controls", () => {
  /** Six tools that score identically, so only the tie-break separates them. */
  const identical = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot"].map((n) =>
    tool({ name: `list_${n}`, description: "List every published entry of this kind, with counts and identifiers." }),
  );

  it("is reproducible under the same seed", () => {
    const a = selectToolsForAssessment([server("s", identical)], { env: SEED });
    const b = selectToolsForAssessment([server("s", identical)], { env: SEED });
    expect(names(b)).toEqual(names(a));
  });

  it("moves under a different seed, so it is not a constant an operator can read off", () => {
    const a = selectToolsForAssessment([server("s", identical)], { env: SEED });
    const b = selectToolsForAssessment([server("s", identical)], { env: OTHER_SEED });
    expect(names(b)).not.toEqual(names(a));
  });

  it("is not alphabetical, and not positional", () => {
    const r = selectToolsForAssessment([server("s", identical)], { env: SEED });
    const alphabetical = identical.map((t) => t.name).sort().slice(0, 3);
    expect(names(r)).not.toEqual(alphabetical);
    const positional = identical.slice(0, 3).map((t) => t.name).sort();
    expect(names(r)).not.toEqual(positional);
  });

  it("depends on the endpoint too, so one server's ordering does not reveal another's", () => {
    const one = selectToolsForAssessment([server("one", identical)], { env: SEED });
    const two = selectToolsForAssessment([server("two", identical)], { env: SEED });
    expect(names(two)).not.toEqual(names(one));
  });
});

// ---------------------------------------------------------------------------
// The ranking itself.
// ---------------------------------------------------------------------------

describe("informativeness ranks by what a probe could establish", () => {
  const base = tool({ name: "search_catalogue" });

  it("demotes a tool whose required parameter is a credential, because it will 401 whatever we send", () => {
    const credentialed = tool({
      name: "search_catalogue",
      inputSchema: { type: "object", properties: { api_key: { type: "string" }, query: { type: "string" } }, required: ["api_key", "query"] },
    });
    expect(informativeness(credentialed).score).toBeLessThan(informativeness(base).score);
  });

  it("catches a credential named by its description rather than its name", () => {
    const laundered = tool({
      name: "search_catalogue",
      inputSchema: { type: "object", properties: { k: { type: "string", description: "Your API key." }, query: { type: "string" } }, required: ["k", "query"] },
    });
    expect(informativeness(laundered).score).toBeLessThan(informativeness(base).score);
  });

  it("promotes a declared output schema, which is what makes the response checkable", () => {
    const schemad = tool({ name: "search_catalogue", outputSchema: { type: "object", properties: { hits: {} }, required: ["hits"] } });
    expect(informativeness(schemad).score).toBeGreaterThan(informativeness(base).score);
  });

  it("prefers a free-text parameter over an identifier, because three battery arms vary it", () => {
    const freeText = tool({ name: "search_catalogue" });
    const identifier = tool({
      name: "get_catalogue_entry",
      inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    });
    expect(informativeness(freeText).score).toBeGreaterThan(informativeness(identifier).score);
  });

  it("rewards a description long enough to derive an expected shape from", () => {
    const terse = tool({ name: "search_catalogue", description: "Searches." });
    expect(informativeness(terse).score).toBeLessThan(informativeness(base).score);
  });

  it("demotes a tool that says it reads the caller's own data, which we do not have", () => {
    const ownAccount = tool({
      name: "search_catalogue",
      description: "Search the user's own private memory — their email, calendar and documents — and return ranked matches.",
    });
    expect(informativeness(ownAccount).score).toBeLessThan(informativeness(base).score);
  });
});

describe("reading the caller's own data, from the description alone", () => {
  it.each([
    ["straight apostrophe", "Search the user's own private memory and return ranked matches."],
    ["curly apostrophe", "Retrieve the full contents of a single item from the user’s memory by its id."],
    ["your", "List the sites in your workspace, with their deployment state."],
    ["their", "Read the entries in their food diary for one day."],
    ["account's", "Search across the account's sites for a phrase."],
  ])("%s", (_label, description) => {
    expect(readsCallerOwnedData(description)).not.toBeNull();
  });

  it.each([
    ["a public catalogue", "Keyword-search the published product documentation. Returns ranked results with URLs."],
    ["platform status", "Get the operational status of the website, API and MCP server."],
    ["pricing", "Get current plans, prices, credit allowances, metered rates and add-ons."],
    // The window stops at a clause boundary; without that this matched across
    // the semicolon and read as a library belonging to the user.
    ["a possessive that ends before the noun", "Phrasing it in the user's own words is fine; it is matched against the whole library."],
  ])("does not fire on %s", (_label, description) => {
    expect(readsCallerOwnedData(description)).toBeNull();
  });
});

describe("a server's budget is not spent on three of the same tool", () => {
  it("prefers variety when the alternatives are close", () => {
    const siblings = [
      tool({ name: "cortex_ask", description: "Ask a question of the indexed corpus and get a fused answer with provenance and citations." }),
      tool({ name: "cortex_recall", description: "Semantic-only vector search over the indexed corpus, returning ranked source excerpts." }),
      tool({ name: "cortex_manifest", description: "A table of contents for the indexed corpus: which sources exist and how many items each holds." }),
      tool({ name: "cortex_status", description: "Ingest and embed counts for the indexed corpus, plus the last sync time of each source." }),
      tool({ name: "search_docs", description: "Keyword-search the published product documentation. Returns ranked results with URLs." }),
      tool({ name: "list_skills", description: "List the agent skills this platform publishes, with a link to each manifest.", inputSchema: { type: "object", properties: {}, required: [] } }),
    ];
    const r = selectToolsForAssessment([server("s", siblings)], { env: SEED });
    const cortex = r.selected.filter((s) => s.declaration.name.startsWith("cortex_"));
    // Four siblings that all score 15 against one other tool that also scores
    // 15 and one that scores 12. The discount is not a ban: the family can hold
    // a second slot by being genuinely better, and here 15 - 2.5 does beat 12.
    // What it may not do is take the whole budget while other families wait.
    expect(cortex.length).toBeLessThan(3);
    expect(names(r)).toContain("search_docs");
  });

  it("groups by shape and leading word", () => {
    const t = tool({ name: "cortex_ask" });
    expect(diversityGroup(t, "retrieval")).toBe("retrieval|cortex");
    expect(diversityGroup(tool({ name: "getPlatformStatus" }), "retrieval")).toBe("retrieval|get");
  });

  it("still fills the budget when the whole surface is one group", () => {
    const allGet = Array.from({ length: 5 }, (_, i) =>
      tool({ name: `get_record_${i}`, description: `Fetch published record set ${i} and return every field of it.` }),
    );
    expect(selectToolsForAssessment([server("s", allGet)], { env: SEED }).selected).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Eligibility must agree with the code that will make the call.
// ---------------------------------------------------------------------------

describe("we never select something callTool would refuse", () => {
  it("skips a mutating tool however it is annotated", () => {
    const r = selectToolsForAssessment(
      [server("s", [tool({ name: "delete_record", annotations: { readOnlyHint: true } }), tool({ name: "search_records" })])],
      { env: SEED },
    );
    expect(names(r)).toEqual(["search_records"]);
  });

  it("skips a server behind an auth wall, and says why", () => {
    const s = server("walled", [tool({ name: "search_records" })]);
    s.transcript.auth = { required: true, status: 401, scheme: null };
    const r = selectToolsForAssessment([s], { env: SEED });
    expect(r.selected).toEqual([]);
    expect(r.skippedServers[0]?.reason).toContain("authentication");
  });

  it("records a server whose tools are all ineligible rather than dropping it silently", () => {
    const r = selectToolsForAssessment([server("s", [tool({ name: "delete_everything" })])], { env: SEED });
    expect(r.selected).toEqual([]);
    expect(r.noEligibleTools).toEqual([{ server: "s", endpoint: "https://s.example.com/mcp", declared: 1 }]);
  });
});

describe("the retry-dead filter still narrows the set", () => {
  it("considers only the named tools, and ranks within them", () => {
    const s = server("s", [
      tool({ name: "search_records" }),
      tool({ name: "get_record", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } }),
      tool({ name: "list_categories", inputSchema: { type: "object", properties: {}, required: [] } }),
    ]);
    const r = selectToolsForAssessment([s], {
      env: SEED,
      only: (_endpoint, name) => name === "get_record",
    });
    expect(names(r)).toEqual(["get_record"]);
  });
});
