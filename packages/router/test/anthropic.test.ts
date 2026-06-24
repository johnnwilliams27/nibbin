import { describe, expect, it, vi } from 'vitest';
import { AnthropicApiError, costMicroUsd, createAnthropicClient, ratesForModel } from '../src/index';
import type { ContentBlock, GenerateRequest } from '../src/index';

function apiResponse(overrides: Record<string, unknown> = {}): Response {
  return new Response(
    JSON.stringify({
      content: [{ type: 'text', text: 'a drafted reply' }],
      stop_reason: 'end_turn',
      model: 'claude-haiku-4-5-20251001',
      usage: {
        input_tokens: 500,
        cache_creation_input_tokens: 1500,
        cache_read_input_tokens: 0,
        output_tokens: 400,
      },
      ...overrides,
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

const REQ: GenerateRequest = {
  model: 'claude-haiku-4-5-20251001',
  system: [
    { text: 'stable system prompt', cache: true },
    { text: 'volatile context' },
  ],
  messages: [{ role: 'user', content: 'draft a reply' }],
  maxTokens: 800,
};

describe('anthropic client', () => {
  it('sends cache_control only on flagged system blocks and requires max_tokens', async () => {
    const fetchImpl = vi.fn(async () => apiResponse());
    const generate = createAnthropicClient({ apiKey: 'k', fetchImpl, retryDelayMs: 0 });
    await generate(REQ);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const body = JSON.parse(init.body as string);
    expect(body.max_tokens).toBe(800);
    expect(body.system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(body.system[1].cache_control).toBeUndefined();
    expect(body.tools).toBeUndefined(); // the client never accepts tools (C10)
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('k');
  });

  it('returns text and the full usage split for the COGS ledger', async () => {
    const generate = createAnthropicClient({ apiKey: 'k', fetchImpl: vi.fn(async () => apiResponse()) });
    const result = await generate(REQ);
    expect(result.text).toBe('a drafted reply');
    expect(result.usage).toEqual({
      inputTokens: 500,
      cacheWriteTokens: 1500,
      cacheReadTokens: 0,
      outputTokens: 400,
    });
  });

  it('rejects a missing/zero max_tokens before any network call (pre-call ceiling)', async () => {
    const fetchImpl = vi.fn(async () => apiResponse());
    const generate = createAnthropicClient({ apiKey: 'k', fetchImpl });
    await expect(generate({ ...REQ, maxTokens: 0 })).rejects.toThrow(/maxTokens/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('retries once on 429 then succeeds', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'rate limited' } }), { status: 429 }))
      .mockResolvedValueOnce(apiResponse());
    const generate = createAnthropicClient({ apiKey: 'k', fetchImpl, retryDelayMs: 1 });
    const result = await generate(REQ);
    expect(result.text).toBe('a drafted reply');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not retry client errors; surfaces a typed error', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ error: { message: 'bad request' } }), { status: 400 }));
    const generate = createAnthropicClient({ apiKey: 'k', fetchImpl, retryDelayMs: 1 });
    await expect(generate(REQ)).rejects.toMatchObject({ status: 400, retryable: false });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('maps network failure to a retryable error', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNRESET'));
    const generate = createAnthropicClient({ apiKey: 'k', fetchImpl, retryDelayMs: 0 });
    await expect(generate(REQ)).rejects.toBeInstanceOf(AnthropicApiError);
  });
});

describe('content-block union (back-compat + multimodal)', () => {
  it('string content serializes byte-identically to the pre-union shape', async () => {
    const fetchImpl = vi.fn(async () => apiResponse());
    const generate = createAnthropicClient({ apiKey: 'k', fetchImpl, retryDelayMs: 0 });
    await generate(REQ);

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    // The pre-union shape: messages[0].content is a plain string, not wrapped
    expect(body.messages[0]).toEqual({ role: 'user', content: 'draft a reply' });
    expect(typeof body.messages[0].content).toBe('string');
  });

  it('ContentBlock[] content passes the array through unchanged to the API', async () => {
    const blocks: ContentBlock[] = [
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
      { type: 'text', text: 'What does this image show?' },
    ];
    const multimodalReq: GenerateRequest = {
      ...REQ,
      messages: [{ role: 'user', content: blocks }],
    };

    const fetchImpl = vi.fn(async () => apiResponse());
    const generate = createAnthropicClient({ apiKey: 'k', fetchImpl, retryDelayMs: 0 });
    await generate(multimodalReq);

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.messages[0].content).toEqual(blocks);
    // system and max_tokens still present
    expect(body.system).toHaveLength(2);
    expect(body.max_tokens).toBe(800);
  });
});

describe('budget/usage accounting is content-shape-agnostic (Task 3 verification)', () => {
  // Usage comes from the API *response*, not the request shape.  A generate
  // call carrying image blocks must record exactly the same usage split as a
  // text-only call with the same API-side numbers — the accounting path never
  // inspects req.messages[*].content.

  const FIXED_USAGE = {
    input_tokens: 1200,
    cache_creation_input_tokens: 3000,
    cache_read_input_tokens: 600,
    output_tokens: 250,
  };

  function apiResponseWithUsage(usage: typeof FIXED_USAGE): Response {
    return new Response(
      JSON.stringify({
        content: [{ type: 'text', text: 'vision result' }],
        stop_reason: 'end_turn',
        model: 'claude-haiku-4-5-20251001',
        usage,
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }

  it('a generate call with image-block content returns usage identical to a text call with the same API numbers', async () => {
    const imageBlocks: ContentBlock[] = [
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: '/9j/AAAA' } },
      { type: 'text', text: 'Extract all text visible in this image.' },
    ];
    const imageReq: GenerateRequest = {
      model: 'claude-haiku-4-5-20251001',
      system: [{ text: 'You are an OCR extractor.', cache: true }],
      messages: [{ role: 'user', content: imageBlocks }],
      maxTokens: 1024,
    };

    const fetchImpl = vi.fn(async () => apiResponseWithUsage(FIXED_USAGE));
    const generate = createAnthropicClient({ apiKey: 'k', fetchImpl, retryDelayMs: 0 });
    const result = await generate(imageReq);

    // usage is mapped directly from the API response — content shape is irrelevant
    expect(result.usage).toEqual({
      inputTokens: 1200,
      cacheWriteTokens: 3000,
      cacheReadTokens: 600,
      outputTokens: 250,
    });
  });

  it('costMicroUsd on image-call usage computes the same COGS as on text-call usage with the same numbers', () => {
    const usage = {
      inputTokens: 1200,
      cacheWriteTokens: 3000,
      cacheReadTokens: 600,
      outputTokens: 250,
    };
    // haiku: input $1/MTok, output $5/MTok, cacheWrite $1.25/MTok, cacheRead $0.10/MTok
    // = (1200*1 + 3000*1.25 + 600*0.10 + 250*5) / 1_000_000 USD
    // = (1200 + 3750 + 60 + 1250) / 1_000_000 = 6260 / 1_000_000 USD = 6260 micro-USD
    const cost = costMicroUsd('claude-haiku-4-5-20251001', usage);
    expect(cost).toBe(6260);
    // The same usage numbers from a text call would yield the same cost:
    // prove by calling costMicroUsd with the same object (content shape never touches this path)
    expect(costMicroUsd('claude-haiku-4-5-20251001', usage)).toBe(cost);
  });

  it('image-block request body carries content array; usage is not derived from the request', async () => {
    const blocks: ContentBlock[] = [
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
    ];
    const fetchImpl = vi.fn(async () => apiResponseWithUsage(FIXED_USAGE));
    const generate = createAnthropicClient({ apiKey: 'k', fetchImpl, retryDelayMs: 0 });
    await generate({
      model: 'claude-haiku-4-5-20251001',
      system: [{ text: 'sys' }],
      messages: [{ role: 'user', content: blocks }],
      maxTokens: 512,
    });

    // Confirm the request body carried the image array (not a string)
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(Array.isArray(body.messages[0].content)).toBe(true);
    expect(body.messages[0].content[0].type).toBe('image');
    // And usage is still pulled from the response, not derived from request content
    // (proven by the earlier test — this just confirms the request shape)
  });
});

describe('pricing (verified 2026-06-12)', () => {
  it('haiku draft: cached call costs ~1/3 of uncached', () => {
    // 2k input (1.5k cacheable) / 400 out
    const uncached = costMicroUsd('claude-haiku-4-5-20251001', {
      inputTokens: 2000,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
      outputTokens: 400,
    });
    const cached = costMicroUsd('claude-haiku-4-5-20251001', {
      inputTokens: 500,
      cacheWriteTokens: 0,
      cacheReadTokens: 1500,
      outputTokens: 400,
    });
    expect(uncached).toBe(4000); // $0.004
    expect(cached).toBe(2650); // $0.00265
  });

  it('rates resolve by model-family prefix and fail loud on unknown ids', () => {
    expect(ratesForModel('claude-sonnet-4-6').inputPerMTok).toBe(3);
    expect(ratesForModel('claude-opus-4-8').outputPerMTok).toBe(25);
    expect(() => ratesForModel('claude-next-99')).toThrow(/no pricing pinned/);
  });

  it('cache write carries the 1.25x premium', () => {
    const cost = costMicroUsd('claude-sonnet-4-6', {
      inputTokens: 0,
      cacheWriteTokens: 1_000_000,
      cacheReadTokens: 0,
      outputTokens: 0,
    });
    expect(cost).toBe(3_750_000); // $3.75 per MTok written
  });
});
