/**
 * Provider adapters: the same JudgeClient contract over three vendors.
 *
 * The point of this file is that the judge does not know who is answering it.
 * `JudgeClient` is one function type; OpenAI, Anthropic and xAI each get an
 * implementation, and everything upstream — the panel, the metrics, the
 * observations — is written against the contract rather than a vendor.
 *
 * That matters for a reason beyond tidiness. The whole argument for a
 * multi-vendor panel is DECORRELATION: two models from one lab share training
 * data, RLHF lineage and tokenizer, so their agreement is an echo rather than
 * evidence. A codebase that can only really call one vendor quietly collapses
 * back to a single-family panel the first time an adapter is inconvenient.
 *
 * THREE RULES THAT ARE NOT NEGOTIABLE PER-VENDOR
 *
 * 1. STRUCTURED OUTPUT IS FORCED AT THE API LEVEL, not requested in prose.
 *    OpenAI and xAI get a strict json_schema response format; Anthropic gets a
 *    forced tool call. A model that can emit free text has a channel through
 *    which a manipulated judge could emit something that acts, and rule 3 of
 *    judge/index.ts exists to close exactly that.
 *
 * 2. NO REPAIR PASS. If a provider returns something unparseable or a verdict
 *    outside the permitted set, that is a JudgeError and the item is recorded
 *    as a harness failure. We do not re-prompt, coerce, or regex a verdict out
 *    of prose. Schema discipline is one of the three admission gates (G2), and
 *    a harness that silently repairs bad output cannot measure it.
 *
 * 3. MODEL IDS ARE VALIDATED AT RUN TIME, NEVER TRUSTED FROM SOURCE. Model
 *    identifiers rot faster than any other constant in this repository, and a
 *    typo silently falling back to a vendor default would invalidate an entire
 *    experiment while producing perfectly plausible numbers. `validateModels`
 *    lists what the account can actually reach and refuses to start otherwise.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { JudgeClient, JudgeRequest, JudgeResponse } from "./index.js";
import { JudgeError, composeRequest } from "./index.js";

export type Vendor = "openai" | "anthropic";
/** `meta` is the single model that reads the deciders' results and recommends. */
export type Tier = "cheap" | "premium" | "meta";

/**
 * A seat in the experiment.
 *
 * Named seats rather than (vendor, tier) lookups, because with three voters
 * drawn from two vendors one vendor necessarily holds two seats, and a lookup
 * keyed on vendor could not tell them apart. The doubling is forced by the
 * shape — it is not a preference — and naming the seats is what makes it
 * visible in the roster instead of implicit in a loop.
 */
export type RosterSlot =
  | "voter_1"
  | "voter_2"
  | "voter_3"
  | "voter_4"
  | "decider_1"
  | "decider_2"
  | "meta";

/**
 * A model we intend to use, and whether anyone has confirmed it exists.
 *
 * `verified` is about OUR knowledge, not the vendor's catalogue. Anthropic ids
 * come from the claude-api skill and are checked; the other two are written
 * from public documentation and must be confirmed against the live models
 * endpoint before a run counts. Recording that distinction beats pretending it
 * is not there.
 */
export type ModelChoice = {
  slot: RosterSlot;
  vendor: Vendor;
  tier: Tier;
  /** The id sent on the wire. */
  id: string;
  verified: boolean;
  note: string;
};

/**
 * The panel roster.
 *
 * Deliberately a plain constant a human can read and correct in one place,
 * because "which model was that, exactly" is the first question anyone will
 * ask of the results, and the answer must not require reading three scripts.
 */
/**
 * The roster.
 *
 * GENERATION PARITY IS PART OF FAIRNESS. An earlier version of this file paired
 * current Claude models against `gpt-5` and `gpt-5-mini`, which the account's
 * own model listing shows to be a generation behind — it offers up to the 5.6
 * family. Any accuracy gap measured that way would have been partly a gap
 * between release dates, and nothing in the results would have said so. The ids
 * below were chosen from the live listing.
 *
 * FOUR VOTERS, EVENLY SPLIT. Two Anthropic against two OpenAI, so neither lab
 * can carry a majority alone: three of four is the threshold, and a two-two
 * vendor split is a tie the panel abstains on rather than a win for whichever
 * lab happens to hold the extra seat. That is the main thing the even shape
 * buys over three voters, where one lab always had the numbers.
 *
 * PRICE IS NOT MATCHED ACROSS THE BLOCS and should not be read as quality. The
 * OpenAI pair is cheaper per token than the Anthropic pair at every seat. The
 * measurement is accuracy against labels; cost is reported separately and
 * deliberately does not enter the ranking.
 *
 * THIS ROSTER IS DATA, NOT ARCHITECTURE. The shape is expected to change. Every
 * metric is written against whatever seats are present, and `voterSubsets` in
 * metrics.ts re-derives the accuracy of EVERY smaller voter combination from
 * one run's stored votes — so the question "which models do we actually need"
 * is answered offline rather than by paying for another grid.
 */
export const ROSTER: readonly ModelChoice[] = [
  // --- voters: two Anthropic, two OpenAI ---
  {
    slot: "voter_1",
    vendor: "anthropic",
    tier: "cheap",
    id: "claude-haiku-4-5-20251001",
    verified: true,
    note: "id from the claude-api skill",
  },
  {
    slot: "voter_2",
    vendor: "anthropic",
    tier: "cheap",
    id: "claude-sonnet-5",
    verified: true,
    note: "the stronger half of the Anthropic bloc",
  },
  {
    slot: "voter_3",
    vendor: "openai",
    tier: "cheap",
    id: "gpt-5.4-mini",
    verified: false,
    note: "confirmed present in the account's live listing; re-checked at run time",
  },
  {
    slot: "voter_4",
    vendor: "openai",
    tier: "cheap",
    id: "gpt-5.4-nano",
    verified: false,
    note: "the cheapest voter; whether it clears the refusal gate is part of what we are measuring",
  },
  // --- deciders: one each ---
  {
    slot: "decider_1",
    vendor: "openai",
    tier: "premium",
    id: "gpt-5.5",
    verified: false,
    note: "confirmed present in the account's live listing; re-checked at run time",
  },
  {
    slot: "decider_2",
    vendor: "anthropic",
    tier: "premium",
    id: "claude-opus-5",
    verified: true,
    note: "id from the claude-api skill",
  },
  // --- meta ---
  {
    slot: "meta",
    vendor: "anthropic",
    tier: "meta",
    id: "claude-fable-5-1",
    verified: true,
    note: "reads both deciders' results; rejects forced tool use, hence structured outputs. Not a decider itself, so it never grades its own output",
  },
];

export function chooseModel(slot: RosterSlot): ModelChoice {
  const found = ROSTER.find((m) => m.slot === slot);
  if (found === undefined) throw new JudgeError(`no model configured for slot ${slot}`);
  return found;
}

/** Where a vendor's key lives, and where its API is. One place, so nothing guesses. */
export const VENDOR_CONFIG: Record<Vendor, { envVar: string; baseUrl: string; capability: string; provisioning: string }> = {
  openai: {
    envVar: "OPENAI_API_KEY",
    baseUrl: "https://api.openai.com/v1",
    capability: "judge_model_openai",
    provisioning: "OpenAI platform account with an API key in OPENAI_API_KEY, billing enabled",
  },
  anthropic: {
    envVar: "ANTHROPIC_API_KEY",
    baseUrl: "https://api.anthropic.com/v1",
    capability: "judge_model_anthropic",
    provisioning: "Anthropic Console account with an API key in ANTHROPIC_API_KEY (a host-managed CLI session is not a usable key)",
  },
};

/** The one schema every vendor is forced into. Mirrors JudgeResponse exactly. */
function verdictSchema(allowed: readonly string[]) {
  return {
    type: "object",
    properties: {
      verdict: { type: "string", enum: [...allowed] },
      reason: { type: "string" },
      injection_attempt: { type: "boolean" },
    },
    required: ["verdict", "reason", "injection_attempt"],
    additionalProperties: false,
  };
}

/**
 * Flatten a request into the two messages every vendor understands.
 *
 * The split is load-bearing and survives here: our instruction is the system
 * message, subject-authored content is the user message. They are never
 * concatenated, so no refactor can accidentally promote fenced evidence into
 * the instruction position.
 */
function messages(request: JudgeRequest): { system: string; user: string } {
  // The one place a request becomes a message. composeRequest applies the
  // preamble, the permitted-verdict list and the fence here so that no caller
  // — voter, decider, meta pass or anything added later — can reach a model
  // without them.
  const req = composeRequest(request);
  const user = Object.entries(req.untrusted)
    .map(([, fenced]) => fenced)
    .join("\n\n");
  return { system: req.instruction, user };
}

type FetchLike = typeof fetch;

export type AdapterOptions = {
  apiKey: string;
  model: string;
  baseUrl?: string;
  fetchImpl?: FetchLike;
  /** Cheap models are the ones most likely to ramble; the cap is a backstop, not the control. */
  maxTokens?: number;
  timeoutMs?: number;
  /**
   * Anthropic only, and only for an ORG-SCOPED key.
   *
   * A key created at the organization level rather than inside a workspace is
   * rejected on every request — models listing included — until the request
   * names a workspace. The error is a 400 that reads like a malformed request,
   * so it is worth saying plainly: this is an account-shape problem, not a bug
   * in the call. A workspace-scoped key needs none of this.
   */
  workspaceId?: string;
};

async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  opts: { fetchImpl?: FetchLike; timeoutMs?: number },
): Promise<unknown> {
  const f = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 120_000);
  try {
    const res = await f(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      // The status matters downstream: 401/403 is a credential problem (ours),
      // 429 is a rate limit (ours), 5xx is the vendor. All three are harness
      // faults, none of them is a fact about the subject being judged.
      throw new JudgeError(`${url} returned HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new JudgeError(`${url} returned unparseable JSON: ${text.slice(0, 200)}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

/** Parse and validate a payload that claims to be a JudgeResponse. No repair. */
function parseVerdict(
  raw: unknown,
  allowed: readonly string[],
  usage?: { input_tokens: number; output_tokens: number },
): JudgeResponse {
  if (typeof raw !== "object" || raw === null) throw new JudgeError("judge payload was not an object");
  const o = raw as Record<string, unknown>;
  if (typeof o.verdict !== "string") throw new JudgeError("judge payload had no string verdict");
  if (!allowed.includes(o.verdict)) {
    throw new JudgeError(`judge returned an unpermitted verdict ${JSON.stringify(o.verdict)}`);
  }
  return {
    verdict: o.verdict,
    reason: typeof o.reason === "string" ? o.reason : "",
    ...(o.injection_attempt === true ? { injection_attempt: true } : {}),
    ...(usage === undefined ? {} : { usage }),
  };
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * OpenAI and xAI share a wire format, so they share an adapter.
 *
 * `strict: true` is what makes gate G2 measurable: the provider enforces the
 * schema, so a G2 failure is a genuine provider-side inability rather than our
 * prompt being unpersuasive.
 */
function openAiCompatible(vendor: Vendor, options: AdapterOptions): JudgeClient {
  const base = options.baseUrl ?? VENDOR_CONFIG[vendor].baseUrl;
  return async (req: JudgeRequest): Promise<JudgeResponse> => {
    const { system, user } = messages(req);
    const body = {
      model: options.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_completion_tokens: options.maxTokens ?? 512,
      response_format: {
        type: "json_schema",
        json_schema: { name: "verdict", strict: true, schema: verdictSchema(req.allowed) },
      },
    };
    const res = (await postJson(
      `${base}/chat/completions`,
      { authorization: `Bearer ${options.apiKey}` },
      body,
      options,
    )) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const content = res.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new JudgeError(`${vendor} returned no message content`);
    let parsed: unknown;
    try {
      parsed = JSON.parse(content) as unknown;
    } catch {
      throw new JudgeError(`${vendor} returned non-JSON content despite strict schema`);
    }
    return parseVerdict(parsed, req.allowed, {
      input_tokens: num(res.usage?.prompt_tokens),
      output_tokens: num(res.usage?.completion_tokens),
    });
  };
}

export function openAiJudge(options: AdapterOptions): JudgeClient {
  return openAiCompatible("openai", options);
}

/**
 * Anthropic, through the official SDK, using STRUCTURED OUTPUTS.
 *
 * The first version of this forced a tool call — `tool_choice: {type: "tool"}`
 * — which is the usual way to guarantee a shape. It would have returned a 400
 * on every single meta-pass call, because Claude Fable 5.1 rejects forced tool
 * use (`any` and `tool` both), and Fable is the model reading the deciders'
 * results. The failure would have arrived only at the last step of a paid run.
 *
 * `output_config.format` is the right mechanism anyway: the forced tool call
 * only ever existed to get JSON back, which is exactly the case the docs point
 * at structured outputs for. It works uniformly across Haiku, Opus and Fable,
 * so all three Anthropic legs share one code path.
 *
 * The schema is built per call, because the permitted verdicts differ per task
 * and the enum is what makes an out-of-vocabulary answer impossible rather than
 * merely unlikely.
 */
export function anthropicJudge(options: AdapterOptions): JudgeClient {
  const client = new Anthropic({
    apiKey: options.apiKey,
    ...(options.baseUrl === undefined ? {} : { baseURL: options.baseUrl.replace(/\/v1$/, "") }),
    ...(options.timeoutMs === undefined ? {} : { timeout: options.timeoutMs }),
    ...(options.workspaceId === undefined
      ? {}
      : { defaultHeaders: { "anthropic-workspace-id": options.workspaceId } }),
  });
  return async (req: JudgeRequest): Promise<JudgeResponse> => {
    const { system, user } = messages(req);
    const allowed = req.allowed;
    if (allowed.length === 0) throw new JudgeError("no permitted verdicts");
    const schema = z.object({
      verdict: z.enum(allowed as [string, ...string[]]),
      reason: z.string(),
      injection_attempt: z.boolean(),
    });

    // No `thinking` parameter: Fable has it always on and rejects any explicit
    // configuration, and the other two default sensibly. No sampling params
    // either — removed on this whole generation.
    //
    // Deliberately NO refusal `fallbacks`, against the SDK guide's default. A
    // fallback silently re-runs the request on a different model, and this
    // harness exists to attribute a verdict to the model that produced it.
    // Rescuing a refusal by substituting another model would put one model's
    // answer under another's name in the results table. A refusal is recorded
    // as a harness failure instead, which is the honest outcome.
    const res = await client.messages.parse({
      model: options.model,
      max_tokens: options.maxTokens ?? 2048,
      system,
      messages: [{ role: "user", content: user }],
      output_config: { format: zodOutputFormat(schema) },
    });

    if (res.stop_reason === "refusal") {
      throw new JudgeError(`anthropic declined: ${res.stop_details?.category ?? "unspecified"}`);
    }
    if (res.parsed_output === null || res.parsed_output === undefined) {
      throw new JudgeError("anthropic returned no parseable structured output");
    }
    return parseVerdict(res.parsed_output, req.allowed, {
      input_tokens: num(res.usage?.input_tokens),
      output_tokens: num(res.usage?.output_tokens),
    });
  };
}

export function judgeFor(vendor: Vendor, options: AdapterOptions): JudgeClient {
  return vendor === "openai" ? openAiJudge(options) : anthropicJudge(options);
}

/**
 * Ask each vendor which models the account can actually reach.
 *
 * Rule 3. A run that starts against a mistyped model id produces a complete,
 * plausible, worthless result set, and nothing downstream would ever reveal it.
 * Cheap to check once; impossible to detect later.
 */
export async function validateModels(
  wanted: readonly ModelChoice[],
  keys: Partial<Record<Vendor, string>>,
  fetchImpl?: FetchLike,
  workspaceId?: string,
): Promise<{ ok: ModelChoice[]; missing: { choice: ModelChoice; detail: string }[] }> {
  const byVendor = new Map<Vendor, Set<string>>();
  const failures = new Map<Vendor, string>();
  for (const vendor of new Set(wanted.map((w) => w.vendor))) {
    const key = keys[vendor];
    if (key === undefined || key.length === 0) {
      failures.set(vendor, `${VENDOR_CONFIG[vendor].envVar} is not set`);
      continue;
    }
    const headers: Record<string, string> =
      vendor === "anthropic"
        ? {
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
            ...(workspaceId === undefined ? {} : { "anthropic-workspace-id": workspaceId }),
          }
        : { authorization: `Bearer ${key}` };
    try {
      const f = fetchImpl ?? fetch;
      const res = await f(`${VENDOR_CONFIG[vendor].baseUrl}/models`, { headers });
      if (!res.ok) {
        failures.set(vendor, `models listing returned HTTP ${res.status}`);
        continue;
      }
      const body = (await res.json()) as { data?: { id?: string }[] };
      byVendor.set(vendor, new Set((body.data ?? []).map((d) => String(d.id))));
    } catch (err) {
      failures.set(vendor, err instanceof Error ? err.message.slice(0, 160) : "models listing threw");
    }
  }

  const ok: ModelChoice[] = [];
  const missing: { choice: ModelChoice; detail: string }[] = [];
  for (const choice of wanted) {
    const vendorFailure = failures.get(choice.vendor);
    if (vendorFailure !== undefined) {
      missing.push({ choice, detail: vendorFailure });
      continue;
    }
    const ids = byVendor.get(choice.vendor);
    if (ids !== undefined && !ids.has(choice.id)) {
      missing.push({ choice, detail: `model id ${choice.id} not offered to this account` });
      continue;
    }
    ok.push(choice);
  }
  return { ok, missing };
}

/** Read whatever keys the environment has, without asserting any of them exist. */
export function keysFromEnv(env: NodeJS.ProcessEnv = process.env): Partial<Record<Vendor, string>> {
  const out: Partial<Record<Vendor, string>> = {};
  for (const vendor of Object.keys(VENDOR_CONFIG) as Vendor[]) {
    const v = env[VENDOR_CONFIG[vendor].envVar];
    if (typeof v === "string" && v.length > 0) out[vendor] = v;
  }
  return out;
}
