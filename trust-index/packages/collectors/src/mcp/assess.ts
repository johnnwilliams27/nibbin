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
import type { Observation } from "@trust-index/types";
import type { ProbeTranscript, ToolDeclaration } from "./transcript.js";

/** Rubric version. Changing a threshold or a rule changes this. */
export const MCP_RUBRIC_VERSION = "mcp.rubric.v1";

export const THRESHOLDS = {
  /** A description shorter than this tells a caller nothing about what the tool does. */
  min_useful_description_chars: 20,
  /** Freshly published counts as fully maintained. */
  maintenance_fresh_days: 90,
  /** Beyond this, a package with no publish is treated as unmaintained. */
  maintenance_stale_days: 730,
  /** A registry description shorter than this is a name, not a description. */
  min_registry_description_chars: 40,
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
  if (t.handshake !== null) {
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

  if (t.tools !== null) {
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

  if (t.handshake !== null && t.handshake.ok) {
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
    if (r.description !== null) {
      out.push(
        obs(
          `publisher:${r.name}`,
          "documentation",
          "registry_description",
          bool(r.description.trim().length >= THRESHOLDS.min_registry_description_chars),
          t.probed_at,
          "self_reported",
          null,
        ),
      );
    }
  }

  return out;
}
