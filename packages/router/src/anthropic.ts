/**
 * Minimal Anthropic Messages API client (M6.5). Deliberately fetch-based —
 * no SDK dependency — so the surface is exactly what Nibbin uses and nothing
 * more: text in, text out, cache_control prefix discipline, usage accounting.
 *
 * Cost discipline by construction (§6.3):
 * - System prompt arrives as ordered blocks; blocks flagged `cache: true`
 *   carry cache_control ephemeral — the STABLE prefix (system + Grove
 *   Memory) caches, the volatile suffix never does. Callers cannot
 *   accidentally cache-bust the prefix because block order is theirs and the
 *   flag is per-block.
 * - max_tokens is REQUIRED — there is no unbounded call.
 * - Every response returns the full token/cache usage split for the
 *   model_calls COGS ledger; the caller records it.
 *
 * The client never accepts tools. C10 (the Grovekeeper has no hands) and the
 * runtime's draft-vs-execute gate stay structural: a model reply is always
 * text that flows into quarantine/approval paths, never a direct capability.
 */
import type { TokenUsage } from './pricing';

export interface SystemBlock {
  text: string;
  /** Cache this block (5-min ephemeral). Flag ONLY the stable prefix. */
  cache?: boolean;
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string } };

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

export interface GenerateRequest {
  model: string;
  system: SystemBlock[];
  messages: ChatTurn[];
  maxTokens: number;
  temperature?: number;
  /** Abort/timeout control; defaults to a 60s internal timeout. */
  signal?: AbortSignal;
}

export interface GenerateResult {
  text: string;
  usage: TokenUsage;
  stopReason: string | null;
  model: string;
}

export class AnthropicApiError extends Error {
  constructor(
    readonly status: number,
    readonly retryable: boolean,
    message: string,
  ) {
    super(message);
    this.name = 'AnthropicApiError';
  }
}

export interface AnthropicClientOptions {
  apiKey: string;
  baseUrl?: string;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Single retry on 429/5xx with this delay (ms); 0 disables. */
  retryDelayMs?: number;
  timeoutMs?: number;
}

interface ApiUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

interface ApiResponse {
  content?: Array<{ type: string; text?: string }>;
  stop_reason?: string | null;
  model?: string;
  usage?: ApiUsage;
  error?: { type?: string; message?: string };
}

export type Generate = (req: GenerateRequest) => Promise<GenerateResult>;

export function createAnthropicClient(opts: AnthropicClientOptions): Generate {
  const apiKey = opts.apiKey?.trim();
  if (!apiKey) throw new Error('anthropic client: apiKey is required');
  const baseUrl = (opts.baseUrl ?? 'https://api.anthropic.com').replace(/\/$/, '');
  const doFetch = opts.fetchImpl ?? fetch;
  const retryDelayMs = opts.retryDelayMs ?? 750;
  const timeoutMs = opts.timeoutMs ?? 60_000;

  async function callOnce(req: GenerateRequest): Promise<GenerateResult> {
    if (!Number.isInteger(req.maxTokens) || req.maxTokens <= 0) {
      throw new Error('generate: maxTokens must be a positive integer (pre-call ceiling, §6.2)');
    }
    if (req.system.length === 0 || req.messages.length === 0) {
      throw new Error('generate: system and messages are both required');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    if (req.signal) {
      req.signal.addEventListener('abort', () => controller.abort(), { once: true });
    }

    let res: Response;
    try {
      res = await doFetch(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: req.model,
          max_tokens: req.maxTokens,
          ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
          system: req.system.map((b) => ({
            type: 'text',
            text: b.text,
            ...(b.cache ? { cache_control: { type: 'ephemeral' } } : {}),
          })),
          messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
        }),
      });
    } catch (err) {
      throw new AnthropicApiError(0, true, `network failure calling model API: ${(err as Error).message}`);
    } finally {
      clearTimeout(timer);
    }

    const body = (await res.json().catch(() => ({}))) as ApiResponse;
    if (!res.ok) {
      const retryable = res.status === 429 || res.status >= 500;
      throw new AnthropicApiError(
        res.status,
        retryable,
        body.error?.message ?? `model API error ${res.status}`,
      );
    }

    const text = (body.content ?? [])
      .filter((c) => c.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text)
      .join('');
    const u = body.usage ?? {};
    return {
      text,
      stopReason: body.stop_reason ?? null,
      model: body.model ?? req.model,
      usage: {
        inputTokens: u.input_tokens ?? 0,
        cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
        cacheReadTokens: u.cache_read_input_tokens ?? 0,
        outputTokens: u.output_tokens ?? 0,
      },
    };
  }

  return async function generate(req: GenerateRequest): Promise<GenerateResult> {
    try {
      return await callOnce(req);
    } catch (err) {
      if (err instanceof AnthropicApiError && err.retryable && retryDelayMs > 0) {
        await new Promise((r) => setTimeout(r, retryDelayMs));
        return callOnce(req);
      }
      throw err;
    }
  };
}
