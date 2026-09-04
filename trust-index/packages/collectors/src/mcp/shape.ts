/**
 * Tool shape classification: what a tool is, read from what it declares.
 *
 * One classification, three decisions:
 *
 *   1. WHICH TESTS APPLY. A currency converter gets round-trip checks. A
 *      retrieval tool gets metamorphic relations and a fabrication probe. A
 *      weather tool can be checked against an independent reference.
 *   2. WHAT WE ARE ALLOWED TO SEND. Read-only tools take ordinary calls.
 *      Everything else depends on the next line.
 *   3. WHETHER WE CAN SUPPLY THE TARGET.
 *
 * That third one is the distinction that matters most, and it replaces the
 * cruder destructive-versus-read-only line.
 *
 *   SUBSTITUTABLE TARGET   the tool acts on something we name: `to`, `repo`,
 *                          `address`, `webhook`, `path`, `connection`. We point
 *                          it at a sandbox we own, let it do its worst, and
 *                          diff the sandbox afterwards.
 *
 *   OPERATOR-BOUND         the tool acts on a resource the operator owns, with
 *                          no parameter that redirects it: `delete_document(id)`
 *                          against their corpus, `clear_cache()`, `deploy(env)`.
 *                          No sandbox helps. Guard probes only.
 *
 * The first class is the large one, because a tool is usually dangerous
 * precisely because it acts on a target, and a target is a parameter. And for
 * that class the sandbox is not a safety workaround, it is the best instrument
 * we have: snapshot, call, snapshot, diff, and any change the declaration did
 * not imply is an undeclared side effect.
 *
 * Everything here reads declarations only. Nothing in this file makes a
 * request.
 */
import { CAPABILITIES, type CapabilityId } from "../capability.js";
import { isMutatingName } from "./assess.js";
import type { ToolDeclaration } from "./transcript.js";

/** What the tool does, for battery selection. */
export type ToolShape =
  | "retrieval"
  | "public_data"
  | "transform"
  | "generation"
  | "communication"
  | "state_mutation"
  | "code_execution"
  | "financial"
  | "unknown";

/** How, and whether, we can exercise it. */
export type TargetBinding =
  /**
   * No side effect to redirect. Call it normally.
   *
   * `declared` means the operator asserted readOnlyHint and nothing
   * contradicts it. `inferred` means the tool carries no annotations at all
   * and its name, description and shape agree it is a read. The distinction is
   * published rather than flattened, because a caller deciding how much to
   * trust the classification should be able to see which it was.
   */
  | { kind: "read_only"; basis: "declared" | "inferred" }
  /** Acts on something we name. Point it at our sandbox and diff. */
  | { kind: "substitutable"; parameter: string; capability: CapabilityId }
  /** Acts on the operator's own resource. Guard probes only. */
  | { kind: "operator_bound"; reason: string };

export type ToolClassification = {
  tool: string;
  shape: ToolShape;
  binding: TargetBinding;
  /**
   * Contradictions between what the tool is called, what it says it does, and
   * what its annotations claim. Each is a finding in its own right, obtained
   * without sending anything.
   */
  contradictions: string[];
  /** Declared annotation hints, as given. Never trusted for safety, useful as a claim to check. */
  hints: { readOnly: boolean | null; destructive: boolean | null; idempotent: boolean | null };
};

/**
 * Parameter names that name a target we could substitute, mapped to the
 * sandbox capability that would be needed to supply one.
 *
 * Matching is on the whole parameter name, normalized. A parameter called
 * `recipient_email` counts; one called `email_body` does not, which is why the
 * suffix matters and a substring search would be wrong.
 */
const TARGET_PARAMETERS: ReadonlyArray<{ names: readonly string[]; capability: CapabilityId; shape: ToolShape }> = [
  { names: ["to", "recipient", "recipients", "to_email", "recipient_email", "email_to"], capability: CAPABILITIES.mailbox, shape: "communication" },
  { names: ["phone", "to_number", "phone_number", "msisdn"], capability: CAPABILITIES.sms, shape: "communication" },
  { names: ["webhook", "webhook_url", "callback_url", "channel", "channel_id", "conversation_id"], capability: CAPABILITIES.chat_sandbox, shape: "communication" },
  { names: ["repo", "repository", "repo_name", "repo_full_name", "owner_repo"], capability: CAPABILITIES.repo_sandbox, shape: "state_mutation" },
  { names: ["connection", "connection_string", "database", "database_url", "dsn"], capability: CAPABILITIES.database_sandbox, shape: "state_mutation" },
  { names: ["bucket", "object_key", "s3_uri", "storage_path"], capability: CAPABILITIES.object_store_sandbox, shape: "state_mutation" },
  { names: ["address", "to_address", "recipient_address", "destination", "wallet"], capability: CAPABILITIES.testnet_wallet, shape: "financial" },
  { names: ["code", "script", "source", "command", "cmd", "program"], capability: CAPABILITIES.exec_sandbox, shape: "code_execution" },
  { names: ["path", "file_path", "filename", "directory"], capability: CAPABILITIES.object_store_sandbox, shape: "state_mutation" },
];

const RETRIEVAL_VERBS = ["search", "query", "find", "lookup", "list", "get", "fetch", "read", "retrieve", "browse"];
const TRANSFORM_VERBS = ["convert", "encode", "decode", "format", "parse", "translate", "transform", "render", "hash"];
const GENERATION_VERBS = ["generate", "summarize", "summarise", "write", "compose", "draft", "explain", "answer", "classify", "extract"];
const FINANCIAL_VERBS = ["pay", "charge", "transfer", "refund", "invoice", "swap", "trade", "withdraw", "deposit"];
const EXEC_VERBS = ["execute", "exec", "run", "eval", "shell", "bash", "compile"];
const COMMS_VERBS = ["send", "email", "sms", "message", "post", "notify", "publish", "broadcast", "reply"];

/** Public data domains where an independent reference can settle correctness. */
const PUBLIC_DATA_HINTS = ["weather", "forecast", "geocode", "timezone", "currency", "exchange_rate", "stock", "ticker", "wikipedia", "dns", "whois"];

function words(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter((w) => w.length > 0)
    .map((w) => w.toLowerCase());
}

function normalizeParam(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "_");
}

function readHints(t: ToolDeclaration): ToolClassification["hints"] {
  const a = t.annotations;
  const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);
  if (typeof a !== "object" || a === null) return { readOnly: null, destructive: null, idempotent: null };
  const rec = a as Record<string, unknown>;
  return {
    readOnly: bool(rec.readOnlyHint),
    destructive: bool(rec.destructiveHint),
    idempotent: bool(rec.idempotentHint),
  };
}

function properties(schema: unknown): Record<string, unknown> {
  if (typeof schema !== "object" || schema === null) return {};
  const s = schema as Record<string, unknown>;
  if (typeof s.properties !== "object" || s.properties === null) return {};
  return s.properties as Record<string, unknown>;
}

function requiredFields(schema: unknown): string[] {
  if (typeof schema !== "object" || schema === null) return [];
  const s = schema as Record<string, unknown>;
  return Array.isArray(s.required) ? s.required.filter((r): r is string => typeof r === "string") : [];
}

function shapeFromName(name: string, description: string | null): ToolShape {
  const w = words(name);
  const text = `${name} ${description ?? ""}`.toLowerCase();
  const has = (list: readonly string[]): boolean => w.some((x) => list.includes(x));

  if (has(FINANCIAL_VERBS)) return "financial";
  if (has(EXEC_VERBS)) return "code_execution";
  if (has(COMMS_VERBS)) return "communication";
  if (PUBLIC_DATA_HINTS.some((h) => text.includes(h))) return "public_data";
  if (has(TRANSFORM_VERBS)) return "transform";
  if (has(GENERATION_VERBS)) return "generation";
  if (has(RETRIEVAL_VERBS)) return "retrieval";
  if (isMutatingName(name)) return "state_mutation";
  return "unknown";
}

/**
 * Classify one tool from its declaration.
 *
 * Conservative in one direction only. Where the signals disagree the tool is
 * treated as the more dangerous reading AND the disagreement is recorded as a
 * contradiction, because a tool whose name and annotations tell different
 * stories is itself the finding.
 */
export function classifyTool(t: ToolDeclaration): ToolClassification {
  const hints = readHints(t);
  const mutatingName = isMutatingName(t.name);
  const shape = shapeFromName(t.name, t.description);
  const contradictions: string[] = [];

  // The declaration checked against itself. Free findings, no request made.
  if (hints.readOnly === true && mutatingName) {
    contradictions.push(`declares readOnlyHint but is named like a mutation (${t.name})`);
  }
  if (hints.readOnly === true && hints.destructive === true) {
    contradictions.push("declares both readOnlyHint and destructiveHint");
  }
  if (hints.destructive === true && !mutatingName && shape === "retrieval") {
    contradictions.push(`declares destructiveHint but is named and described like a read (${t.name})`);
  }
  const desc = (t.description ?? "").toLowerCase();
  // DELETED: a rule matching change-verb stems anywhere in the description.
  //
  // It was the most-cited contradiction we produced, 125 of 190 in a
  // 600-server sample, and an audit of the persisted transcripts showed it is
  // overwhelmingly false positives. It flagged `search_concepts` for "written
  // for practitioners", `get_concept` for "Written by a named human", and
  // `list_freelance_platforms` for "where a consultant can create a profile",
  // which lists platforms where somebody else does the creating.
  //
  // The rule was trying to answer a question about grammar: is this change
  // verb the TOOL'S action, in the active voice, describing what the tool
  // itself does. A word list cannot answer that, and no amount of tightening
  // makes it able to. This needs a model judge over the persisted transcript,
  // with its verdict recorded as an ordinary observation subject to the same
  // caps as any other.
  //
  // It is deleted rather than tightened because a false positive here is not a
  // missed opportunity, it is a published accusation that a named operator's
  // tool lies about being read-only. The structural checks below use the name,
  // the annotations and the schema, and they hold up.

  // A destructive tool that can be called with no arguments at all is a
  // blast-radius finding on its own: the empty call is a valid call.
  const props = properties(t.inputSchema);
  const required = requiredFields(t.inputSchema);
  const looksMutating = mutatingName || hints.destructive === true || hints.readOnly === false;
  if (looksMutating && required.length === 0 && Object.keys(props).length > 0) {
    contradictions.push("mutating tool has no required parameters, so an empty call is valid");
  }

  // Read-only, by either of two paths.
  //
  // Requiring an affirmative readOnlyHint was the first rule, and it made the
  // classifier useless: 53% of tools in the first real sample carry no
  // annotations at all, so 622 of 937 tools landed as untouchable while 401
  // were retrieval-shaped. A tool named search_documents(query) with a
  // read-shaped description and no mutating signal anywhere was being treated
  // as dangerous for want of an annotation the protocol added recently.
  //
  // Declining to trust ONE unverified hint is right. Making that hint the only
  // admissible evidence is a different thing. Multi-signal agreement across
  // name, description and schema is the same standard of evidence the
  // classifier applies everywhere else, so it is the second path.
  const noAnnotations = hints.readOnly === null && hints.destructive === null && hints.idempotent === null;
  const readShaped = shape === "retrieval" || shape === "public_data" || shape === "transform";
  // The same broad pattern is KEPT here, and only here, because the two uses
  // fail in opposite directions. As a published contradiction a false positive
  // accuses an operator of lying. As a guard on whether we will call a tool, a
  // false positive only costs us coverage: we decline to exercise something
  // that was safe. Over-caution about what we send is the right bias, so the
  // guard keeps the wide net the finding could not justify.
  const descriptionMentionsChange = /\b(delet|remov|writ|modif|updat|insert|send|charg|deploy|purge|revok|creat)/.test(desc);
  const inferredReadOnly =
    noAnnotations && readShaped && !mutatingName && !descriptionMentionsChange && contradictions.length === 0;

  const declaredReadOnly =
    hints.readOnly === true && !mutatingName && hints.destructive !== true && contradictions.length === 0;

  if (declaredReadOnly || inferredReadOnly) {
    return {
      tool: t.name,
      shape,
      binding: { kind: "read_only", basis: declaredReadOnly ? "declared" : "inferred" },
      contradictions,
      hints,
    };
  }

  // Can we supply the target? Whole-name matching on parameters, so
  // `recipient_email` counts and `email_body` does not.
  const paramNames = Object.keys(props).map(normalizeParam);
  for (const entry of TARGET_PARAMETERS) {
    const hit = entry.names.find((n) => paramNames.includes(n));
    if (hit === undefined) continue;
    return {
      tool: t.name,
      shape: shape === "unknown" ? entry.shape : shape,
      binding: { kind: "substitutable", parameter: hit, capability: entry.capability },
      contradictions,
      hints,
    };
  }

  return {
    tool: t.name,
    shape,
    binding: {
      kind: "operator_bound",
      reason:
        Object.keys(props).length === 0
          ? "takes no parameters, so there is no target to redirect"
          : "no parameter names a target we could substitute",
    },
    contradictions,
    hints,
  };
}

export function classifyTools(tools: readonly ToolDeclaration[]): ToolClassification[] {
  return tools.map(classifyTool);
}

/** Capabilities a set of tools would need before any of them could be exercised. */
export function requiredCapabilities(classifications: readonly ToolClassification[]): CapabilityId[] {
  const out = new Set<CapabilityId>();
  for (const c of classifications) {
    if (c.binding.kind === "substitutable") out.add(c.binding.capability);
    if (c.binding.kind === "read_only" && c.shape === "public_data") out.add(CAPABILITIES.reference_data);
  }
  return [...out].sort();
}

/**
 * How much of a server we could actually test with the capabilities we hold.
 * The census reads this to say what provisioning would unlock.
 */
export function testability(
  classifications: readonly ToolClassification[],
  held: ReadonlySet<CapabilityId>,
): { testable: number; blocked: number; operatorBound: number; missing: CapabilityId[] } {
  let testable = 0;
  let blocked = 0;
  let operatorBound = 0;
  const missing = new Set<CapabilityId>();
  for (const c of classifications) {
    if (c.binding.kind === "read_only") {
      if (c.shape === "public_data" && !held.has(CAPABILITIES.reference_data)) {
        // Still testable without a reference; only the ground-truth check is lost.
        missing.add(CAPABILITIES.reference_data);
      }
      testable += 1;
    } else if (c.binding.kind === "substitutable") {
      if (held.has(c.binding.capability)) testable += 1;
      else {
        blocked += 1;
        missing.add(c.binding.capability);
      }
    } else {
      operatorBound += 1;
    }
  }
  return { testable, blocked, operatorBound, missing: [...missing].sort() };
}
