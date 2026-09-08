/**
 * Where the wall is.
 *
 * This file exists because one boolean was answering two questions. `probe.ts`
 * sets `auth.required` from the `initialize` hop; `assess.ts` and `select.ts`
 * read it as though it described the tools. On most MCP servers `initialize` is
 * genuinely open — it is a capability exchange, not a resource — so the field
 * said "open" about servers that refuse every `tools/call`. Six servers worked
 * by hand in the auth triage found this independently, one at a time, and each
 * time it was written up as a correction to that server's transcript rather
 * than as the systematic defect it is: of 600 stored transcripts, 300 record
 * `required: false`, and 48 of the 161 we have tool-call evidence for are
 * walled at `tools/call` regardless.
 *
 * The consequence is not a mis-rating — the call layer diagnoses its own 401s
 * correctly and files a harness gap. The consequence is that the *compendium*
 * cannot answer "how many of these servers could we not assess, and why". A
 * source that reports our reach as their quality is the failure this whole
 * project is organised against, and an auth field that silently reads "open"
 * for an unmeasured tool surface is that failure in miniature.
 *
 * So: three questions, three functions, and a fourth that refuses to collapse
 * them. `unmeasured` is a first-class answer everywhere below. Nothing here
 * invents vocabulary — every per-call judgement is `diagnoseInvocation`'s.
 */
import { diagnoseInvocation, type ToolCallResult } from "./invoke.js";
import type { ProbeTranscript, ToolAuthResult } from "./transcript.js";

/** Did the server refuse the `initialize` handshake for want of a credential? */
export function handshakeWalled(t: Pick<ProbeTranscript, "auth">): boolean {
  return t.auth?.required === true;
}

/**
 * Did the server refuse `tools/call` for want of a credential?
 *
 * `null` is not a hedge, it is the honest answer whenever nothing has called a
 * tool on this server. Callers that need a boolean must decide what an
 * unmeasured surface means for them and say so at the call site.
 */
export function toolSurfaceWalled(t: Pick<ProbeTranscript, "tool_auth">): boolean | null {
  const ta = t.tool_auth;
  if (ta === undefined || ta === null) return null;
  return ta.walled;
}

export type AuthStanding = "walled" | "open" | "unmeasured";

/**
 * The one answer to "can we call this server's tools without an account".
 *
 * A handshake wall settles it: nothing downstream was reachable. Otherwise the
 * tool surface decides, and if nothing called a tool the answer is
 * `unmeasured` — never `open`.
 */
export function authStanding(t: Pick<ProbeTranscript, "auth" | "tool_auth">): AuthStanding {
  if (handshakeWalled(t)) return "walled";
  const tool = toolSurfaceWalled(t);
  if (tool === null) return "unmeasured";
  return tool ? "walled" : "open";
}

/**
 * Which hop refused us. Reported separately from `authStanding` because the two
 * populations need different work: a handshake wall has no tool list to triage
 * against, a tool wall does.
 */
export function wallLocation(t: Pick<ProbeTranscript, "auth" | "tool_auth">): "initialize" | "tools/call" | null {
  if (handshakeWalled(t)) return "initialize";
  return toolSurfaceWalled(t) === true ? "tools/call" : null;
}

/**
 * Read a set of recorded calls and decide whether the tool surface is walled.
 *
 * Rules, in the order they are applied and for the reasons `diagnoseInvocation`
 * already gives:
 *
 *   - ANY `needs_credentials` makes the surface walled. One refusal is proof;
 *     a tool that answered alongside it means the server is partly gated, which
 *     is still a wall in front of the part we could not reach. `verdicts` keeps
 *     the mix visible so a partial gate is never mistaken for a total one.
 *   - `rate_limited` NEVER counts. We spent an allowance; waiting clears it.
 *     This is echoloc, which was filed as needing an account for a week.
 *   - `our_arguments`, `subject_failed`, `undetermined` and `worked` are all
 *     evidence the server let us in far enough to fail on something else.
 *
 * A set with no calls in it yields null rather than a cheerful `walled: false`,
 * for the same reason `tool_auth` is absent rather than false by default.
 */
export function classifyToolAuth(
  calls: ReadonlyArray<{ tool?: string; result: ToolCallResult }>,
  measuredAt: string,
): ToolAuthResult | null {
  if (calls.length === 0) return null;
  const verdicts: Record<string, number> = {};
  let tool: string | null = null;
  let evidence: string | null = null;
  let signal: "http_status" | "in_band" | null = null;

  for (const c of calls) {
    const d = diagnoseInvocation(c.result);
    verdicts[d.verdict] = (verdicts[d.verdict] ?? 0) + 1;
    if (d.verdict !== "needs_credentials" || evidence !== null) continue;
    tool = c.tool ?? c.result.tool ?? null;
    evidence = quoteWall(c.result);
    signal = wallSignal(c.result);
  }
  return {
    walled: (verdicts.needs_credentials ?? 0) > 0,
    verdicts,
    calls: calls.length,
    tool,
    evidence,
    signal,
    measured_at: measuredAt,
  };
}

/**
 * Was the refusal in the HTTP status line or inside a 2xx?
 *
 * The distinction is the whole finding. `ok: false` with a 401/403 reason is
 * the honest shape and the one every classifier catches. `ok: true` carrying a
 * JSON-RPC error or an `isError` payload is the shape that walked past the old
 * check, and lumify — HTTP 200, `-32001 Unauthorized` in the body — is why the
 * count of auth-walled servers was a floor rather than a number.
 */
function wallSignal(r: ToolCallResult): "http_status" | "in_band" {
  return r.ok === false && /http 40[13]/i.test(r.reason ?? "") ? "http_status" : "in_band";
}

/** The server's own sentence, capped. Kept verbatim so the classification can be checked rather than believed. */
function quoteWall(r: ToolCallResult): string | null {
  const source = [r.reason, r.errorBody, r.text, r.authChallenge].find(
    (s): s is string => typeof s === "string" && s.trim().length > 0,
  );
  if (source === undefined) return null;
  return source.replace(/\s+/g, " ").trim().slice(0, 300);
}
