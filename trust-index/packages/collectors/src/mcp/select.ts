/**
 * Which tools we probe, and why those.
 *
 * THE TWO DEFECTS THIS REPLACES
 *
 * Selection used to be a loop inside scripts/assess.mts that walked each
 * server's declared tools IN THE ORDER THE SERVER DECLARED THEM and took the
 * first N that classified read-only. Two consequences, both measured against
 * the persisted transcripts rather than argued from theory.
 *
 * 1. THE OPERATOR CHOSE WHAT WE TESTED. Declaration order is the operator's to
 *    set, and it costs nothing to set it. `ai.mitosislabs_mitosis` declares 14
 *    tools; the first six are `cortex_*` reads of the user's private memory
 *    that all return HTTP 401, and the three that need no sign-in at all
 *    (`get_platform_status`, `search_docs`, `list_skills`) sit at positions
 *    12-14. The server was recorded as entirely un-ratable because of where its
 *    tools appear in a list. An auth triage of 49 servers found seven with that
 *    shape. This is the same class as every other gaming hole found in this
 *    project and it needed no cleverness at all.
 *
 * 2. THE PER-SHAPE CAP WAS GLOBAL AND SILENT. `--per-shape` counted across ALL
 *    servers, so once ten `retrieval` tools had been taken from ten servers,
 *    every later server with only retrieval tools got nothing — and nothing was
 *    printed to say so. Replayed over the 600 stored transcripts at the shipped
 *    defaults: of 161 servers with at least one read-only tool, 22 were probed
 *    and 139 got zero. The published population only ever existed because
 *    somebody passed a large `--per-shape` at the console. Nothing in the code
 *    guaranteed it.
 *
 * WHAT REPLACES THEM
 *
 * Rank each server's eligible tools by how much probing them can actually tell
 * us, take the top few PER SERVER, and apply any global budget afterwards,
 * out loud. The signals are all things the battery itself will hit:
 *
 *   - a required parameter that asks for a credential means a 401 whatever we
 *     send, so the call measures our lack of an account and nothing else;
 *   - required parameters we cannot synthesize mean we are testing our
 *     synthesizer rather than their tool;
 *   - a free-text string parameter is what the input-sensitivity, fabrication
 *     and injection arms VARY. Without one the battery skips all three by its
 *     own rule, so the tool can answer at most half the questions we ask;
 *   - a declared output schema is what makes `honours_output_schema` checkable
 *     at all;
 *   - a description is what an expected response shape gets derived from.
 *
 * Note what that list is not. It does not reward a tool for being likely to
 * pass. Every signal is about whether a CHECK CAN RUN, so an operator who wants
 * to move up it has to declare better schemas and write better descriptions,
 * which is the behaviour we would like to cause. What they cannot do is reorder
 * a list.
 *
 * THE RULE THAT DECIDES WHICH DECLARED SIGNALS ARE ADMISSIBLE
 *
 * Every input here is written by the operator, so "do not trust the operator" is
 * not available as a rule. The usable one is narrower and it is the test each
 * signal below has to pass: A SIGNAL IS ADMISSIBLE ONLY IF THE SELF-INTERESTED
 * LIE COSTS THE OPERATOR SOMETHING.
 *
 *   Admissible, promoting: an output schema, a real description. Getting the
 *   promotion requires actually doing the thing, and the thing is good.
 *   Admissible, demoting: a required credential parameter, a description saying
 *   the tool reads the caller's own data. Claiming either falsely demotes their
 *   own tool, and the credential claim also fires `mcp.credential_parameter`.
 *
 *   NOT admissible: the server's handshake instructions naming specific tools as
 *   free or public. Mitosis's instructions do exactly that, accurately, and
 *   reading them would have made this module's headline number look better. It
 *   is still declaration-order gaming wearing a sentence: an operator who writes
 *   "public tools that need no sign-in: a, b, c" picks our whole budget of
 *   three. The signal is left on the table deliberately.
 *
 * WHAT IT DOES NOT SOLVE, STATED PLAINLY
 *
 * An operator who wants one specific tool never probed can still make it
 * unattractive: strip its description, give it a required `api_key`, declare no
 * output schema. It sinks in the ranking, and with a budget of three on a wide
 * surface it may never be reached. Diversity (below) spreads the budget across
 * shapes and name stems so a single hostile tool cannot hide behind a crowd of
 * near-identical siblings, and that is a mitigation, not a fix. The real answer
 * is a larger budget on servers whose surface is wide, which costs somebody
 * else's server time and is a decision for the account owner, not a default.
 */
import { isCredentialParam } from "./assess.js";
import { firstStringParameter, parameterKind } from "./battery.js";
import { synthesizeInput } from "./invoke.js";
import { orderingKey } from "./probe-identity.js";
import { classifyTool, type ToolClassification } from "./shape.js";
import type { ProbeTranscript, ToolDeclaration } from "./transcript.js";

/**
 * Tools per server, by default.
 *
 * One is enough to ask "does this server work". It is NOT enough to ask "is
 * there a bad tool in here", which is the question the occurrence gates
 * (`mcp.tool_obeys_injection`, `mcp.tool_fabricates`, `mcp.tool_leaks_internals`)
 * exist for and the one a 199-decoy dilution attack targets: at a budget of one,
 * a hostile tool anywhere but first is never called. Three is the compromise the
 * old comment already argued for while the constant next to it said 1 — some
 * multi-tool coverage without multiplying the load we put on somebody else's
 * server by the size of their surface.
 */
export const MAX_TOOLS_PER_SERVER = 3;

/**
 * How much a tool loses for repeating a group already taken from its own server.
 *
 * Sized against the weights below: enough that a fresh group beats a second
 * sibling of comparable quality, not enough that a markedly better tool loses to
 * a markedly worse one for the sake of variety. Three `cortex_*` memory reads
 * are one observation about a server repeated three times; three tools of
 * different shapes are three.
 */
const DIVERSITY_PENALTY = 2.5;

/**
 * What each signal is worth, and why.
 *
 * Provisional in the SPEC 12 sense: chosen by reasoning about which battery arms
 * each signal unlocks, to be replaced by calibration against which selections
 * actually produced observations. Named constants rather than inline literals so
 * that calibration moves them in one place.
 */
export const SELECTION_WEIGHTS = {
  /**
   * No required parameter asks for a credential. A tool demanding an API key
   * returns 401 whatever we send it, and every check downstream of the baseline
   * is then skipped. This is the strongest single predictor of a wasted probe.
   */
  credential_free: 3,
  /**
   * Every required parameter can be filled from the declaration alone. When it
   * cannot, the call tests our synthesizer rather than their tool — the
   * `our_arguments` verdict, 16 of 205 apparent failures in the run that
   * diagnoseInvocation was written for.
   */
  synthesizable: 3,
  /**
   * A free-text string parameter to vary. `input_sensitivity`, `no_fabrication`
   * and `injection_resistance` are all comparisons between two calls that differ
   * in one string, and the battery skips all three when there is none. Half the
   * battery lives here.
   */
  free_text_parameter: 3,
  /**
   * A required string parameter that is an identifier rather than free text.
   * Worth less than free text and much more than nothing: the battery can still
   * vary it, but an invented identifier makes an empty answer expected, so
   * `answers_substantively` drops out.
   */
  identifier_parameter: 1,
  /**
   * A declared output schema. `honours_output_schema` is null without one — not
   * failed, absent. Declaring one is what makes the response checkable against
   * the server's own contract.
   */
  output_schema: 2,
  /** Prose at all, at the threshold the rubric already calls useful. */
  described: 1,
  /**
   * Enough prose to derive a specific expected shape from, which is what
   * `matches_described_shape` asks a judge to do. A twenty-character
   * description is a label; it does not predict a response.
   */
  well_described: 1,
  /**
   * Takes no arguments. A small bonus, not a large one: nothing of ours can be
   * blamed for the answer, which makes the result unusually clean, but it also
   * means there is nothing to vary.
   */
  argument_free: 1,
  /**
   * The tool does not say it reads the CALLER'S OWN data.
   *
   * The auth triage calls this the empty-account problem and names it the
   * single strongest filter on whether a credential would even help: roughly
   * half the servers behind a 401 read the user's own logs, calendar, food
   * diary, memories or deployed sites, and a fresh account returns empty from
   * all of them. We hold no account anywhere, so a tool whose own description
   * says it reads "the user's memory" or "your workspace" returns 401 or empty
   * whatever we send it — the same dead end as a required `api_key`, reached by
   * a different door.
   *
   * Weighted above any single check because it does not cost us one check, it
   * costs us the baseline and therefore all six arms that depend on it.
   */
  no_account_implied: 4,
} as const;

/** The threshold assess.ts already uses for "a description that tells a caller something". */
const MIN_USEFUL_DESCRIPTION_CHARS = 20;
/** Long enough that an expected response shape can be derived from it. */
const WELL_DESCRIBED_CHARS = 80;

/**
 * Whose data does this tool read?
 *
 * A possessive naming the CALLER, followed closely by a noun for a data store.
 * "the user's private memory", "your workspace", "their food diary",
 * "account's sites". Two deliberate restrictions:
 *
 *   The window stops at a clause boundary. Without that, "written in the user's
 *   own words is fine; it is matched against the whole library" matched across a
 *   semicolon and read as a library belonging to the user.
 *
 *   The possessive must name the caller, never the operator. "our catalogue" is
 *   the operator's public corpus and is exactly the thing we CAN probe.
 *
 * Validated rather than asserted: over the 1,143 eligible read-only tools in the
 * stored transcripts it fires on 54 of them (4.7%, across 22 servers), and that
 * set lines up with the auth triage's
 * independently-compiled "own-account" list — contabo's `your account` fleet
 * tools, forkmate's food diary, gondola's trips, memoryrouter's vault,
 * mitosis's memory. It is a prose pattern, with all the limits this codebase has
 * already paid for once: the rule that matched change verbs in descriptions was
 * deleted for being 125 false positives out of 190. The difference is what a
 * false positive costs. That rule published an accusation that a named
 * operator's tool lies. This one demotes a tool in our own probe queue, which
 * costs us coverage and costs the operator nothing — the same asymmetry that
 * justifies the deliberately wide call-guard in shape.ts.
 */
// The apostrophe class is not fussiness. `fetch` on mitosis reads "the user’s
// memory" with U+2019 and `search` reads "the user's own private memory" with
// U+0027, in the same tool list; a straight-quote-only pattern demoted one and
// not the other, which is a coin flip dressed as a rule.
const CALLER_POSSESSIVE = /\b(?:the |this )?(?:users?['’]s?|caller['’]?s|account['’]?s|customer['’]?s|owner['’]?s|your|their)\b/gi;
const OWNED_STORE =
  /^[^.;()\n—]{0,40}?\b(memor(?:y|ies)|accounts?|workspaces?|organi[sz]ations?|tenant|inbox|mailbox|e?mails?|calendars?|contacts|documents?|docs|files?|notes|datasets?|data|projects?|history|sites?|logs?|records?|vaults?|profiles?|librar(?:y|ies)|dashboards?|repositor(?:y|ies)|repos?|subscriptions?|orders?|bookmarks?|feeds?|graphs?|databases?|boards?|diar(?:y|ies)|instances?|secrets?|domains?|zones?)\b/i;

/** The phrase that made us think so, or null. Returned rather than a bare boolean so a selection can explain itself. */
export function readsCallerOwnedData(description: string | null): string | null {
  if (description === null) return null;
  CALLER_POSSESSIVE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CALLER_POSSESSIVE.exec(description)) !== null) {
    const tail = description.slice(m.index + m[0].length);
    const store = OWNED_STORE.exec(tail);
    if (store !== null) return `${m[0]}${store[0]}`.replace(/\s+/g, " ").trim();
  }
  return null;
}

export type SelectionSignal = {
  name: keyof typeof SELECTION_WEIGHTS;
  /** 0 or 1. Every signal here is a yes/no about whether a check can run. */
  value: 0 | 1;
  weight: number;
};

export type ToolInformativeness = {
  score: number;
  signals: SelectionSignal[];
  /** The signals that fired, for printing next to a selection. */
  reasons: string[];
};

function requiredParams(schema: unknown): Array<{ name: string; spec: Record<string, unknown> }> {
  if (typeof schema !== "object" || schema === null) return [];
  const s = schema as Record<string, unknown>;
  const props = typeof s.properties === "object" && s.properties !== null ? (s.properties as Record<string, unknown>) : {};
  const required = Array.isArray(s.required) ? s.required.filter((r): r is string => typeof r === "string") : [];
  return required.map((name) => {
    const spec = props[name];
    return { name, spec: typeof spec === "object" && spec !== null ? (spec as Record<string, unknown>) : {} };
  });
}

/**
 * How much can probing this tool tell us?
 *
 * Reads the declaration only. Makes no request, and deliberately shares its
 * predicates with the code that will do the probing — `synthesizeInput` decides
 * what we can send, `firstStringParameter` and `parameterKind` decide which
 * battery arms will run — so that a change to either moves the ranking with it
 * rather than leaving the selector predicting a battery that no longer exists.
 */
export function informativeness(declaration: ToolDeclaration): ToolInformativeness {
  const signals: SelectionSignal[] = [];
  const reasons: string[] = [];
  const add = (name: keyof typeof SELECTION_WEIGHTS, value: boolean, reason: string): void => {
    signals.push({ name, value: value ? 1 : 0, weight: SELECTION_WEIGHTS[name] });
    if (value) reasons.push(reason);
  };

  const required = requiredParams(declaration.inputSchema);
  const wantsCredential = required.some(({ name, spec }) =>
    isCredentialParam(name, typeof spec.description === "string" ? spec.description : null),
  );
  add("credential_free", !wantsCredential, "no required credential");

  // synthesizeInput skips exactly the parameters it will not fill. A required
  // parameter it skipped is one we cannot supply, so the call would measure us.
  const synth = synthesizeInput(declaration.inputSchema);
  const unfilled = required.filter(({ name }) => !Object.hasOwn(synth.args, name));
  add("synthesizable", unfilled.length === 0, "arguments synthesizable");

  const stringParam = firstStringParameter(declaration.inputSchema);
  const freeText = stringParam !== null && parameterKind(stringParam) === "freetext";
  add("free_text_parameter", freeText, `free-text parameter (${stringParam ?? ""})`);
  add("identifier_parameter", stringParam !== null && !freeText, `identifier parameter (${stringParam ?? ""})`);

  add("output_schema", declaration.outputSchema != null, "declares an output schema");

  const desc = (declaration.description ?? "").trim();
  add("described", desc.length >= MIN_USEFUL_DESCRIPTION_CHARS, "described");
  add("well_described", desc.length >= WELL_DESCRIBED_CHARS, "described in detail");

  add("argument_free", required.length === 0, "takes no arguments");

  const ownedBy = readsCallerOwnedData(declaration.description);
  add("no_account_implied", ownedBy === null, "does not read the caller's own data");
  if (ownedBy !== null) reasons.push(`reads the caller's own data ("${ownedBy}")`);

  const score = signals.reduce((sum, s) => sum + s.value * s.weight, 0);
  return { score, signals, reasons };
}

/**
 * Tools that are near-duplicates of each other, for the purposes of a budget.
 *
 * The classified shape plus the leading word of the name. `cortex_ask`,
 * `cortex_recall` and `cortex_manifest` are one group; `get_pricing` and
 * `search_docs` are two. The leading word is used because tool names are
 * verb-then-noun or namespace-then-verb, and either way the first word is what
 * the siblings share. Grouping is only ever a discount, never a ban, so a server
 * whose whole surface is `get_*` still gets its full allotment.
 */
export function diversityGroup(declaration: ToolDeclaration, shape: string): string {
  const lead = declaration.name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter((w) => w.length > 0)
    .map((w) => w.toLowerCase())[0];
  return `${shape}|${lead ?? ""}`;
}

export type SelectedTool = {
  server: string;
  endpoint: string;
  declaration: ToolDeclaration;
  classification: ToolClassification;
  shape: string;
  informativeness: ToolInformativeness;
  /** Where it placed among its own server's tools. 1 is the tool we most wanted. */
  rankInServer: number;
  /** The unguessable ordering key that settled ties. Recorded so a run can be audited. */
  tiebreak: string;
};

export type CapEvent = {
  server: string;
  endpoint: string;
  /** Tools this server kept after the cap. Zero means starved. */
  kept: number;
  /** Tools the cap took away from it. */
  dropped: number;
  /** Shapes it lost tools in. */
  shapes: string[];
};

export type SelectionResult = {
  selected: SelectedTool[];
  /**
   * Servers whose per-server allotment was cut by the global budget. Returned,
   * not swallowed: a budget that silently removes servers is the defect this
   * module was written to fix, and a caller that ignores this field is
   * reintroducing it.
   */
  trimmedByGlobalCap: CapEvent[];
  /** The subset that lost every tool. Each one is a server we chose not to rate. */
  starvedByGlobalCap: CapEvent[];
  /** Reached selection, had tools, none of them eligible. Not a defect; also not silence. */
  noEligibleTools: Array<{ server: string; endpoint: string; declared: number }>;
  /** Never reached selection, and why. */
  skippedServers: Array<{ server: string; endpoint: string; reason: string }>;
};

export type SelectionOptions = {
  /** Tools to take from each server. Defaults to MAX_TOOLS_PER_SERVER. */
  perServer?: number;
  /**
   * A GLOBAL cap on tools of one shape, across all servers.
   *
   * Off by default, and that is the fix rather than an oversight. A global cap
   * is a budget on our own effort; a per-server cap is a limit on the load any
   * one operator absorbs. Only the second is owed to anybody, and making the
   * first a default is what starved 139 of 161 servers without printing a word.
   * Pass a number to reinstate it, and read `trimmedByGlobalCap`.
   */
  perShape?: number | null;
  /** Restrict the eligible set, e.g. to tools that failed to answer last run. */
  only?: (endpoint: string, toolName: string) => boolean;
  /** Environment carrying TRUST_INDEX_PROBE_SEED. Injectable for tests. */
  env?: NodeJS.ProcessEnv;
};

export type SelectionInput = { server: string; transcript: ProbeTranscript };

/**
 * A tool is eligible if the code that will call it would agree to call it.
 *
 * `assertCallable` refuses anything not read-only and anything carrying a
 * declaration contradiction. Selecting a tool it would throw on spends a slot on
 * nothing, so the same two conditions are checked here.
 */
function eligible(c: ToolClassification): boolean {
  return c.binding.kind === "read_only" && c.contradictions.length === 0;
}

/**
 * Pick the tools to probe.
 *
 * Pure: transcripts in, a plan out, no requests made. The seed is read from the
 * environment for tie-breaks only.
 */
export function selectToolsForAssessment(
  inputs: readonly SelectionInput[],
  options: SelectionOptions = {},
): SelectionResult {
  const perServer = options.perServer ?? MAX_TOOLS_PER_SERVER;
  const perShape = options.perShape ?? null;
  const env = options.env ?? process.env;

  const selected: SelectedTool[] = [];
  const noEligibleTools: SelectionResult["noEligibleTools"] = [];
  const skippedServers: SelectionResult["skippedServers"] = [];

  for (const { server, transcript } of inputs) {
    if (transcript.tools?.ok !== true) {
      skippedServers.push({ server, endpoint: transcript.endpoint, reason: "tools/list did not succeed" });
      continue;
    }
    if (transcript.auth?.required === true) {
      skippedServers.push({ server, endpoint: transcript.endpoint, reason: "endpoint requires authentication" });
      continue;
    }

    const candidates = transcript.tools.declared
      .filter((d) => options.only === undefined || options.only(transcript.endpoint, d.name))
      .map((declaration) => ({ declaration, classification: classifyTool(declaration) }))
      .filter(({ classification }) => eligible(classification))
      .map(({ declaration, classification }) => ({
        declaration,
        classification,
        shape: classification.shape,
        informativeness: informativeness(declaration),
        group: diversityGroup(declaration, classification.shape),
        // Ties are settled by an HMAC of the seed, the endpoint and the tool
        // name. Not by name, because operators rename; not by position, because
        // position is the bug. Reproducible given the seed, unguessable without
        // it. See probe-identity.ts for what that does and does not buy.
        tiebreak: orderingKey(transcript.endpoint, declaration.name, env),
      }));

    if (candidates.length === 0) {
      if (transcript.tools.declared.length > 0) {
        noEligibleTools.push({ server, endpoint: transcript.endpoint, declared: transcript.tools.declared.length });
      } else {
        skippedServers.push({ server, endpoint: transcript.endpoint, reason: "declares no tools" });
      }
      continue;
    }

    // Greedy, re-ranking each round so the diversity discount reflects what has
    // already been taken from THIS server.
    const pool = [...candidates];
    const groupUses = new Map<string, number>();
    for (let rank = 1; rank <= perServer && pool.length > 0; rank += 1) {
      let bestIndex = 0;
      let bestEffective = -Infinity;
      let bestTiebreak = "";
      for (const [i, c] of pool.entries()) {
        const effective = c.informativeness.score - DIVERSITY_PENALTY * (groupUses.get(c.group) ?? 0);
        if (effective > bestEffective || (effective === bestEffective && c.tiebreak < bestTiebreak)) {
          bestEffective = effective;
          bestTiebreak = c.tiebreak;
          bestIndex = i;
        }
      }
      const [chosen] = pool.splice(bestIndex, 1);
      if (chosen === undefined) break;
      groupUses.set(chosen.group, (groupUses.get(chosen.group) ?? 0) + 1);
      selected.push({
        server,
        endpoint: transcript.endpoint,
        declaration: chosen.declaration,
        classification: chosen.classification,
        shape: chosen.shape,
        informativeness: chosen.informativeness,
        rankInServer: rank,
        tiebreak: chosen.tiebreak,
      });
    }
  }

  if (perShape === null || perShape <= 0) {
    return { selected, trimmedByGlobalCap: [], starvedByGlobalCap: [], noEligibleTools, skippedServers };
  }

  // The global budget, applied AFTER every server has its allotment and in an
  // order that spreads rather than truncates: every server's first choice
  // before any server's second. Alphabetical order by filename is what made the
  // old cap starve the back half of the registry, so within a rank the
  // unguessable tiebreak decides.
  const kept = new Set<SelectedTool>();
  const byShape = new Map<string, SelectedTool[]>();
  for (const s of selected) {
    const list = byShape.get(s.shape) ?? [];
    list.push(s);
    byShape.set(s.shape, list);
  }
  for (const list of byShape.values()) {
    const ordered = [...list].sort((a, b) =>
      a.rankInServer !== b.rankInServer ? a.rankInServer - b.rankInServer : a.tiebreak < b.tiebreak ? -1 : 1,
    );
    for (const s of ordered.slice(0, perShape)) kept.add(s);
  }

  const dropped = selected.filter((s) => !kept.has(s));
  const events = new Map<string, CapEvent>();
  for (const s of dropped) {
    const e = events.get(s.server) ?? { server: s.server, endpoint: s.endpoint, kept: 0, dropped: 0, shapes: [] };
    e.dropped += 1;
    if (!e.shapes.includes(s.shape)) e.shapes.push(s.shape);
    events.set(s.server, e);
  }
  for (const s of selected) {
    const e = events.get(s.server);
    if (e !== undefined && kept.has(s)) e.kept += 1;
  }
  const trimmedByGlobalCap = [...events.values()].sort((a, b) => b.dropped - a.dropped);

  return {
    selected: selected.filter((s) => kept.has(s)),
    trimmedByGlobalCap,
    starvedByGlobalCap: trimmedByGlobalCap.filter((e) => e.kept === 0),
    noEligibleTools,
    skippedServers,
  };
}

/**
 * The selection, as lines a human reads in a run log.
 *
 * Separate from the selection itself so the numbers cannot drift from what is
 * printed, and so a caller cannot quietly not print them: the starvation lines
 * are the whole point of the second defect being fixed.
 */
export function describeSelection(result: SelectionResult, perShape: number | null): string[] {
  const servers = new Set(result.selected.map((s) => s.server));
  const shapes = new Set(result.selected.map((s) => s.shape));
  const lines = [
    `selection: ${result.selected.length} tools across ${servers.size} servers and ${shapes.size} shapes`,
    `           ${result.skippedServers.length} servers not eligible (auth wall, no tools/list, or no tools declared)`,
    `           ${result.noEligibleTools.length} servers declared tools but none we may call`,
  ];
  if (perShape === null || perShape <= 0) {
    lines.push("           no global per-shape cap: every eligible server keeps its full allotment");
    return lines;
  }
  lines.push(`           global cap --per-shape ${perShape} removed ${result.trimmedByGlobalCap.reduce((n, e) => n + e.dropped, 0)} tools`);
  if (result.starvedByGlobalCap.length > 0) {
    lines.push(
      `           ${result.starvedByGlobalCap.length} SERVERS DROPPED TO ZERO TOOLS by that cap and will not be rated:`,
    );
    for (const e of result.starvedByGlobalCap) {
      lines.push(`             - ${e.server} (${e.dropped} tools, shapes: ${e.shapes.join(", ")})`);
    }
  }
  return lines;
}
