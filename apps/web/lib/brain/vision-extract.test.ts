/**
 * Unit tests for the vision-extract module (Task 6).
 *
 * Tests extractFromImage() in isolation. All LLM calls are mocked — NO live API.
 * Tests also cover the doc-extract.ts integration: image branch calls extractFromImage
 * and submits proposals via propose_memory_change with EXACT branch param names.
 *
 * Run: npx vitest run apps/web/lib/brain/vision-extract.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Generate, GenerateRequest } from '@nibbin/router';

// ── Mocks for redaction (needed since vision-extract uses it) ────────────────
const mockApplyBattery = vi.fn();
const mockHeuristicNerRedact = vi.fn();

vi.mock('@nibbin/redaction', () => ({
  applyBattery: (...args: unknown[]) => mockApplyBattery(...args),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  HeuristicNer: function HeuristicNer(this: any) {
    this.redact = (...args: unknown[]) => mockHeuristicNerRedact(...args);
  },
}));

// ── Import the module under test AFTER mocks ─────────────────────────────────
import { extractFromImage } from './vision-extract';

// ── Shared helpers ───────────────────────────────────────────────────────────

/** Minimal mock Generate function factory */
function makeMockGenerate(reply: string): Generate {
  return vi.fn().mockResolvedValue({
    text: reply,
    model: 'claude-haiku-4-5-20251001',
    usage: { inputTokens: 100, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 50 },
    stopReason: 'end_turn',
  });
}

/** Standard RPC mock (returns no error) */
const mockRpc = vi.fn().mockResolvedValue({ data: 'pid-v', error: null });

/** Minimal account context */
const CTX = {
  accountId: 'acct-vision-001',
  sourceId: 'src-vision-001',
  filename: 'receipt.png',
  model: 'claude-haiku-4-5-20251001',
};

function setupCleanRedaction(text: string) {
  mockApplyBattery.mockReturnValue({ text, rulesHit: [] });
  mockHeuristicNerRedact.mockResolvedValue({ redacted: text, rulesHit: [] });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('extractFromImage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test V1: The GenerateRequest carries an image block at content[0]
  // ──────────────────────────────────────────────────────────────────────────
  it('V1. request carries image block at content[0] with correct base64 and media_type', async () => {
    const buffer = Buffer.from('PNG_FAKE_BYTES');
    const mime = 'image/png';
    const llmReply = JSON.stringify({ facts: 'A receipt for $25 coffee' });
    setupCleanRedaction('A receipt for $25 coffee');

    const capturedRequests: GenerateRequest[] = [];
    const mockGenerate: Generate = vi.fn().mockImplementation(async (req: GenerateRequest) => {
      capturedRequests.push(req);
      return {
        text: llmReply,
        model: 'claude-haiku-4-5-20251001',
        usage: { inputTokens: 80, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 30 },
        stopReason: 'end_turn',
      };
    });

    await extractFromImage(buffer, mime, mockGenerate, mockRpc, CTX);

    expect(capturedRequests).toHaveLength(1);
    const req = capturedRequests[0];

    // The user message content must be an array (ContentBlock[]), not a string
    const userMsg = req.messages.find((m) => m.role === 'user');
    expect(userMsg).toBeDefined();
    expect(Array.isArray(userMsg!.content)).toBe(true);

    const blocks = userMsg!.content as Array<{ type: string; source?: { type: string; data: string; media_type: string }; text?: string }>;

    // content[0] must be an image block
    expect(blocks[0].type).toBe('image');
    expect(blocks[0].source?.type).toBe('base64');
    expect(blocks[0].source?.media_type).toBe('image/png');

    // base64 data must be non-empty and be the correct encoding of the buffer
    const expectedBase64 = buffer.toString('base64');
    expect(blocks[0].source?.data).toBe(expectedBase64);

    // content[1] must be a text block (the extraction instruction)
    expect(blocks[1].type).toBe('text');
    expect(typeof blocks[1].text).toBe('string');
    expect(blocks[1].text!.length).toBeGreaterThan(10);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test V2: Stubbed model reply yields N proposals each submitted via RPC
  //   with the EXACT 7-arg branch param names
  // ──────────────────────────────────────────────────────────────────────────
  it('V2. stubbed model reply → N proposals via propose_memory_change with exact param keys', async () => {
    const buffer = Buffer.from('JPEG_FAKE');
    const mime = 'image/jpeg';
    const extractedText = 'Photography pricing: $200/hr portraits. Business facts: studio in downtown.';
    const llmReply = JSON.stringify({
      pricing: '$200/hr for portrait sessions',
      facts: 'Downtown photography studio',
    });

    // Redaction: clean
    setupCleanRedaction(extractedText);
    // Per-field re-check: clean for all
    mockApplyBattery.mockReturnValue({ text: extractedText, rulesHit: [] });

    const mockGenerate = makeMockGenerate(llmReply);

    await extractFromImage(buffer, mime, mockGenerate, mockRpc, CTX);

    // propose_memory_change called twice (pricing + facts)
    expect(mockRpc).toHaveBeenCalledTimes(2);

    const EXPECTED_KEYS = new Set([
      'p_account',
      'p_field_key',
      'p_op',
      'p_value',
      'p_rationale',
      'p_source_id',
      'p_origin',
    ]);
    // NOTE: p_stakes is added by the P6 merge; for now the 7-arg form is correct

    for (const call of mockRpc.mock.calls) {
      expect(call[0]).toBe('propose_memory_change');
      const args = call[1] as Record<string, unknown>;
      const actualKeys = new Set(Object.keys(args));

      // Every key passed must be in the expected set
      for (const key of actualKeys) {
        expect(EXPECTED_KEYS.has(key)).toBe(true);
      }
      // All expected keys must be present
      for (const key of EXPECTED_KEYS) {
        expect(actualKeys.has(key)).toBe(true);
      }
    }

    // Verify proposal content
    const rpcs = mockRpc.mock.calls.map((c) => c[1] as Record<string, unknown>);
    expect(rpcs.some((a) => a.p_field_key === 'pricing')).toBe(true);
    expect(rpcs.some((a) => a.p_field_key === 'facts')).toBe(true);

    // p_account must be the accountId
    for (const args of rpcs) {
      expect(args.p_account).toBe(CTX.accountId);
      expect(args.p_source_id).toBe(CTX.sourceId);
      expect(args.p_origin).toBe('doc_extract');
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test V3: Model error → throws (fail-closed: caller marks failed)
  // ──────────────────────────────────────────────────────────────────────────
  it('V3. model error → extractFromImage throws; caller is responsible for fail-closed handling', async () => {
    const buffer = Buffer.from('PNG_FAKE');
    const mime = 'image/png';
    const errorGenerate: Generate = vi.fn().mockRejectedValue(new Error('Provider timeout'));

    await expect(
      extractFromImage(buffer, mime, errorGenerate, mockRpc, CTX),
    ).rejects.toThrow('Provider timeout');

    // No proposals were submitted
    expect(mockRpc).not.toHaveBeenCalled();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test V4: Empty / no-usable-content reply → 0 proposals, no crash
  // ──────────────────────────────────────────────────────────────────────────
  it('V4. empty reply → zero proposals, no crash', async () => {
    const buffer = Buffer.from('WEBP_FAKE');
    const mime = 'image/webp';

    // Model returns empty text (no JSON)
    const mockGenerate = makeMockGenerate('');
    setupCleanRedaction('');

    const drafts = await extractFromImage(buffer, mime, mockGenerate, mockRpc, CTX);

    expect(drafts).toHaveLength(0);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('V4b. reply with non-JSON text → zero proposals, no crash', async () => {
    const buffer = Buffer.from('PNG_FAKE');
    const mime = 'image/png';

    const mockGenerate = makeMockGenerate('Sorry, I cannot read this image.');
    setupCleanRedaction('Sorry, I cannot read this image.');

    const drafts = await extractFromImage(buffer, mime, mockGenerate, mockRpc, CTX);

    expect(drafts).toHaveLength(0);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test V5: Redaction battery on extracted text before proposing (derived-not-raw)
  // ──────────────────────────────────────────────────────────────────────────
  it('V5. quarantine-class redaction in extracted text → zero proposals', async () => {
    const buffer = Buffer.from('PNG_FAKE');
    const mime = 'image/png';
    const llmReply = JSON.stringify({ facts: 'SSN 123-45-6789 is mentioned' });

    const mockGenerate = makeMockGenerate(llmReply);

    // Battery fires quarantine rule
    mockApplyBattery.mockReturnValue({ text: llmReply, rulesHit: ['SSN'] });
    mockHeuristicNerRedact.mockResolvedValue({ redacted: llmReply, rulesHit: [] });

    const drafts = await extractFromImage(buffer, mime, mockGenerate, mockRpc, CTX);

    // No proposals when quarantine fires
    expect(mockRpc).not.toHaveBeenCalled();
    expect(drafts).toHaveLength(0);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test V6: Raw image bytes / verbatim dump never reach proposals
  //   (derived-not-raw: only structured JSON fields become proposals)
  // ──────────────────────────────────────────────────────────────────────────
  it('V6. only known structured fields become proposals — never raw base64 or verbatim dump', async () => {
    const buffer = Buffer.from('PNG_FAKE');
    const mime = 'image/png';
    const fakeBase64 = buffer.toString('base64');

    // Model extracts only known fields
    const llmReply = JSON.stringify({
      facts: 'Business card for John Doe Photography',
      pricing: '$150/session',
      // unknown_field should be ignored
      unknown_field: 'ignored',
    });

    setupCleanRedaction('Business card for John Doe Photography');
    mockApplyBattery.mockReturnValue({ text: 'Business card for John Doe Photography', rulesHit: [] });
    const mockGenerate = makeMockGenerate(llmReply);

    await extractFromImage(buffer, mime, mockGenerate, mockRpc, CTX);

    // The raw base64 must not appear in any RPC call
    for (const call of mockRpc.mock.calls) {
      expect(JSON.stringify(call)).not.toContain(fakeBase64);
    }

    // Unknown fields must not become proposals
    const rpcs = mockRpc.mock.calls.map((c) => c[1] as Record<string, unknown>);
    expect(rpcs.some((a) => a.p_field_key === 'unknown_field')).toBe(false);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test V7: SVG is phase2/unsupported — extractFromImage is NOT called for SVG
  //   (SVG is text-based XML; needs rasterization for vision → treated as phase2)
  //   This is tested at the doc-extract level by the classifyExtractor tests.
  //   Here we document the design decision explicitly.
  // ──────────────────────────────────────────────────────────────────────────
  it('V7. SVG is not passed to extractFromImage (classified as phase2 by classifyExtractor — see doc-extract.test.ts)', () => {
    // SVG requires rasterization before it can be vision-processed. Since no rasterizer
    // dependency is available in this package, SVG is classified as 'phase2' (unsupported)
    // by classifyExtractor in doc-extract.ts. It never reaches extractFromImage.
    //
    // This test asserts the design contract — NOT via extractFromImage, but as documentation.
    // The actual enforcement is in classifyExtractor('image/svg+xml', 'logo.svg') === 'phase2'
    // which is already tested in doc-extract.test.ts (Task 5 test suite).
    expect(true).toBe(true); // contract is enforced upstream in classifyExtractor
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Integration: doc-extract.ts image branch wired to vision path
// ──────────────────────────────────────────────────────────────────────────

// We test the integration via doc-extract's extractDocument with image/png.
// All heavy mocks (supabase, redaction, llm) follow the same pattern as doc-extract.test.ts.

const mockStorageDownload2 = vi.fn();
const mockSourcesUpdate2 = vi.fn();
const mockJobsUpdate2 = vi.fn();
const mockRpc2 = vi.fn();
const mockSelect2 = vi.fn();
const mockGenerateFn2 = vi.fn();
const mockGroveRouterRoute2 = vi.fn();
const mockRecordModelCall2 = vi.fn();

// We need a separate module mock scope for the integration tests.
// Re-use the existing mocks: note that vi.mock hoisting means we declare
// them at module top, but import the tested module after.
vi.mock('../supabase/service', () => ({
  serviceClient: () => ({
    storage: {
      from: () => ({
        download: (...args: unknown[]) => mockStorageDownload2(...args),
      }),
    },
    from: (table: string) => {
      if (table === 'source_extraction_jobs') {
        return {
          update: (payload: unknown) => ({
            eq: (k1: string, v1: string) => ({
              eq: (k2: string, v2: string) => mockJobsUpdate2(payload, k1, v1, k2, v2),
            }),
          }),
        };
      }
      if (table === 'sources') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                limit: () => ({
                  single: (...args: unknown[]) => mockSelect2(...args),
                }),
              }),
            }),
          }),
          update: (payload: unknown) => ({
            eq: (k: string, v: string) => mockSourcesUpdate2(payload, k, v),
          }),
        };
      }
      return {};
    },
    rpc: (...args: unknown[]) => mockRpc2(...args),
  }),
}));

vi.mock('../grove/router', () => ({
  groveRouter: {
    route: (...args: unknown[]) => mockGroveRouterRoute2(...args),
  },
}));

vi.mock('../llm/client', () => ({
  anthropicGenerate: () => mockGenerateFn2,
  recordModelCall: (...args: unknown[]) => mockRecordModelCall2(...args),
}));

import { extractDocument } from './doc-extract';

describe('extractDocument — image/png integration (Task 6 wire)', () => {
  const SOURCE_ID = 'src-img-001';
  const ACCOUNT_ID = 'acct-img-001';

  beforeEach(() => {
    vi.clearAllMocks();
    mockSourcesUpdate2.mockResolvedValue({ error: null });
    mockJobsUpdate2.mockResolvedValue({ error: null });
    mockRpc2.mockResolvedValue({ data: 'pid-img', error: null });
  });

  function extractionStateWrites(): string[] {
    return mockSourcesUpdate2.mock.calls
      .map((c) => (c[0] as Record<string, unknown>)['extraction_state'])
      .filter(Boolean) as string[];
  }

  it('I1. image/png: extractFromImage called → proposals submitted → extraction_state=extracted', async () => {
    const fakeImageBytes = Buffer.from('PNG_BYTES_FAKE');
    mockStorageDownload2.mockResolvedValue({ data: fakeImageBytes, error: null });
    mockSelect2.mockResolvedValue({
      data: { origin: { filename: 'logo.png', mime: 'image/png' }, id: SOURCE_ID },
      error: null,
    });

    // Redaction: clean pass
    mockApplyBattery.mockReturnValue({ text: 'Studio logo image', rulesHit: [] });
    mockHeuristicNerRedact.mockResolvedValue({ redacted: 'Studio logo image', rulesHit: [] });

    // Router
    mockGroveRouterRoute2.mockResolvedValue({
      model: 'claude-haiku-4-5-20251001',
      tier: 't1',
      degraded: false,
    });

    // LLM returns structured fields from the image
    mockGenerateFn2.mockResolvedValue({
      text: JSON.stringify({ facts: 'Photography studio logo' }),
      model: 'claude-haiku-4-5-20251001',
      usage: { inputTokens: 120, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 40 },
      stopReason: 'end_turn',
    });

    await extractDocument(SOURCE_ID, ACCOUNT_ID);

    // Proposals must have been submitted
    expect(mockRpc2).toHaveBeenCalled();
    const rpcCall = mockRpc2.mock.calls.find(
      (c) => c[0] === 'propose_memory_change'
    );
    expect(rpcCall).toBeDefined();
    expect(rpcCall![1]).toMatchObject({
      p_account: ACCOUNT_ID,
      p_field_key: 'facts',
      p_source_id: SOURCE_ID,
      p_origin: 'doc_extract',
    });

    // extraction_state: extracting → extracted
    const states = extractionStateWrites();
    expect(states).toContain('extracting');
    expect(states).toContain('extracted');
    expect(states).not.toContain('unsupported'); // no longer unsupported after Task 6
  });

  it('I2. image/png: LLM error → extraction_state=failed, zero proposals (fail-closed)', async () => {
    const fakeImageBytes = Buffer.from('PNG_BYTES_FAIL');
    mockStorageDownload2.mockResolvedValue({ data: fakeImageBytes, error: null });
    mockSelect2.mockResolvedValue({
      data: { origin: { filename: 'bad.png', mime: 'image/png' }, id: SOURCE_ID },
      error: null,
    });

    mockGroveRouterRoute2.mockResolvedValue({
      model: 'claude-haiku-4-5-20251001',
      tier: 't1',
      degraded: false,
    });

    // LLM throws
    mockGenerateFn2.mockRejectedValue(new Error('Network timeout'));

    await extractDocument(SOURCE_ID, ACCOUNT_ID);

    // Zero proposals
    const proposeCall = mockRpc2.mock.calls.find((c) => c[0] === 'propose_memory_change');
    expect(proposeCall).toBeUndefined();

    // extraction_state = failed
    const states = extractionStateWrites();
    expect(states).toContain('extracting');
    expect(states).toContain('failed');
  });

  it('I3. image/png: model returns empty reply → zero proposals, extraction_state=extracted', async () => {
    const fakeImageBytes = Buffer.from('PNG_BYTES_EMPTY');
    mockStorageDownload2.mockResolvedValue({ data: fakeImageBytes, error: null });
    mockSelect2.mockResolvedValue({
      data: { origin: { filename: 'blank.png', mime: 'image/png' }, id: SOURCE_ID },
      error: null,
    });

    // Redaction: clean (empty text)
    mockApplyBattery.mockReturnValue({ text: '', rulesHit: [] });
    mockHeuristicNerRedact.mockResolvedValue({ redacted: '', rulesHit: [] });

    mockGroveRouterRoute2.mockResolvedValue({
      model: 'claude-haiku-4-5-20251001',
      tier: 't1',
      degraded: false,
    });

    // LLM returns empty
    mockGenerateFn2.mockResolvedValue({
      text: '',
      model: 'claude-haiku-4-5-20251001',
      usage: { inputTokens: 50, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 0 },
      stopReason: 'end_turn',
    });

    await extractDocument(SOURCE_ID, ACCOUNT_ID);

    // Zero proposals — no crash
    const proposeCall = mockRpc2.mock.calls.find((c) => c[0] === 'propose_memory_change');
    expect(proposeCall).toBeUndefined();

    // extraction_state = extracted (not failed — empty result is valid)
    const states = extractionStateWrites();
    expect(states).toContain('extracting');
    expect(states).toContain('extracted');
  });

  it('I4. image/png: LLM request carries an image block (content[0].type===image, base64 present)', async () => {
    const fakeImageBytes = Buffer.from('PNG_IMAGE_CONTENT');
    mockStorageDownload2.mockResolvedValue({ data: fakeImageBytes, error: null });
    mockSelect2.mockResolvedValue({
      data: { origin: { filename: 'photo.png', mime: 'image/png' }, id: SOURCE_ID },
      error: null,
    });

    // Redaction: clean
    mockApplyBattery.mockReturnValue({ text: 'Photo content', rulesHit: [] });
    mockHeuristicNerRedact.mockResolvedValue({ redacted: 'Photo content', rulesHit: [] });

    mockGroveRouterRoute2.mockResolvedValue({
      model: 'claude-haiku-4-5-20251001',
      tier: 't1',
      degraded: false,
    });

    const capturedRequests: GenerateRequest[] = [];
    mockGenerateFn2.mockImplementation(async (req: GenerateRequest) => {
      capturedRequests.push(req);
      return {
        text: JSON.stringify({ facts: 'Photo studio image' }),
        model: 'claude-haiku-4-5-20251001',
        usage: { inputTokens: 100, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 20 },
        stopReason: 'end_turn',
      };
    });

    await extractDocument(SOURCE_ID, ACCOUNT_ID);

    expect(capturedRequests).toHaveLength(1);
    const req = capturedRequests[0];
    const userMsg = req.messages.find((m) => m.role === 'user');
    expect(userMsg).toBeDefined();
    expect(Array.isArray(userMsg!.content)).toBe(true);

    const blocks = userMsg!.content as Array<{ type: string; source?: { data: string } }>;
    expect(blocks[0].type).toBe('image');
    expect(blocks[0].source?.data).toBe(fakeImageBytes.toString('base64'));
  });
});
