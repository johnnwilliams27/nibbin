/**
 * Where the wall is, and what happens when we only look at the front door.
 *
 * Every response body quoted below is verbatim from
 * `packages/collectors/assessment.json`, recorded against the live population.
 * They are here because six servers were worked by hand in the auth triage and
 * every one of them produced the same correction, independently, to the same
 * field: `packages/collectors/transcripts/<server>.json` records
 * `auth: {required: false, status: 200}` for a server that refuses every
 * `tools/call`.
 *
 * The field was never wrong about what it measured. `probe.ts` reads auth off
 * the `initialize` hop, and `initialize` is a capability exchange that most
 * servers leave open. It was wrong about what it was READ as, in
 * `assess.ts`, in `select.ts`, in `census.mts`, and in every attempt to answer
 * "how many of these could we not assess". Three hundred of six hundred stored
 * transcripts say `required: false`; forty-eight of the hundred and sixty-one
 * we have tool-call evidence for are walled anyway.
 *
 * The two shapes that matter are both represented below, because a classifier
 * that catches one and not the other reports a floor as a count:
 *
 *   HTTP 401 at tools/call    — klarix, chronary, framethrower, drillr, creativescope
 *   JSON-RPC error in a 200   — lumify, moonlings, flowcastle, novence, datamerge
 */
import { describe, expect, it } from "vitest";
import { authStanding, classifyToolAuth, handshakeWalled, toolSurfaceWalled, wallLocation } from "../src/mcp/auth.js";
import type { ToolCallResult } from "../src/mcp/invoke.js";
import type { ProbeTranscript } from "../src/mcp/transcript.js";

const result = (over: Partial<ToolCallResult>): ToolCallResult =>
  ({
    tool: "t", shape: "retrieval", basis: "declared", args: {},
    ok: true, isError: false, reason: null, elapsedMs: 10, responseBytes: 0,
    contentTypes: [], structuredContent: false, matchesOutputSchema: null,
    textSample: null, text: null, textTruncated: false, textFingerprint: null,
    substantive: false, errorInPayload: false, refused: false,
    errorBody: null, authChallenge: null,
    ...over,
  }) as ToolCallResult;

const at = "2026-09-08T00:00:00Z";
const one = (r: ToolCallResult) => classifyToolAuth([{ result: r }], at);

/**
 * A transcript with the shape the defect produces: the handshake answered, so
 * the recorded auth block says `required: false`, and nothing has called a tool.
 */
const handshakeOpen = (over: Partial<ProbeTranscript> = {}): ProbeTranscript =>
  ({
    transcript_version: "1", probe_id: "probe:mcp:v1", endpoint: "https://example.test/mcp",
    probed_at: at, attempts: [], handshake: null, tools: null, registry: null,
    auth: { required: false, status: 200, scheme: null, hop: "initialize" },
    ...over,
  }) as ProbeTranscript;

describe("a wall inside an HTTP 200 is still a wall", () => {
  // The shape that made 259 a floor rather than a count. The transport says
  // 200, the envelope says error, and a classifier watching status sees a
  // server answering happily.
  it.each([
    [
      "lumify — JSON-RPC -32001 inside a 200",
      result({ ok: false, reason: "jsonrpc error: Unauthorized: provide a valid Lumify API key as a Bearer token." }),
    ],
    [
      "moonlings — authentication_required in an isError payload",
      result({
        isError: true,
        text: '{"error":"authentication_required","message":"This tool requires authentication: connect via OAuth (you get a free starter grant) or send a Moonlings API key as a Bearer token. The free `ping` tool works without either.","docs":"https://moonlings.ai"}',
      }),
    ],
    [
      "flowcastle — the key exists, it is just not ours",
      result({
        isError: true,
        text: '{\n  "error": "This tool requires an API key. Create an application key in the FlowCastle dashboard (Application → API → MCP tab) for a single workspace, or a personal key (Profile → Personal API keys)"\n}',
      }),
    ],
    [
      "novence — an in-band offer of a bootstrap tool",
      result({ isError: true, text: "Unauthorized: provide Authorization Bearer API key (or call bootstrap first)" }),
    ],
    [
      "datamerge — a credential gap wearing a configuration error's clothes",
      result({ isError: true, text: "DataMerge client not configured. Please call configure_datamerge or set DATAMERGE_API_KEY." }),
    ],
    [
      "facesign — the credential is meant to arrive from the caller",
      result({
        isError: true,
        text: "FaceSign API key is not set for this session. Please ask the user for their FaceSign API key and call the set_api_key tool first.",
      }),
    ],
    [
      "geodesiclabs — auth as a required tool parameter, surfaced as a pydantic error",
      result({
        isError: true,
        text: "Error executing tool list_blueprints: 1 validation error for list_blueprintsArguments\napi_key\n  Field required [type=missing, input_value={}, input_type=dict]",
      }),
    ],
    [
      "kontato — an account wall in Portuguese, and not a missing parameter",
      result({
        isError: true,
        text: "Sessao sem conta ativa. Passe `owner_phone` (numero do dono, so digitos, ex: 5511999998888) NESTA chamada para reativar a conta automaticamente, ou rode `provision` primeiro.",
      }),
    ],
    [
      "dataecho — walled, with the anonymous flow named in the same breath",
      result({
        isError: true,
        text: "unauthorized: Provide Authorization: Bearer <API_KEY> or use the anonymous flow. — authenticate first: call request_login_code, then verify_login_code, then send the apiKey as `Authorization: Bearer <key>` on this MCP connection.",
      }),
    ],
  ])("%s", (_label, r) => {
    const c = one(r);
    expect(c?.walled).toBe(true);
    expect(c?.signal).toBe("in_band");
  });
});

describe("a wall in the status line is recorded as one", () => {
  it.each([
    ["klarix", "HTTP 401"],
    ["chronary", "HTTP 401"],
    ["framethrower", "HTTP 401"],
    ["drillr", "HTTP 401"],
    ["creativescope", "HTTP 401"],
  ])("%s", (_label, reason) => {
    const c = one(result({ ok: false, reason }));
    expect(c?.walled).toBe(true);
    expect(c?.signal).toBe("http_status");
  });

  it("keeps the challenge and the body the transport used to discard", () => {
    // net.ts returned the four characters "401" and threw away the rest. The
    // signup URL, the scheme and the RFC 9728 pointer were all in what it threw
    // away, and the triage re-fetched six servers by hand to read them again.
    const c = one(
      result({
        ok: false,
        reason: "HTTP 401",
        errorBody: '{"error":"authorization_required","error_description":"OAuth authorization or an API key is required. Get a free API key at https://creativescope.ai/mcp"}',
        authChallenge: 'Bearer resource_metadata="https://mcp.creativescope.ai/.well-known/oauth-protected-resource", scope="mcp:use"',
      }),
    );
    expect(c?.walled).toBe(true);
    expect(c?.evidence).toContain("HTTP 401");
    // The diagnosis now reads the body, so the evidence trail leads somewhere.
    expect(one(result({ ok: false, reason: "HTTP 400", errorBody: "Missing API key" }))?.walled).toBe(true);
  });
});

describe("an allowance we spent is not a wall", () => {
  // echoloc, verbatim. This body says "API key" twice and is still not an auth
  // wall: waiting a day cleared it, and a re-probe rated all three tools with
  // no credential at all. diagnoseInvocation tests RATE_LIMIT first for exactly
  // this, and classifyToolAuth must not undo that by counting the verdict.
  const echoloc = result({
    isError: true,
    text: "Anonymous preview limit reached (5 calls/day). Without an API key you get an anonymous preview (5 tool calls/day, trimmed results). For full data send an echoloc API key in the 'X-API-Key' header. Free beta key (100 requests/month, instant): sign up at https://echoloc.ai/auth?mode=signup",
  });

  it("does not make the tool surface walled", () => {
    const c = one(echoloc);
    expect(c?.walled).toBe(false);
    expect(c?.verdicts).toEqual({ rate_limited: 1 });
  });

  it("leaves the standing open rather than walled", () => {
    expect(authStanding(handshakeOpen({ tool_auth: one(echoloc) }))).toBe("open");
  });
});

describe("a partial gate is a wall in front of the part we could not reach", () => {
  // compeller: `get_capabilities` answers anonymously, `search_music` does not.
  // Recording the server as open because something worked would lose the tool
  // we could not rate; recording it as fully walled would lose the two we
  // could. The mix is kept.
  const compeller = classifyToolAuth(
    [
      { tool: "get_capabilities", result: result({ text: '{"productName":"Compeller","capabilities":["music_video_generation"]}', substantive: true }) },
      { tool: "search_music", result: result({ isError: true, text: "API token required. Set Authorization: Bearer <token> header." }) },
    ],
    at,
  );

  it("is walled", () => {
    expect(compeller?.walled).toBe(true);
  });

  it("names the tool that refused, not the one that answered", () => {
    expect(compeller?.tool).toBe("search_music");
    expect(compeller?.evidence).toBe("API token required. Set Authorization: Bearer <token> header.");
  });

  it("keeps both halves visible", () => {
    expect(compeller?.verdicts).toEqual({ worked: 1, needs_credentials: 1 });
    expect(compeller?.calls).toBe(2);
  });
});

describe("failures that are ours or theirs are not credentials", () => {
  it.each([
    ["our arguments", result({ isError: true, text: "'technologies' must be a non-empty list of strings" })],
    ["their 500", result({ ok: false, reason: "HTTP 500" })],
    ["a correct no-such-id", result({ isError: true, text: '{"error":"No firm with slug \'acme-consulting\' in the published tranche."}' })],
    ["a clean answer", result({ text: "Result: 3 passages.", substantive: true })],
  ])("%s leaves the surface open", (_label, r) => {
    expect(one(r)?.walled).toBe(false);
  });
});

describe("unmeasured is an answer, and it is not 'open'", () => {
  it("returns nothing at all from no calls", () => {
    // The alternative — `walled: false` — is the defect restated: an absence of
    // evidence written down as evidence of absence.
    expect(classifyToolAuth([], at)).toBeNull();
  });

  it("reports a handshake-open, never-called server as unmeasured", () => {
    expect(toolSurfaceWalled(handshakeOpen())).toBeNull();
    expect(authStanding(handshakeOpen())).toBe("unmeasured");
    expect(wallLocation(handshakeOpen())).toBeNull();
  });

  it("reports the transcripts that started all this as walled once a call is recorded", () => {
    // ai.lumify_sports-intelligence, exactly as stored: handshake 200,
    // `auth.required: false`, and a tools/call that is a JSON-RPC -32001.
    const lumify = handshakeOpen({
      endpoint: "https://lumify.ai/mcp",
      tool_auth: classifyToolAuth(
        [{ tool: "list_sports", result: result({ ok: false, reason: "jsonrpc error: Unauthorized: provide a valid Lumify API key as a Bearer token." }) }],
        at,
      ),
    });
    expect(handshakeWalled(lumify)).toBe(false);
    expect(authStanding(lumify)).toBe("walled");
    expect(wallLocation(lumify)).toBe("tools/call");
  });
});

describe("a handshake wall settles it without any tool call", () => {
  const walled = handshakeOpen({ auth: { required: true, status: 401, scheme: "Bearer", hop: "initialize" } });

  it("is walled at initialize", () => {
    expect(handshakeWalled(walled)).toBe(true);
    expect(authStanding(walled)).toBe("walled");
    expect(wallLocation(walled)).toBe("initialize");
  });

  it("stays walled even though nothing reached a tool", () => {
    // 259 of the 600 stored transcripts are in this state. They have no tools
    // list, so there is nothing to call and nothing to be unmeasured about.
    expect(toolSurfaceWalled(walled)).toBeNull();
    expect(authStanding(walled)).toBe("walled");
  });
});
