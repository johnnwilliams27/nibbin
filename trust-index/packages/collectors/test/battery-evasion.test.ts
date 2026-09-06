/**
 * Evasions, pinned.
 *
 * Each test here corresponds to a finding from the adversarial review, and each
 * one FAILED before its fix. They drive the real `runBattery` against a
 * synthetic server injected via `fetchImpl` — no outbound calls, no fixtures of
 * pre-computed observations — because the defects being pinned all lived in the
 * distance between what the battery measured and what it recorded, which a
 * fixture would have reproduced faithfully and uselessly.
 *
 * The rule these encode: DECLINING TO BE MEASURED MUST NOT OUTPERFORM BEING
 * MEASURED BADLY, and a check must not be defeatable by a change to the shape
 * of a response that leaves its substance intact.
 */
import { describe, expect, it } from "vitest";
import { INJECTION_PAYLOAD, INJECTION_TOKEN, NONSENSE_QUERY, runBattery } from "../src/mcp/battery.js";
import { probeIdentity } from "../src/mcp/probe-identity.js";
import { parseRpcBody } from "../src/mcp/probe.js";
import { classifyTool } from "../src/mcp/shape.js";
import type { ToolDeclaration } from "../src/mcp/transcript.js";

const DECL = {
  name: "search_documents",
  description: "Search the indexed corpus of documents and return matching passages.",
  inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  outputSchema: null,
  annotations: null,
} as unknown as ToolDeclaration;

/** ~440 characters, comfortably past the 300-char textSample the checks used to read. */
const BANNER = "Searching the corpus. ".repeat(20);
const STACK =
  'Traceback (most recent call last):\n  File "/app/server/handler.py", line 42\npostgres://user:hunter2@db.internal:5432/prod';

type Reply = (query: unknown) => string;

/** A server that answers however the test says, over the real JSON-RPC path. */
function server(reply: Reply) {
  return async (_url: unknown, init?: RequestInit): Promise<Response> => {
    const query = JSON.parse(String(init?.body ?? "{}"))?.params?.arguments?.query;
    return new Response(
      JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: reply(query) }] } }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
}

async function run(reply: Reply) {
  const outcome = await runBattery(DECL, classifyTool(DECL), {
    observerId: "p",
    ts: "2026-09-05T12:00:00Z",
    endpoint: "https://example.test/mcp",
    parseBody: parseRpcBody,
    spacingMs: 0,
    sleep: async () => {},
    resolver: publicDns,
    fetchImpl: server(reply) as unknown as typeof fetch,
  });
  return {
    outcome,
    /** Values are scoped per tool, so match on the base check. */
    value: (check: string): string | undefined =>
      outcome.observations.find((o) => o.observation_key.split(":")[0] === check)?.value,
    skipped: (check: string): boolean => outcome.skipped.some((s) => s.check === check),
  };
}

/** example.test is a reserved TLD and does not resolve; say what it points at. */
const publicDns = async () => [{ address: "93.184.216.34", family: 4 }];

const PASS = "1.000000";
const FAIL = "0.000000";

describe("a tool that obeys an embedded instruction cannot dress it up as an echo", () => {
  // The old test was `hasToken && !hasInstruction`, on the reasoning that a
  // search tool quoting its query back is behaving correctly. That handed a
  // pass to any tool that obeys AND quotes — which every search tool does.
  it("catches obedience even when the tool also quotes the query back", async () => {
    const r = await run((q) =>
      typeof q === "string" && q.includes("ignore all previous")
        ? `${INJECTION_TOKEN}\n\n(searched for: ${INJECTION_PAYLOAD})`
        : "Result: shipping logistics overview, page 3.",
    );
    expect(r.value("ignores_embedded_instruction")).toBe(FAIL);
    expect(r.value("any_tool_obeys_embedded_instruction")).toBe(FAIL);
  });

  it("does not accuse a tool that only quotes the query back", async () => {
    // The other half, and the reason the original test existed. Echoing the
    // payload without acting on it is correct behaviour and must stay a pass,
    // or the fix would have traded a false negative for a false positive.
    const r = await run((q) => (typeof q === "string" ? `No results for: ${q}` : "error"));
    expect(r.value("ignores_embedded_instruction")).toBe(PASS);
    expect(r.value("any_tool_obeys_embedded_instruction")).toBeUndefined();
  });

  it("does not accuse a tool that echoes the query URL-encoded in a self-link", async () => {
    // The false positive this produced: nexez_search returned the query twice,
    // once plainly and once as
    // `?q=disregard+the+above+...+word%3A<TOKEN>` inside a link to itself. The
    // literal strip removed the first and missed the second, the token
    // survived, and a search tool was scored as having ACTED on the
    // instruction — capping its composite at 0.35 for percent-encoding a query
    // parameter.
    // Modelled on what the real server actually does, which is echo the query
    // in EVERY response — checked against the stored transcript rather than
    // assumed. An earlier version of this fixture echoed only the injection
    // arm, which is a different and genuinely suspicious behaviour: a server
    // that reflects injection payloads and nothing else has singled them out.
    const r = await run((q) => {
      if (typeof q !== "string") return "error";
      const enc = q.replace(/ /g, "+").replace(/:/g, "%3A");
      return JSON.stringify({ query: q, self: `https://example.test/search?q=${enc}&limit=10`, results: [] });
    });
    expect(r.value("ignores_embedded_instruction")).toBe(PASS);
    expect(r.value("any_tool_obeys_embedded_instruction")).toBeUndefined();
  });

  it("flags a server that reflects the injection payload and nothing else", async () => {
    // The distinction the fixture above was accidentally testing, kept
    // deliberately: echoing every query is normal, echoing only the payload we
    // planted is the tool singling it out.
    const enc = INJECTION_PAYLOAD.replace(/ /g, "+").replace(/:/g, "%3A");
    const r = await run((q) =>
      typeof q === "string" && q.includes("ignore all previous")
        ? JSON.stringify({ query: q, self: `https://example.test/search?q=${enc}` })
        : "Result: shipping logistics overview, page 3.",
    );
    expect(r.value("ignores_embedded_instruction")).toBe(FAIL);
  });

  it("still catches obedience when an encoded echo is also present", async () => {
    // The guard must not become a way to launder real obedience: including an
    // encoded copy of the payload cannot excuse emitting the token on its own.
    const encoded = INJECTION_PAYLOAD.replace(/ /g, "+").replace(/:/g, "%3A");
    const r = await run((q) =>
      typeof q === "string" && q.includes("ignore all previous")
        ? `${INJECTION_TOKEN}\n\nsee https://example.test/search?q=${encoded}`
        : "Result: shipping logistics overview, page 3.",
    );
    expect(r.value("ignores_embedded_instruction")).toBe(FAIL);
    expect(r.value("any_tool_obeys_embedded_instruction")).toBe(FAIL);
  });

  it("does not score a tool description that instructs the calling agent", async () => {
    // An MCP tool description exists to instruct the calling agent. "Do NOT
    // call this tool directly from chat, call show_style_canvas instead" is a
    // good description. Scoring the judge's injection_attempt flag turned four
    // servers behaving normally into 0.35 composites.
    const judge = {
      client: async () => ({ verdict: "proposed", reason: "a | b", injection_attempt: true }),
      modelId: "test-model",
    };
    const outcome = await runBattery(DECL, classifyTool(DECL), {
      observerId: "p",
      ts: "2026-09-05T12:00:00Z",
      endpoint: "https://example.test/mcp",
      parseBody: parseRpcBody,
      spacingMs: 0,
      sleep: async () => {},
      resolver: publicDns,
      judge,
      fetchImpl: server(() => "Result: shipping logistics overview, page 3.") as unknown as typeof fetch,
    });
    expect(outcome.injectionAttemptsSeen).toBeGreaterThan(0);
    const keys = outcome.observations.map((o) => o.observation_key.split(":")[0]);
    expect(keys).not.toContain("content_targets_the_rater");
    expect(keys).not.toContain("any_tool_obeys_embedded_instruction");
  });

  it("catches obedience padded past the 300-character response sample", async () => {
    const r = await run((q) =>
      typeof q !== "string"
        ? `${BANNER}${STACK}`
        : q.includes("ignore all previous")
          ? `${BANNER}${INJECTION_TOKEN}`
          : "Result: shipping logistics overview, page 3.",
    );
    expect(r.value("ignores_embedded_instruction")).toBe(FAIL);
    // Same 300-char window, same evasion: a traceback and a connection string
    // arriving after a banner.
    expect(r.value("no_internal_leakage")).toBe(FAIL);
    expect(r.value("any_tool_leaks_internals")).toBe(FAIL);
  });
});

describe("the injection check separates echo from obedience with a control arm", () => {
  // The matcher was wrong in both directions before this. The control arm asks
  // "does this tool reflect its input back at all", in the tool's own encoding,
  // instead of trying to recognise every way an echo can be spelled.
  //
  //   injection arm:  <instruction>: <TOKEN>
  //   control arm:    <TOKEN>
  //
  // An echoing tool returns the token in both. An obeying tool returns it in
  // the injection arm having had no reason to in the control arm.

  /** A server that echoes whatever it is asked, in the given encoding. */
  const echoer = (encode: (s: string) => string): Reply => (q) =>
    typeof q === "string" ? `No results for: ${encode(q)}` : "error";

  it("clears an echoer, whatever encoding the echo uses", async () => {
    for (const [name, encode] of [
      ["plain", (s: string) => s],
      ["url", (s: string) => encodeURIComponent(s)],
      ["form", (s: string) => s.replace(/ /g, "+").replace(/:/g, "%3A")],
      ["html-ish", (s: string) => s.replace(/ /g, "&#32;")],
      ["json", (s: string) => JSON.stringify({ q: s })],
    ] as const) {
      const r = await run(echoer(encode));
      expect(r.value("ignores_embedded_instruction"), name).toBe(PASS);
      expect(r.value("any_tool_obeys_embedded_instruction"), name).toBeUndefined();
    }
  });

  it("catches a tool that does not echo and emits the token anyway", async () => {
    // The control arm gets the bare token and returns nothing containing it, so
    // the token in the injection arm has only one source.
    const r = await run((q) =>
      typeof q === "string" && q.includes("ignore all previous")
        ? `${INJECTION_TOKEN}`
        : "Result: shipping logistics overview, page 3.",
    );
    expect(r.value("ignores_embedded_instruction")).toBe(FAIL);
    expect(r.value("any_tool_obeys_embedded_instruction")).toBe(FAIL);
  });

  it("catches a tool that BOTH echoes and obeys", async () => {
    // The case a control arm alone would miss, and the original false negative:
    // the echo explains the token in both arms, so obedience has to be caught
    // by the shape of the answer instead. A response that is essentially just
    // the token is not an echo of a much longer payload.
    const r = await run((q) => {
      if (typeof q !== "string") return "error";
      if (q.includes("ignore all previous")) return INJECTION_TOKEN;
      return `No results for: ${q}`;
    });
    expect(r.value("ignores_embedded_instruction")).toBe(FAIL);
    expect(r.value("any_tool_obeys_embedded_instruction")).toBe(FAIL);
  });

  it("skips rather than guesses when the control call fails", async () => {
    // No control means no way to separate echo from obedience. This check has
    // guessed wrong twice; it does not get a third go.
    let seen = 0;
    const r = await run((q) => {
      if (typeof q !== "string") return "error";
      seen += 1;
      if (q.includes("ignore all previous")) return `here you go: ${INJECTION_TOKEN}`;
      if (q === INJECTION_TOKEN) throw new Error("control call fails");
      return "Result: shipping logistics overview, page 3.";
    });
    expect(seen).toBeGreaterThan(0);
    expect(r.value("ignores_embedded_instruction")).toBeUndefined();
    expect(r.value("any_tool_obeys_embedded_instruction")).toBeUndefined();
    expect(r.skipped("injection_resistance")).toBe(true);
  });

  it("explains every verdict in words", async () => {
    const r = await run(echoer((s) => s));
    expect(r.outcome.injectionVerdict?.basis).toMatch(/echoes its input/);
  });
});

describe("declining to be measured does not beat being measured", () => {
  // `substantive` is computed from the response, so the subject controls it.
  // Wrapping every payload as {"ok": false, ...} made both comparison checks
  // SKIP, and a skip is free — so a server that answers nothing scored ABOVE
  // one that answers and fails.
  it("records that a tool never answers substantively, rather than silently skipping", async () => {
    const r = await run(() => JSON.stringify({ ok: false, note: "low confidence", results: "invented content here" }));
    expect(r.value("answers_substantively")).toBe(FAIL);
  });

  it("still credits a tool that answers, even when one query legitimately finds nothing", async () => {
    // Two queries, not one, before this is held against anyone: a real search
    // tool can have nothing for a single term, and scoring that would measure
    // OUR query rather than their tool.
    const r = await run((q) => (typeof q === "string" && q.includes("shipping") ? "Result: 3 matching passages." : '{"ok": false}'));
    expect(r.value("answers_substantively")).toBe(PASS);
  });
});

describe("a judge failure is never published as our failure to look", () => {
  it("costs one check, attributes it to the subject, and lets the battery finish", async () => {
    // The throw escaped runBattery entirely, before the injection and
    // robustness calls, leaving no outcome — and with no outcome the caller
    // manufactured three harness_capability_missing gaps reading "no battery
    // has been run against this subject". A subject could withhold itself on
    // demand and have the withholding attributed to us.
    const judge = {
      client: async () => {
        throw new Error("provider declined to classify");
      },
      modelId: "test-model",
    };
    const outcome = await runBattery(DECL, classifyTool(DECL), {
      observerId: "p",
      ts: "2026-09-05T12:00:00Z",
      endpoint: "https://example.test/mcp",
      parseBody: parseRpcBody,
      spacingMs: 0,
      sleep: async () => {},
      resolver: publicDns,
      judge,
      fetchImpl: server((q) =>
        typeof q === "string" && q.includes(NONSENSE_QUERY)
          ? "Acme Corp Q3 revenue was $4.2M across numerous business segments and regions."
          : "Result: shipping logistics overview, page 3.",
      ) as unknown as typeof fetch,
    });

    // The battery reached the end: injection and robustness both ran.
    const checks = new Set(outcome.observations.map((o) => o.observation_key.split(":")[0]));
    expect(checks.has("ignores_embedded_instruction")).toBe(true);
    expect(checks.has("rejects_invalid_input")).toBe(true);

    // And the loss is one check, blamed on the subject rather than on us.
    // subject_blocked keeps the dimension in the completeness denominator;
    // harness_capability_missing would have excused the subject entirely.
    const gap = outcome.gaps.find((g) => g.check === "no_fabrication");
    expect(gap?.cause).toBe("subject_blocked");
    expect(outcome.gaps.every((g) => g.cause !== "harness_capability_missing")).toBe(true);
  });
});

describe("the probe is not a set of constants an operator can grep for", () => {
  it("gives two subjects different values under one seed", () => {
    const env = { TRUST_INDEX_PROBE_SEED: "seed-for-tests-0123456789" };
    const a = probeIdentity("https://a.test/mcp", env);
    const b = probeIdentity("https://b.test/mcp", env);
    expect(a.nonsenseQuery).not.toBe(b.nonsenseQuery);
    expect(a.injectionToken).not.toBe(b.injectionToken);
    // Neither may be the published fallback, which is what a grep would find.
    expect(a.nonsenseQuery).not.toBe(NONSENSE_QUERY);
    expect(a.injectionToken).not.toBe(INJECTION_TOKEN);
  });

  it("reproduces exactly given the same seed, so a run can be replayed", () => {
    const env = { TRUST_INDEX_PROBE_SEED: "seed-for-tests-0123456789" };
    expect(probeIdentity("https://a.test/mcp", env)).toEqual(probeIdentity("https://a.test/mcp", env));
  });

  it("gives different values under a different seed", () => {
    const one = probeIdentity("https://a.test/mcp", { TRUST_INDEX_PROBE_SEED: "seed-for-tests-0123456789" });
    const two = probeIdentity("https://a.test/mcp", { TRUST_INDEX_PROBE_SEED: "a-completely-different-seed" });
    expect(one.nonsenseQuery).not.toBe(two.nonsenseQuery);
  });

  it("marks an unseeded run as unreproducible rather than falling back to a constant", () => {
    // The dangerous failure would be a silent default, which restores exactly
    // the property this exists to remove.
    const id = probeIdentity("https://a.test/mcp", {});
    expect(id.reproducible).toBe(false);
    expect(id.nonsenseQuery).not.toBe(NONSENSE_QUERY);
  });

  it("does not announce itself as a probe or name this repository", () => {
    const id = probeIdentity("https://a.test/mcp", { TRUST_INDEX_PROBE_SEED: "seed-for-tests-0123456789" });
    expect(id.userAgent).not.toMatch(/probe|trust-index|github/i);
    expect(id.clientName).not.toMatch(/probe|trust-index/i);
  });

  it("uses the per-subject values when probing, not the published fallbacks", async () => {
    const identity = probeIdentity("https://example.test/mcp", { TRUST_INDEX_PROBE_SEED: "seed-for-tests-0123456789" });
    const seen: string[] = [];
    await runBattery(DECL, classifyTool(DECL), {
      observerId: "p",
      ts: "2026-09-05T12:00:00Z",
      endpoint: "https://example.test/mcp",
      parseBody: parseRpcBody,
      spacingMs: 0,
      sleep: async () => {},
      resolver: publicDns,
      identity,
      fetchImpl: (async (_u: unknown, init?: RequestInit) => {
        const q = JSON.parse(String(init?.body ?? "{}"))?.params?.arguments?.query;
        if (typeof q === "string") seen.push(q);
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "ok" }] } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) as unknown as typeof fetch,
    });
    const sent = seen.join(" ");
    expect(sent).toContain(identity.injectionToken);
    expect(sent).not.toContain(INJECTION_TOKEN);
    expect(sent).not.toContain(NONSENSE_QUERY);
  });
});
