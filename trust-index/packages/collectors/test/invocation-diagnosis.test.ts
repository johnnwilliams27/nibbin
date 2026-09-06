/**
 * Whose failure was it?
 *
 * Every case below is a verbatim response from the live population. The check
 * that produced them scored 205 of 409 tools as broken; classifying the actual
 * responses found 163 of those failures were ours and 28 were the subject's.
 * The headline "half of all MCP tools do not work" was wrong by a factor of
 * seven, and it had been measured three times, agreeing with itself every time,
 * because all three measurements shared the defect.
 */
import { describe, expect, it } from "vitest";
import { diagnoseInvocation, type ToolCallResult } from "../src/mcp/invoke.js";

const result = (over: Partial<ToolCallResult>): ToolCallResult =>
  ({
    tool: "t", shape: "retrieval", basis: "declared", args: {},
    ok: true, isError: false, reason: null, elapsedMs: 10, responseBytes: 0,
    contentTypes: [], structuredContent: null, matchesOutputSchema: null,
    textSample: null, text: null, textTruncated: false, textFingerprint: null,
    substantive: false, errorInPayload: false, refused: false,
    ...over,
  }) as ToolCallResult;

describe("a missing credential is never a broken tool", () => {
  it.each([
    ["HTTP 401", result({ ok: false, reason: "HTTP 401" })],
    ["jsonrpc auth", result({ ok: false, reason: "jsonrpc error: Authentication required" })],
    ["bearer token", result({ isError: true, text: "API token required. Set Authorization: Bearer <token> header." })],
    ["anonymous flow", result({ isError: true, text: "unauthorized: Provide Authorization: Bearer <API_KEY> or use the anonymous flow." })],
    ["server not configured", result({ isError: true, text: "DataMerge client not configured. Please call configure_datamerge or set DATAMERGE_API_KEY." })],
    ["needs an account", result({ isError: true, text: "Sessao sem conta ativa. Passe `owner_phone` NESTA chamada." })],
  ])("%s is a harness gap", (_label, r) => {
    expect(diagnoseInvocation(r).verdict).toBe("needs_credentials");
  });
});

describe("a tool that correctly rejects what we invented is working", () => {
  it.each([
    ["invented slug", result({ isError: true, text: `api 404: {"error":"not_found","slug":"wireless-bluetooth-headphones-xl2000"}` })],
    ["invented firm", result({ isError: true, text: `{"error":"No firm with slug 'acme-consulting' in the published tranche."}` })],
    ["invented provider", result({ isError: true, text: 'Error: No provider found with id "dk-001".' })],
    ["invented signup", result({ isError: true, text: `{"error":"Unknown signup_id"}` })],
  ])("%s counts as worked", (_label, r) => {
    // We asked about something that does not exist and were told so. That is
    // the tool doing its job, and scoring it as a failure is scoring our own
    // argument synthesis.
    expect(diagnoseInvocation(r).verdict).toBe("worked");
  });
});

describe("arguments we could not form are our problem, not theirs", () => {
  it.each([
    ["schema rejection", result({ isError: true, text: "MCP error -32602: Input validation error: Invalid arguments for tool compare_products" })],
    ["missing field", result({ isError: true, text: 'services is required, e.g. ["claude"]' })],
    ["needs a parameter", result({ isError: true, text: "At least one search parameter is required" })],
    ["wrong shape", result({ isError: true, text: "'technologies' must be a non-empty list of strings" })],
    ["bad format", result({ isError: true, text: `{"errorCode":"INVALID_QUERY","message":"Invalid product id format"}` })],
  ])("%s is a skip", (_label, r) => {
    expect(diagnoseInvocation(r).verdict).toBe("our_arguments");
  });
});

describe("the subject's own failures still count", () => {
  it.each([
    ["HTTP 500", result({ ok: false, reason: "HTTP 500" })],
    ["dead endpoint", result({ ok: false, reason: "HTTP 404" })],
    ["timeout", result({ ok: false, reason: "The operation was aborted due to timeout" })],
    ["internal error", result({ isError: true, text: "Error executing tool advisors_catalog_list_services" })],
    ["upstream down", result({ isError: true, text: "Aviado data source temporarily unavailable (effect_edges)." })],
    ["oversized", result({ ok: false, reason: "body over 2097152 bytes" })],
  ])("%s is scored against the subject", (_label, r) => {
    expect(diagnoseInvocation(r).verdict).toBe("subject_failed");
  });

  it("a clean call is a clean call", () => {
    expect(diagnoseInvocation(result({ text: "Result: 3 passages." })).verdict).toBe("worked");
  });
});

describe("an auth wall wins over anything else in the same body", () => {
  it("does not read a 401 that also says not found as a working tool", () => {
    const r = result({ ok: false, reason: "HTTP 401", text: '{"error":"not_found"}' });
    expect(diagnoseInvocation(r).verdict).toBe("needs_credentials");
  });
});

/**
 * Absence has a shape, and so does a description.
 *
 * Two checks that replaced skips. We were writing "we invented this identifier
 * so we can learn nothing" and stopping there; but a lookup handed a
 * well-formed identifier that does not exist has exactly one correct
 * behaviour, and a tool whose description promises a JSON list has told us
 * what its response should look like.
 */
import { absentIdentifier } from "../src/mcp/probe-identity.js";

describe("a certainly-absent identifier keeps the shape it should have", () => {
  const id = { nonsenseQuery: "bcdfghjklmnpqrstvwxz245678" };

  it("keeps a uuid a uuid, so the tool cannot reject the format instead", () => {
    const v = absentIdentifier("record_uuid", { properties: { record_uuid: { type: "string", format: "uuid" } } }, id);
    expect(v).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("uses a reserved TLD for URLs, so absence is by construction and not by luck", () => {
    expect(absentIdentifier("website", { properties: {} }, id)).toMatch(/^https:\/\/[a-z0-9]+\.invalid\/$/);
    expect(absentIdentifier("email", { properties: {} }, id)).toMatch(/@example\.invalid$/);
  });

  it("keeps a ticker ticker-shaped", () => {
    expect(absentIdentifier("ticker", { properties: {} }, id)).toMatch(/^[A-Z0-9]{1,5}$/);
  });

  it("falls back to a slug, which is what catalogue lookups expect", () => {
    expect(absentIdentifier("product_slug", { properties: {} }, id)).toMatch(/^[a-z0-9]+-[a-z0-9]+$/);
  });

  it("does not send a value that plausibly exists", () => {
    // The trap this avoids: our synthesizer supplies example.com and AAPL on
    // purpose, so 37 tools answering correctly about a REAL domain would have
    // been recorded as inventing records.
    for (const p of ["domain", "url", "ticker", "id", "slug"]) {
      const v = absentIdentifier(p, { properties: {} }, id).toLowerCase();
      expect(v).not.toContain("example.com");
      expect(v).not.toBe("aapl");
      expect(v).not.toBe("test");
    }
  });

  it("is stable for a subject and different across subjects", () => {
    const other = { nonsenseQuery: "zzxxwwvvttssrrqqppnnmmllkk" };
    expect(absentIdentifier("id", { properties: {} }, id)).toBe(absentIdentifier("id", { properties: {} }, id));
    expect(absentIdentifier("id", { properties: {} }, id)).not.toBe(absentIdentifier("id", { properties: {} }, other));
  });
});
