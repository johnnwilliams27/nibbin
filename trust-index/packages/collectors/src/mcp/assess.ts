/**
 * The MCP rubric: a probe transcript becomes observations.
 *
 * Every rule here is a judgement, and the point of putting them in one pure
 * function is that they can be argued with, versioned and re-run against
 * stored transcripts rather than being buried in the code that made the
 * requests.
 *
 * Three properties the rules hold to:
 *
 * 1. Each check is its own observation, never a blended number. A server that
 *    is reachable but returns invalid tool schemas should read as exactly
 *    that, and a composite that hides which half failed is less useful than
 *    no composite at all. The estimator caps them back to one observer's
 *    worth of weight, so splitting a judgement into five checks does not
 *    inflate the probe's influence.
 *
 * 2. A check that cannot be run emits nothing. It does not emit a zero. A
 *    server whose handshake failed has not been shown to have bad tool
 *    schemas; it has not been shown to have any. Emitting an absence as a
 *    failing measurement is the single most common way a rating system
 *    manufactures signal it does not have.
 *
 * 3. Anything the publisher wrote is self_reported, and therefore capped by
 *    the profile no matter how much of it there is.
 *
 * Thresholds are provisional in the SPEC 12 sense: chosen by reasoning,
 * replaced by calibration against outcomes, never adjusted to taste. They are
 * named constants rather than inline literals so a calibration run can move
 * them in one place.
 */
import type { AssessmentGap, Observation } from "@trust-index/types";
import { CAPABILITIES } from "../capability.js";
import { classifyTools } from "./shape.js";
import type { ProbeTranscript, ToolDeclaration } from "./transcript.js";

/** Rubric version. Changing a threshold or a rule changes this. */
export const MCP_RUBRIC_VERSION = "mcp.rubric.v1";

export const THRESHOLDS = {
  /** A description shorter than this tells a caller nothing about what the tool does. */
  min_useful_description_chars: 20,
  /**
   * Freshly published counts as fully maintained. Recalibrated from the
   * observed population: publish age runs p10=5, p25=15, p50=45, p75=93,
   * p90=150 days with nothing older than a year. The previous 90/730 ramp put
   * 74% of servers at exactly 1.0, which is a constant wearing a dimension's
   * clothes. 14/180 spreads the population: p50 lands at 0.81, p75 at 0.52,
   * p90 at 0.18.
   */
  maintenance_fresh_days: 14,
  /** Beyond this, a package with no publish is treated as unmaintained. */
  maintenance_stale_days: 180,
  /** Versions at or above which a server is demonstrably being iterated on. */
  maintenance_versions_for_full_credit: 5,
} as const;

/**
 * Tool names that imply the call changes something. Matched as whole words
 * inside the common naming conventions (snake, kebab, camel), because
 * "update_row" is mutating and "no_update_needed_check" is a false positive
 * waiting to happen. A mutating tool with no description is the specific
 * hazard: an agent will call it to find out what it does.
 */
const MUTATING_VERBS = [
  "create",
  "delete",
  "remove",
  "drop",
  "write",
  "update",
  "insert",
  "send",
  "post",
  "put",
  "patch",
  "execute",
  "run",
  "exec",
  "purge",
  "revoke",
  "transfer",
  "pay",
  "deploy",
  "publish",
  "merge",
  "push",
] as const;

/**
 * Parameter names that ask the caller to hand over a secret. On a REMOTE MCP
 * server this is a finding: the transport carries the credential to a third
 * party, and the protocol has an authorization story that does not require
 * it. On a local server the same parameter would be unremarkable, which is
 * why this rule is in the remote-server rubric and not in a shared one.
 */
const CREDENTIAL_PARAMS = [
  "apikey",
  "api_key",
  "token",
  "access_token",
  "secret",
  "password",
  "passwd",
  "private_key",
  "privatekey",
  "credential",
  "credentials",
  "session_key",
] as const;

export function isMutatingName(name: string): boolean {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter((w) => w.length > 0)
    .map((w) => w.toLowerCase());
  return words.some((w) => (MUTATING_VERBS as readonly string[]).includes(w));
}

export function isCredentialParam(name: string): boolean {
  const n = name.toLowerCase().replace(/[^a-z0-9_]/g, "");
  return (CREDENTIAL_PARAMS as readonly string[]).some((c) => n === c || n === c.replace(/_/g, ""));
}

type SchemaShape = { properties: Record<string, unknown> | null; required: string[] };

function schemaShape(schema: unknown): SchemaShape {
  if (typeof schema !== "object" || schema === null) return { properties: null, required: [] };
  const s = schema as Record<string, unknown>;
  const props = typeof s.properties === "object" && s.properties !== null ? (s.properties as Record<string, unknown>) : null;
  const required = Array.isArray(s.required) ? s.required.filter((r): r is string => typeof r === "string") : [];
  return { properties: props, required };
}

/** A declared schema is well-formed enough to call: an object type with a properties map. */
function schemaIsCallable(schema: unknown): boolean {
  if (typeof schema !== "object" || schema === null) return false;
  const s = schema as Record<string, unknown>;
  if (s.type !== "object") return false;
  return typeof s.properties === "object" && s.properties !== null;
}

/**
 * Ratio as a 6-decimal DecimalString, computed in integer arithmetic and
 * rounded half up. No float ever reaches an observation value.
 */
export function ratio(numerator: number, denominator: number): string {
  // Finiteness first. `NaN <= 0` is false, so a NaN sailed past the positivity
  // check straight into BigInt, which threw "The number NaN cannot be converted
  // to a BigInt" from three frames away — a message that says nothing about
  // which observation was malformed. Every one of 600 real transcripts failed
  // this way and the error named none of them.
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) {
    throw new RangeError(`ratio: both arguments must be finite, got ${numerator}/${denominator}`);
  }
  if (denominator <= 0) throw new RangeError("ratio: denominator must be positive");
  const scaled = (BigInt(numerator) * 2_000_000n + BigInt(denominator)) / (2n * BigInt(denominator));
  const s = scaled.toString().padStart(7, "0");
  return `${s.slice(0, s.length - 6)}.${s.slice(s.length - 6)}`;
}

const ONE_VALUE = "1.000000";
const ZERO_VALUE = "0.000000";

function bool(v: boolean): string {
  return v ? ONE_VALUE : ZERO_VALUE;
}

function obs(
  probeId: string,
  dimension: string,
  key: string,
  value: string,
  ts: string,
  provenance: Observation["provenance"] = "measured",
  evidenceRef: string | null = null,
): Observation {
  return {
    observer_id: probeId,
    dimension,
    provenance,
    value,
    ts,
    observation_key: key,
    evidence_ref: evidenceRef,
  };
}

/** Days between two ISO timestamps, floored, or null if either is unparseable. */
function daysBetween(laterIso: string, earlierIso: string): number | null {
  const a = Date.parse(laterIso);
  const b = Date.parse(earlierIso);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  if (a < b) return 0;
  return Math.floor((a - b) / 86_400_000);
}

/**
 * Maintenance from publish recency: full marks inside the fresh window,
 * ramping linearly to zero at the stale window. A ramp rather than a cliff,
 * because a package published 91 days ago is not meaningfully different from
 * one published 89 days ago and a cliff would make the rating jump for no
 * reason a reader could explain.
 */
export function maintenanceValue(ageDays: number): string {
  const { maintenance_fresh_days: fresh, maintenance_stale_days: stale } = THRESHOLDS;
  if (ageDays <= fresh) return ONE_VALUE;
  if (ageDays >= stale) return ZERO_VALUE;
  return ratio(stale - ageDays, stale - fresh);
}

/**
 * Turn a transcript into observations. `asOfTs` is passed in rather than read
 * from a clock so the same transcript always yields the same observations.
 */
export function assessTranscript(t: ProbeTranscript, asOfTs: string): Observation[] {
  const out: Observation[] = [];
  const p = t.probe_id;
  const ref = t.endpoint;

  // Availability: one observation per attempt. Several attempts by one probe
  // are one voice, and the per-observer cap enforces that; what they buy is a
  // ratio rather than a coin flip.
  for (const a of t.attempts) {
    out.push(obs(p, "availability", `availability:${a.attempt}`, bool(a.reachable), a.ts, "measured", ref));
  }

  // Conformance. Every check below is only emitted once the preceding step
  // actually ran: an unreachable server is unreachable, not non-conformant.
  //
  // And a server that answered with HTTP 401 is neither. It is up, working,
  // and declining a client with no account, so NOTHING about its conformance
  // has been demonstrated either way. Emitting handshake=0 here was the same
  // error the auth handling exists to remove, arriving by a second path: the
  // transcript records a failed handshake, the rubric scores the failure, and
  // half the population reads as non-conformant because we have no login.
  // transcriptGaps() reports these as a missing capability instead.
  const authBlocked = t.auth?.required === true;
  if (t.handshake !== null && !authBlocked) {
    const h = t.handshake;
    out.push(obs(p, "protocol_conformance", "handshake", bool(h.ok), t.probed_at, "measured", ref));
    if (h.ok) {
      out.push(
        obs(
          p,
          "protocol_conformance",
          "protocol_version_declared",
          bool(h.protocolVersion !== null && h.protocolVersion.length > 0),
          t.probed_at,
          "measured",
          ref,
        ),
      );
      out.push(
        obs(
          p,
          "protocol_conformance",
          "server_identity_declared",
          bool(h.serverName !== null && h.serverName.length > 0),
          t.probed_at,
          "measured",
          ref,
        ),
      );
    }
  }

  if (t.tools !== null && !authBlocked) {
    const tools = t.tools;
    out.push(obs(p, "protocol_conformance", "tools_list", bool(tools.ok), t.probed_at, "measured", ref));
    if (tools.ok && tools.declared.length > 0) {
      const declared: ToolDeclaration[] = tools.declared;
      const named = declared.filter((d) => d.name.length > 0).length;
      out.push(
        obs(p, "protocol_conformance", "tools_named", ratio(named, declared.length), t.probed_at, "measured", ref),
      );
      const callable = declared.filter((d) => schemaIsCallable(d.inputSchema)).length;
      out.push(
        obs(
          p,
          "protocol_conformance",
          "tool_schemas_callable",
          ratio(callable, declared.length),
          t.probed_at,
          "measured",
          ref,
        ),
      );

      // Tool safety.
      const mutating = declared.filter((d) => isMutatingName(d.name));
      if (mutating.length > 0) {
        const undocumented = mutating.filter(
          (d) => d.description === null || d.description.trim().length < THRESHOLDS.min_useful_description_chars,
        );
        out.push(
          obs(
            p,
            "tool_safety",
            "mutating_tools_documented",
            ratio(mutating.length - undocumented.length, mutating.length),
            t.probed_at,
            "measured",
            ref,
          ),
        );
        // The same fact stated as an occurrence rather than a rate, because a
        // gate has to fire on the first one. One undescribed delete tool among
        // fifty well-described tools is a ratio of 0.98 and a hazard of 1: an
        // agent will call it to find out what it does, and finding out is the
        // damage. The ratio above feeds the weighted average; this feeds the
        // mcp.undocumented_destructive_tool gate.
        out.push(
          obs(
            p,
            "tool_safety",
            "undocumented_mutating_tool_present",
            bool(undocumented.length === 0),
            t.probed_at,
            "measured",
            ref,
          ),
        );
      }
      // A tool whose schema declares no properties accepts anything, which
      // means the declaration constrains nothing and a caller cannot tell a
      // valid call from an invalid one before making it.
      const constrained = declared.filter((d) => {
        const shape = schemaShape(d.inputSchema);
        return shape.properties !== null;
      }).length;
      out.push(
        obs(p, "tool_safety", "schemas_constrain_input", ratio(constrained, declared.length), t.probed_at, "measured", ref),
      );
      const credentialFree = declared.filter((d) => {
        const shape = schemaShape(d.inputSchema);
        if (shape.properties === null) return true;
        return !Object.keys(shape.properties).some((k) => isCredentialParam(k));
      }).length;
      out.push(
        obs(
          p,
          "tool_safety",
          "no_credential_parameters",
          ratio(credentialFree, declared.length),
          t.probed_at,
          "measured",
          ref,
        ),
      );
      // Declaration checked against itself: name against description against
      // MCP's own annotations against the schema. Every contradiction is a
      // finding obtained without sending anything, and it is a stronger one
      // than any name heuristic. A tool named delete_document carrying
      // readOnlyHint true is not ambiguous, it is wrong.
      const classified = classifyTools(declared);
      const contradicting = classified.filter((c) => c.contradictions.length > 0);
      out.push(
        obs(
          p,
          "tool_safety",
          "declarations_consistent",
          ratio(declared.length - contradicting.length, declared.length),
          t.probed_at,
          "measured",
          ref,
        ),
      );
      out.push(
        obs(
          p,
          "tool_safety",
          "declaration_contradiction_present",
          bool(contradicting.length === 0),
          t.probed_at,
          "measured",
          ref,
        ),
      );
      // Output schemas are what make a response checkable against its own
      // contract. Declaring one is a documentation property; honouring it is a
      // correctness property that only invocation can establish.
      const withOutputSchema = declared.filter((d) => d.outputSchema !== null && d.outputSchema !== undefined).length;
      out.push(
        obs(p, "documentation", "output_schemas_declared", ratio(withOutputSchema, declared.length), t.probed_at, "measured", ref),
      );

      // Occurrence form, for the mcp.credential_parameter gate. A single tool
      // asking the caller to paste an API key is asking for a secret to be
      // transmitted to a third party, and no ratio across the rest of the tool
      // list makes that safe to recommend.
      out.push(
        obs(
          p,
          "tool_safety",
          "credential_parameter_present",
          bool(credentialFree === declared.length),
          t.probed_at,
          "measured",
          ref,
        ),
      );

      // Documentation.
      const described = declared.filter(
        (d) => d.description !== null && d.description.trim().length >= THRESHOLDS.min_useful_description_chars,
      ).length;
      out.push(
        obs(p, "documentation", "tools_described", ratio(described, declared.length), t.probed_at, "measured", ref),
      );
      // Parameter descriptions, over the tools that declare parameters at all.
      // A tool with no parameters is not undocumented for having none.
      const withParams = declared.filter((d) => {
        const shape = schemaShape(d.inputSchema);
        return shape.properties !== null && Object.keys(shape.properties).length > 0;
      });
      if (withParams.length > 0) {
        const fullyDescribed = withParams.filter((d) => {
          const shape = schemaShape(d.inputSchema);
          return Object.values(shape.properties!).every(
            (v) =>
              typeof v === "object" &&
              v !== null &&
              typeof (v as Record<string, unknown>).description === "string" &&
              ((v as Record<string, unknown>).description as string).trim().length > 0,
          );
        }).length;
        out.push(
          obs(
            p,
            "documentation",
            "parameters_described",
            ratio(fullyDescribed, withParams.length),
            t.probed_at,
            "measured",
            ref,
          ),
        );
      }
    }
  }

  if (t.handshake !== null && t.handshake.ok && !authBlocked) {
    out.push(
      obs(
        p,
        "documentation",
        "server_instructions_present",
        bool(t.handshake.instructions !== null && t.handshake.instructions.trim().length > 0),
        t.probed_at,
        "measured",
        ref,
      ),
    );
  }

  // Registry facts. Recency is a measurement of the registry's own record;
  // the publisher's prose about its own server is not, and is marked as what
  // it is so the profile's cap applies to it.
  if (t.registry !== null) {
    const r = t.registry;
    if (r.published_at !== null) {
      const age = daysBetween(asOfTs, r.published_at);
      if (age !== null) {
        out.push(
          obs(
            p,
            "maintenance",
            "publish_recency",
            maintenanceValue(age),
            t.probed_at,
            "measured",
            r.repository_url,
          ),
        );
      }
    }
    // The registry description length check is deliberately GONE. Observed
    // lengths run p10=58 to a maximum of 104, so the field has a hard cap and
    // essentially everyone fills it: 96.3% cleared the old 40-character
    // threshold. It could not discriminate by construction, and raising the
    // threshold would not have helped. Documentation now rests on tool-level
    // descriptions, which vary. The self-reported cap machinery stays and
    // simply has nothing to bite on, which is the correct state rather than a
    // gap.

    // Version count: real variance, available without contacting anyone.
    // Roughly two thirds of servers have published exactly one version and
    // some have eight, so this discriminates where publish recency alone
    // barely does.
    // `typeof`, not `!== null`. The persisted transcripts have no
    // version_count field at all — the type declared `number | null` and the
    // data had neither, so `undefined !== null` passed and `undefined - 1`
    // became NaN. A type is a claim about data, and this one was wrong.
    if (typeof r.version_count === "number" && Number.isFinite(r.version_count)) {
      const full = THRESHOLDS.maintenance_versions_for_full_credit;
      out.push(
        obs(
          p,
          "maintenance",
          "version_count",
          r.version_count >= full ? ONE_VALUE : ratio(r.version_count - 1, full - 1),
          t.probed_at,
          "measured",
          r.repository_url,
        ),
      );
    }
  }

  return out;
}

/**
 * Checks that could not run, and whose fault that was.
 *
 * Separate from assessTranscript because gaps are not observations and must
 * never be able to become them. The engine refuses to score a gap; this is
 * where the collector decides one exists.
 *
 * The case that matters: an endpoint returning HTTP 401 is up and working and
 * declining an anonymous client. Everything past the handshake is then
 * unassessable for want of an account, which is our missing capability, not
 * the server's failing. Half the sampled population is in this state.
 */
export function transcriptGaps(t: ProbeTranscript): AssessmentGap[] {
  const gaps: AssessmentGap[] = [];
  if (t.auth?.required === true) {
    for (const [dimension, check] of [
      ["protocol_conformance", "handshake"],
      ["protocol_conformance", "tools_list"],
      ["tool_safety", "declarations_consistent"],
      ["documentation", "tools_described"],
    ] as const) {
      gaps.push({
        dimension,
        check,
        cause: "harness_capability_missing",
        capability: CAPABILITIES.mcp_account,
        detail: `endpoint requires authentication (HTTP ${t.auth.status ?? "401"}); no account held for ${t.endpoint}`,
      });
    }
    return gaps;
  }
  // A handshake that failed for any other reason is the subject's doing, and
  // it stops us judging what comes after it. Real information, but only about
  // the step that failed.
  if (t.handshake !== null && !t.handshake.ok) {
    gaps.push({
      dimension: "tool_safety",
      check: "declarations_consistent",
      cause: "subject_blocked",
      capability: null,
      detail: `handshake failed: ${t.handshake.reason ?? "unknown"}`,
    });
  }
  return gaps;
}
