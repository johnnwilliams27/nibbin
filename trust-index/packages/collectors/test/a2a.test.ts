/**
 * A2A card parsing and outcome classification.
 *
 * Every fixture in this file is a real response from a real BSC agent, captured
 * by hand before the prober existed. That is deliberate: the two mistakes this
 * code is most likely to make are both mistakes about the WILD population, not
 * about the spec.
 *
 *   - `ezcto.fun/.well-known/agent-card.json` answers HTTP 200 with an HTML
 *     page, because the site is a single-page app whose router serves index.html
 *     for every unmatched path. A prober that read the status would record a
 *     web page as an Agent Card.
 *   - `api.ezcto.fun/.well-known/agent-card.json` — the URL the registry itself
 *     advertises for that agent — answers 404 with a JSON error envelope. A
 *     prober that trusted the registry's endpoint would have recorded an agent
 *     that does publish a card as publishing none.
 *
 * And the discipline test at the bottom: 5xx, timeouts and guard refusals are
 * OUR failure to measure. They must never classify as a fact about the subject.
 */
import { describe, expect, it } from "vitest";
import {
  cardCandidates,
  classifyCardResponse,
  classifyRpcResponse,
  livenessMethods,
  looksLikeAgentCard,
  parseAgentCard,
  readInterfaces,
  readSkills,
} from "../src/a2a/probe.js";
import { isSubjectFact, type MeasurementOutcome } from "../src/a2a/transcript.js";
import type { HttpOutcome } from "../src/net.js";

/** An HTTP 2xx with a body, as guardedFetch returns one. */
function ok(body: string, contentType = "application/json"): HttpOutcome {
  return { ok: true, status: 200, headers: new Headers({ "content-type": contentType }), body, elapsedMs: 12 };
}

/** A non-2xx, which still carries what the server said. */
function fail(status: number, body = "", contentType = "application/json"): HttpOutcome {
  return {
    ok: false,
    reason: `HTTP ${status}`,
    status,
    elapsedMs: 12,
    headers: new Headers({ "content-type": contentType }),
    body,
  };
}

/** A failure with no response at all: a timeout, a DNS refusal, a dead socket. */
function noResponse(reason: string): HttpOutcome {
  return { ok: false, reason, status: null, elapsedMs: 10_000 };
}

/** bubbleaiagent (chain 56, token 212840), served at its workers.dev origin. Verbatim, trimmed to two skills. */
const BUBBLE_CARD = JSON.stringify({
  capabilities: { streaming: false },
  defaultInputModes: ["application/json"],
  defaultOutputModes: ["application/json"],
  description: "ERC-8183 seller agent (bubbleai-agent) — negotiate + notify_funded over A2A.",
  name: "bubbleai-agent",
  preferredTransport: "JSONRPC",
  protocolVersion: "0.3.0",
  skills: [
    {
      description: "Send a data part and receive a wallet-signed price quote.",
      id: "negotiate",
      inputModes: ["application/json"],
      name: "Negotiate an ERC-8183 job",
      outputModes: ["application/json"],
      tags: ["erc8183", "negotiation", "bnb-chain"],
    },
    {
      description: "Request delivery for a funded job.",
      id: "notify_funded",
      name: "Notify funded",
      tags: ["erc8183"],
    },
  ],
  url: "https://cm-5268dad98979f28b-site-3d068a2fc837.bubbleupdappos.workers.dev/",
  version: "1.0.0",
});

describe("cardCandidates", () => {
  it("tries both well-known spellings for a bare origin, registered one first", () => {
    // §14.3 registers `agent-card.json`. `agent.json` is the pre-0.3 spelling
    // and is still deployed, so it is tried — second, not instead.
    expect(cardCandidates("https://agent.example.com").map((c) => c.path)).toEqual([
      "/.well-known/agent-card.json",
      "/.well-known/agent.json",
    ]);
  });

  it("keeps a registry-declared card URL first, then still tries the well-known paths", () => {
    // VoidGlyph's card lives at a path the registry names. EZCTO's registry
    // entry names a host that 404s while the well-known path on another host
    // has the card. Neither source gets to be the only one consulted.
    const urls = cardCandidates("https://app.singularry.org/agents/191/agent-card.json").map((c) => c.url);
    expect(urls[0]).toBe("https://app.singularry.org/agents/191/agent-card.json");
    expect(urls).toContain("https://app.singularry.org/.well-known/agent-card.json");
  });

  it("also tries the well-known path under a base's own path prefix, last", () => {
    const paths = cardCandidates("https://host.example/agents/191").map((c) => c.path);
    expect(paths).toEqual([
      "/.well-known/agent-card.json",
      "/.well-known/agent.json",
      "/agents/191/.well-known/agent-card.json",
      "/agents/191/.well-known/agent.json",
    ]);
  });

  it("returns nothing for a URL the guard refuses, rather than dialling it", () => {
    // The subject list is attacker-controlled; a registry entry pointing at
    // localhost is not hypothetical, it is in the data.
    expect(cardCandidates("http://169.254.169.254/")).toEqual([]);
    expect(cardCandidates("file:///etc/passwd")).toEqual([]);
    expect(cardCandidates("not a url")).toEqual([]);
  });
});

describe("classifyCardResponse", () => {
  it("reads a real 0.3.0 card", () => {
    const v = classifyCardResponse(ok(BUBBLE_CARD));
    expect(v.outcome).toBe("card");
    expect(v.reason).toBeNull();
  });

  it("refuses to call an SPA's index page a card, despite the 200", () => {
    // ezcto.fun answers every path with this, content-type text/html.
    const v = classifyCardResponse(ok("<!doctype html>\n<html lang=\"en\">", "text/html; charset=UTF-8"));
    expect(v.outcome).toBe("not_json");
    expect(v.reason).toContain("text/html");
  });

  it("refuses to call an API error envelope a card, despite it being JSON", () => {
    const v = classifyCardResponse(ok('{"error":true,"message":"Unknown endpoint"}'));
    expect(v.outcome).toBe("not_a_card");
  });

  it("records a 404 as this path having no card — a fact the server stated", () => {
    // api.ezcto.fun, the registry-declared endpoint, verbatim.
    const v = classifyCardResponse(fail(404, '{"error":true,"message":"Unknown endpoint: GET /.well-known/agent-card.json"}'));
    expect(v.outcome).toBe("absent");
  });

  it("classifies 401 and 403 as an auth wall, not a dead endpoint", () => {
    // The server answered and declined us. Known, rateable state.
    expect(classifyCardResponse(fail(401)).outcome).toBe("auth_walled");
    expect(classifyCardResponse(fail(403)).outcome).toBe("auth_walled");
  });

  it("classifies 429 as alive and rate-limiting us, never as down", () => {
    expect(classifyCardResponse(fail(429)).outcome).toBe("rate_limited");
  });

  it("records a 5xx as OUR failure to measure, not as the absence of a card", () => {
    // The subject's server broke. What that says about whether the subject
    // publishes a card is nothing at all.
    const v = classifyCardResponse(fail(503));
    expect(v.outcome).toBe("unmeasured");
    expect(isSubjectFact(v.outcome)).toBe(false);
    expect(v.reason).toContain("could not measure");
  });

  it("records a timeout as unmeasured, with the reason kept", () => {
    const v = classifyCardResponse(noResponse("the request exceeded its deadline"));
    expect(v.outcome).toBe("unmeasured");
    expect(v.reason).toBe("the request exceeded its deadline");
  });
});

describe("parseAgentCard", () => {
  it("reads name, version, transport and skills off a real card", () => {
    const d = parseAgentCard(JSON.parse(BUBBLE_CARD));
    expect(d.ok).toBe(true);
    expect(d.name).toBe("bubbleai-agent");
    expect(d.protocolVersion).toBe("0.3.0");
    expect(d.skillCount).toBe(2);
    expect(d.skills.map((s) => s.id)).toEqual(["negotiate", "notify_funded"]);
    expect(d.skills[0]?.tags).toEqual(["erc8183", "negotiation", "bnb-chain"]);
    expect(d.interfaces[0]).toEqual({
      url: "https://cm-5268dad98979f28b-site-3d068a2fc837.bubbleupdappos.workers.dev/",
      transport: "JSONRPC",
      protocolVersion: "0.3.0",
      source: "url",
    });
    expect(d.capabilities.streaming).toBe(false);
    // The card declares no pushNotifications flag. Absent is recorded as
    // absent, never defaulted to false — that would be inventing a claim.
    expect(d.capabilities.pushNotifications).toBeNull();
    expect(d.missingRequired).toEqual([]);
  });

  it("reads the v1.0 supportedInterfaces shape as well as the v0.3 url shape", () => {
    // The spec replaced url + preferredTransport with supportedInterfaces[],
    // first entry preferred. Nothing in the wild uses it yet; everything will.
    const d = parseAgentCard({
      name: "Research Agent",
      description: "d",
      version: "1.0.0",
      protocolVersion: "1.0",
      capabilities: { streaming: true },
      defaultInputModes: ["text/plain"],
      defaultOutputModes: ["text/plain"],
      skills: [{ id: "academic-research", name: "Academic Research", description: "x", tags: ["research"] }],
      supportedInterfaces: [
        { url: "https://research.example.com/a2a/v1", protocolBinding: "HTTP+JSON", protocolVersion: "1.0" },
      ],
    });
    expect(d.interfaces[0]).toEqual({
      url: "https://research.example.com/a2a/v1",
      transport: "HTTP+JSON",
      protocolVersion: "1.0",
      source: "supportedInterfaces",
    });
    expect(d.missingRequired).toEqual([]);
  });

  it("records missing required fields rather than rejecting the card", () => {
    // A card missing `description` is a conformance finding to be scored, not
    // a document to be reclassified as something else.
    const d = parseAgentCard({ name: "bare", skills: [] });
    expect(d.ok).toBe(true);
    expect(d.missingRequired).toEqual([
      "description",
      "version",
      "capabilities",
      "defaultInputModes",
      "defaultOutputModes",
      "url",
    ]);
  });

  it("drops an interface URL the guard would refuse, so tier 3 never dials it", () => {
    // The card is written by the subject. `url` is attacker-controlled input.
    const d = parseAgentCard({ name: "n", protocolVersion: "0.3.0", url: "http://127.0.0.1:8080/a2a", skills: [] });
    expect(d.interfaces).toEqual([]);
    expect(d.missingRequired).toContain("url");
  });

  it("reports a non-card as not a card, with every required field missing", () => {
    const d = parseAgentCard({ error: true, message: "Unknown endpoint" });
    expect(d.ok).toBe(false);
    expect(d.reason).toBe("the document is not an Agent Card");
    expect(d.skillCount).toBe(0);
  });
});

describe("looksLikeAgentCard", () => {
  it("accepts a document with a name and any A2A marker", () => {
    expect(looksLikeAgentCard({ name: "a", skills: [] })).toBe(true);
    expect(looksLikeAgentCard({ name: "a", protocolVersion: "0.3.0" })).toBe(true);
  });

  it("rejects arrays, nulls, and JSON that merely has a name", () => {
    expect(looksLikeAgentCard([{ name: "a", skills: [] }])).toBe(false);
    expect(looksLikeAgentCard(null)).toBe(false);
    expect(looksLikeAgentCard({ name: "a user", email: "x" })).toBe(false);
  });
});

describe("readSkills", () => {
  it("tolerates a missing or malformed skills array", () => {
    expect(readSkills({})).toEqual([]);
    expect(readSkills({ skills: "two" })).toEqual([]);
    expect(readSkills({ skills: [null, 3, "x"] })).toEqual([]);
  });

  it("records an absent skill id as empty rather than inventing one", () => {
    const [s] = readSkills({ skills: [{ name: "unnamed" }] });
    expect(s?.id).toBe("");
    expect(s?.name).toBe("unnamed");
    expect(s?.tags).toEqual([]);
  });
});

describe("readInterfaces", () => {
  it("puts the preferred interface first and deduplicates repeats", () => {
    const i = readInterfaces({
      url: "https://a.example/a2a",
      preferredTransport: "JSONRPC",
      additionalInterfaces: [
        { url: "https://a.example/a2a", transport: "JSONRPC" },
        { url: "https://a.example/grpc", transport: "GRPC" },
      ],
    });
    expect(i.map((x) => x.url)).toEqual(["https://a.example/a2a", "https://a.example/grpc"]);
    expect(i[1]?.source).toBe("additionalInterfaces");
  });
});

describe("livenessMethods", () => {
  it("uses the 0.3 spelling for the generation actually deployed", () => {
    // Every card sampled declares 0.3.0, and 0.3 names the method `tasks/get`.
    expect(livenessMethods("0.3.0").primary).toBe("tasks/get");
    expect(livenessMethods(null).primary).toBe("tasks/get");
  });

  it("uses the v1.0 method mapping when the card declares 1.x", () => {
    // The v1.0 spec's mapping table renames tasks/get to GetTask. Sending the
    // wrong spelling gets -32601 from a perfectly healthy agent.
    expect(livenessMethods("1.0").primary).toBe("GetTask");
    expect(livenessMethods("1.0").alternate).toBe("tasks/get");
  });
});

describe("classifyRpcResponse", () => {
  it("treats -32001 Task not found as proof the endpoint speaks A2A", () => {
    // Both live agents in the first sample answered exactly this. A JSON-RPC
    // error to a benign read is a SUCCESSFUL measurement, not a failure.
    const v = classifyRpcResponse(
      ok('{"jsonrpc":"2.0","id":1,"error":{"code":-32001,"message":"Task not found: this endpoint is stateless"}}'),
      "tasks/get",
    );
    expect(v.verdict).toBe("speaks_a2a");
    expect(v.rpcErrorCode).toBe(-32001);
    expect(v.rpcErrorMessage).toContain("Task not found");
  });

  it("treats a result envelope as proof too", () => {
    expect(classifyRpcResponse(ok('{"jsonrpc":"2.0","id":1,"result":null}'), "tasks/get").verdict).toBe("speaks_a2a");
  });

  it("separates an unimplemented method from a dead endpoint", () => {
    const v = classifyRpcResponse(ok('{"jsonrpc":"2.0","id":1,"error":{"code":-32601,"message":"Method not found"}}'), "GetTask");
    expect(v.verdict).toBe("jsonrpc_no_a2a_method");
  });

  it("calls a 404 at the card's own declared URL an answer, not a measurement gap", () => {
    const v = classifyRpcResponse(fail(404), "tasks/get");
    expect(v.verdict).toBe("answered_not_a2a");
    expect(v.reason).toContain("declared endpoint");
  });

  it("does not mistake an HTML page for a JSON-RPC endpoint", () => {
    expect(classifyRpcResponse(ok("<!doctype html>", "text/html"), "tasks/get").verdict).toBe("answered_not_a2a");
    expect(classifyRpcResponse(ok('{"status":"ok"}'), "tasks/get").verdict).toBe("answered_not_a2a");
  });

  it("keeps the auth wall, the rate limit and the measurement gap apart", () => {
    expect(classifyRpcResponse(fail(401), "tasks/get").verdict).toBe("auth_walled");
    expect(classifyRpcResponse(fail(429), "tasks/get").verdict).toBe("rate_limited");
    expect(classifyRpcResponse(fail(502), "tasks/get").verdict).toBe("unmeasured");
    expect(classifyRpcResponse(noResponse("dns lookup failed"), "tasks/get").verdict).toBe("unmeasured");
  });
});

describe("the line between a fact and a gap", () => {
  it("counts only answers as facts about the subject", () => {
    const facts: MeasurementOutcome[] = ["card", "not_json", "not_a_card", "auth_walled", "rate_limited", "absent"];
    for (const f of facts) expect(isSubjectFact(f)).toBe(true);
    for (const g of ["unmeasured", "refused"] as MeasurementOutcome[]) expect(isSubjectFact(g)).toBe(false);
  });
});
