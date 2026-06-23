/**
 * Unit tests for the vision-extract module (Task 6 + gate fixes).
 *
 * Tests extractFromImage() in isolation. All LLM calls are mocked — NO live API.
 * Tests also cover the doc-extract.ts integration: image branch calls extractFromImage
 * and submits proposals via propose_memory_change with EXACT branch param names.
 *
 * Gate-fix coverage:
 *   C1  — PDF sent as document block, not image block
 *   I1  — Pre-vision size ceiling (image > 5MB → unsupported; PDF > 32MB → unsupported)
 *   I2  — COGS ledger recording via recordModelCall hook
 *   I3  — redactionStatus returned from extractFromImage; no spurious pending write
 *   M3  — V7 tautological test replaced with real classifyExtractor assertion
 *
 * Run: npx vitest run apps/web/lib/brain/vision-extract.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Generate, GenerateRequest, Tier } from '@nibbin/router';

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
  // Test V1: The GenerateRequest carries an image block at content[0] for images
  // ──────────────────────────────────────────────────────────────────────────
  it('V1. request carries image block at content[0] with correct base64 and media_type (image/png)', async () => {
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

    const result = await extractFromImage(buffer, mime, mockGenerate, mockRpc, CTX);

    expect(result.redactionStatus).toBe('clean');
    expect(capturedRequests).toHaveLength(1);
    const req = capturedRequests[0];

    // The user message content must be an array (ContentBlock[]), not a string
    const userMsg = req.messages.find((m) => m.role === 'user');
    expect(userMsg).toBeDefined();
    expect(Array.isArray(userMsg!.content)).toBe(true);

    const blocks = userMsg!.content as Array<{ type: string; source?: { type: string; data: string; media_type: string }; text?: string }>;

    // content[0] must be an image block (NOT a document block) for image/png
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
  // Test C1: Scanned PDF sent as document block, NOT image block
  // ──────────────────────────────────────────────────────────────────────────
  it('C1. scanned PDF: content[0] is a document block (type:document) with media_type application/pdf', async () => {
    // C1 fix: Anthropic rejects type:'image' + media_type:'application/pdf' with 400.
    // PDFs must use a document block: { type:'document', source:{ type:'base64', media_type:'application/pdf', data } }
    const pdfBuffer = Buffer.from('%PDF-1.4 fake scanned PDF bytes');
    const mime = 'application/pdf';
    const llmReply = JSON.stringify({ facts: 'Photography studio info' });
    setupCleanRedaction('Photography studio info');

    const capturedRequests: GenerateRequest[] = [];
    const mockGenerate: Generate = vi.fn().mockImplementation(async (req: GenerateRequest) => {
      capturedRequests.push(req);
      return {
        text: llmReply,
        model: 'claude-haiku-4-5-20251001',
        usage: { inputTokens: 200, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 40 },
        stopReason: 'end_turn',
      };
    });

    const result = await extractFromImage(pdfBuffer, mime, mockGenerate, mockRpc, CTX);

    expect(capturedRequests).toHaveLength(1);
    const userMsg = capturedRequests[0].messages.find((m) => m.role === 'user');
    const blocks = userMsg!.content as Array<{ type: string; source?: { type: string; media_type: string; data: string } }>;

    // Must be a document block, NOT an image block
    expect(blocks[0].type).toBe('document');
    expect(blocks[0].source?.type).toBe('base64');
    expect(blocks[0].source?.media_type).toBe('application/pdf');
    expect(blocks[0].source?.data).toBe(pdfBuffer.toString('base64'));

    // Proposals should still be submitted
    expect(mockRpc).toHaveBeenCalled();
    expect(result.redactionStatus).toBe('clean');
    expect(result.proposals.length).toBeGreaterThan(0);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test C1b: image/jpeg still carries an image block (back-compat)
  // ──────────────────────────────────────────────────────────────────────────
  it('C1b. image/jpeg still carries an image block (back-compat)', async () => {
    const buffer = Buffer.from('JPEG_FAKE');
    const mime = 'image/jpeg';
    const llmReply = JSON.stringify({ facts: 'Studio logo' });
    setupCleanRedaction('Studio logo');

    const capturedRequests: GenerateRequest[] = [];
    const mockGenerate: Generate = vi.fn().mockImplementation(async (req: GenerateRequest) => {
      capturedRequests.push(req);
      return {
        text: llmReply,
        model: 'claude-haiku-4-5-20251001',
        usage: { inputTokens: 60, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 20 },
        stopReason: 'end_turn',
      };
    });

    await extractFromImage(buffer, mime, mockGenerate, mockRpc, CTX);

    const blocks = (capturedRequests[0].messages[0].content as Array<{ type: string }>);
    // Must still be 'image', not 'document'
    expect(blocks[0].type).toBe('image');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test I1: Pre-vision size ceiling — oversized image → unsupported, no generate call
  // ──────────────────────────────────────────────────────────────────────────
  it('I1a. image > 5MB → no generate call, returns unsupported redactionStatus', async () => {
    // Create a buffer just over the 5 MB limit
    const oversizedBuffer = Buffer.alloc(5 * 1024 * 1024 + 1, 0x00);
    const mime = 'image/png';
    const mockGenerate = vi.fn() as unknown as Generate;

    const result = await extractFromImage(oversizedBuffer, mime, mockGenerate, mockRpc, CTX);

    // Must NOT call the model
    expect(mockGenerate).not.toHaveBeenCalled();
    // Must NOT call RPC
    expect(mockRpc).not.toHaveBeenCalled();
    // Returns unsupported
    expect(result.redactionStatus).toBe('unsupported');
    expect(result.proposals).toHaveLength(0);
  });

  it('I1b. image exactly at 5MB → proceeds (in-range)', async () => {
    // 5 MB exactly is within the limit
    const okBuffer = Buffer.alloc(5 * 1024 * 1024, 0x42);
    const mime = 'image/png';
    const llmReply = JSON.stringify({ facts: 'Just under limit' });
    setupCleanRedaction('Just under limit');

    const mockGenerate = makeMockGenerate(llmReply);
    const result = await extractFromImage(okBuffer, mime, mockGenerate, mockRpc, CTX);

    // Model was called (no size rejection)
    expect(mockGenerate).toHaveBeenCalledTimes(1);
    expect(result.redactionStatus).not.toBe('unsupported');
  });

  it('I1c. PDF > 32MB → no generate call, returns unsupported', async () => {
    const oversizedPdf = Buffer.alloc(32 * 1024 * 1024 + 1, 0x00);
    const mime = 'application/pdf';
    const mockGenerate = vi.fn() as unknown as Generate;

    const result = await extractFromImage(oversizedPdf, mime, mockGenerate, mockRpc, CTX);

    expect(mockGenerate).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
    expect(result.redactionStatus).toBe('unsupported');
    expect(result.proposals).toHaveLength(0);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test I2: Vision call cost recorded to COGS ledger
  // ──────────────────────────────────────────────────────────────────────────
  it('I2a. vision success → recordModelCall hook called with usage from result', async () => {
    const buffer = Buffer.from('PNG_FAKE');
    const mime = 'image/png';
    const llmReply = JSON.stringify({ facts: 'Studio logo' });
    setupCleanRedaction('Studio logo');

    const mockGenerate: Generate = vi.fn().mockResolvedValue({
      text: llmReply,
      model: 'claude-haiku-4-5-20251001',
      usage: { inputTokens: 150, cacheWriteTokens: 10, cacheReadTokens: 5, outputTokens: 45 },
      stopReason: 'end_turn',
    });

    const mockRecord = vi.fn().mockResolvedValue(undefined);
    const costCtx = { tier: 't1' as Tier, degraded: false, task: 'doc_extract', t0: Date.now() };

    await extractFromImage(buffer, mime, mockGenerate, mockRpc, CTX, mockRecord, costCtx);

    // recordModelCall must have been called exactly once
    expect(mockRecord).toHaveBeenCalledTimes(1);
    const rec = mockRecord.mock.calls[0][0] as Record<string, unknown>;
    expect(rec.outcome).toBe('ok');
    expect(rec.task).toBe('doc_extract');
    expect(rec.accountId).toBe(CTX.accountId);
    // Usage must match the model result (not zeros)
    const usage = rec.usage as { inputTokens: number; outputTokens: number };
    expect(usage.inputTokens).toBe(150);
    expect(usage.outputTokens).toBe(45);
  });

  it('I2b. vision error → recordModelCall called with outcome=error + zero usage', async () => {
    const buffer = Buffer.from('PNG_FAKE');
    const mime = 'image/png';
    const errorGenerate: Generate = vi.fn().mockRejectedValue(new Error('Provider timeout'));

    const mockRecord = vi.fn().mockResolvedValue(undefined);
    const costCtx = { tier: 't1' as Tier, degraded: false, task: 'doc_extract', t0: Date.now() };

    await expect(
      extractFromImage(buffer, mime, errorGenerate, mockRpc, CTX, mockRecord, costCtx),
    ).rejects.toThrow('Provider timeout');

    expect(mockRecord).toHaveBeenCalledTimes(1);
    const rec = mockRecord.mock.calls[0][0] as Record<string, unknown>;
    expect(rec.outcome).toBe('error');
    const usage = rec.usage as { inputTokens: number };
    expect(usage.inputTokens).toBe(0);
  });

  it('I2c. no recordModelCall provided → no crash (hook is optional)', async () => {
    const buffer = Buffer.from('PNG_FAKE');
    const mime = 'image/png';
    setupCleanRedaction('Studio');
    const mockGenerate = makeMockGenerate(JSON.stringify({ facts: 'Studio' }));

    // No hook provided — must not crash
    const result = await extractFromImage(buffer, mime, mockGenerate, mockRpc, CTX);
    expect(result.proposals.length).toBeGreaterThan(0);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test I3: redactionStatus returned for callers to persist on the source row
  // ──────────────────────────────────────────────────────────────────────────
  it('I3a. clean extraction → redactionStatus=clean', async () => {
    const buffer = Buffer.from('PNG_FAKE');
    const mime = 'image/png';
    setupCleanRedaction('Studio info');
    const mockGenerate = makeMockGenerate(JSON.stringify({ facts: 'Studio info' }));

    const result = await extractFromImage(buffer, mime, mockGenerate, mockRpc, CTX);
    expect(result.redactionStatus).toBe('clean');
  });

  it('I3b. redacted extraction → redactionStatus=redacted', async () => {
    const buffer = Buffer.from('PNG_FAKE');
    const mime = 'image/png';
    const llmReply = JSON.stringify({ facts: 'Call 555-1234 for info' });
    const scrubbedText = 'Call [REDACTED] for info';
    // Battery fires phone rule (scrubbable, not quarantine-class)
    mockApplyBattery.mockReturnValue({ text: scrubbedText, rulesHit: ['phone'] });
    mockHeuristicNerRedact.mockResolvedValue({ redacted: scrubbedText, rulesHit: [] });

    const mockGenerate = makeMockGenerate(llmReply);
    const result = await extractFromImage(buffer, mime, mockGenerate, mockRpc, CTX);

    expect(result.redactionStatus).toBe('redacted');
  });

  it('I3c. quarantine → redactionStatus=quarantined, zero proposals', async () => {
    const buffer = Buffer.from('PNG_FAKE');
    const mime = 'image/png';
    const llmReply = JSON.stringify({ facts: 'SSN 123-45-6789' });
    mockApplyBattery.mockReturnValue({ text: llmReply, rulesHit: ['SSN'] });
    mockHeuristicNerRedact.mockResolvedValue({ redacted: llmReply, rulesHit: [] });

    const mockGenerate = makeMockGenerate(llmReply);
    const result = await extractFromImage(buffer, mime, mockGenerate, mockRpc, CTX);

    expect(result.redactionStatus).toBe('quarantined');
    expect(result.proposals).toHaveLength(0);
    expect(mockRpc).not.toHaveBeenCalled();
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

    const result = await extractFromImage(buffer, mime, mockGenerate, mockRpc, CTX);

    expect(result.proposals).toHaveLength(0);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('V4b. reply with non-JSON text → zero proposals, no crash', async () => {
    const buffer = Buffer.from('PNG_FAKE');
    const mime = 'image/png';

    const mockGenerate = makeMockGenerate('Sorry, I cannot read this image.');
    setupCleanRedaction('Sorry, I cannot read this image.');

    const result = await extractFromImage(buffer, mime, mockGenerate, mockRpc, CTX);

    expect(result.proposals).toHaveLength(0);
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

    const result = await extractFromImage(buffer, mime, mockGenerate, mockRpc, CTX);

    // No proposals when quarantine fires
    expect(mockRpc).not.toHaveBeenCalled();
    expect(result.proposals).toHaveLength(0);
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
  //   (M3 fix: replaced tautological expect(true).toBe(true) with real assertion)
  // ──────────────────────────────────────────────────────────────────────────
  it('V7. SVG is classified as svg by classifyExtractor (Task 3: real text extractor) and never reaches extractFromImage (dispatched to extractSvgText instead)', async () => {
    // Task 3 promoted SVG to 'svg' (real text extractor). SVG is no longer 'phase2'.
    // It goes through the text pipeline (extractSvgText) — not extractFromImage.
    // The actual enforcement (never calling extractFromImage for SVG) is in doc-extract.ts.
    const { classifyExtractor } = await import('./doc-extract');
    expect(classifyExtractor('image/svg+xml', 'logo.svg')).toBe('svg');
    expect(classifyExtractor('', 'logo.svg')).toBe('svg');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Task 4: Vision path proposals are append-only
  // ──────────────────────────────────────────────────────────────────────────
  it('T4-vision. extractFromImage: ALL propose_memory_change calls use p_op=append for every field (not replace)', async () => {
    // Task 4: extraction is additive; the owner approves and can prune —
    // an upload never proposes destroying curated content.
    // The vision path must also be append-only for ALL fields, not just notes.
    const buffer = Buffer.from('JPEG_FAKE_T4');
    const mime = 'image/jpeg';
    const llmReply = JSON.stringify({
      pricing: '$150 per session',
      facts: 'Downtown photography studio',
      voice: 'Warm and professional',
    });
    const extractedText = 'Downtown photography studio pricing voice info';
    setupCleanRedaction(extractedText);
    // Per-field re-check: clean for all fields
    mockApplyBattery.mockReturnValue({ text: extractedText, rulesHit: [] });

    const mockRpcT4 = vi.fn().mockResolvedValue({ data: 'pid-t4', error: null });
    const mockGenerate = makeMockGenerate(llmReply);

    await extractFromImage(buffer, mime, mockGenerate, mockRpcT4, CTX);

    expect(mockRpcT4).toHaveBeenCalled();
    // ALL propose_memory_change calls must use p_op:'append' (not 'replace')
    for (const call of mockRpcT4.mock.calls) {
      expect(call[0]).toBe('propose_memory_change');
      expect(call[1]).toMatchObject({ p_op: 'append' });
    }
    // Verify all three fields were proposed
    const proposedFields = mockRpcT4.mock.calls.map(
      (c) => (c[1] as Record<string, unknown>).p_field_key
    );
    expect(proposedFields).toContain('pricing');
    expect(proposedFields).toContain('facts');
    expect(proposedFields).toContain('voice');
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
    mockRecordModelCall2.mockResolvedValue(undefined);
  });

  function extractionStateWrites(): string[] {
    return mockSourcesUpdate2.mock.calls
      .map((c) => (c[0] as Record<string, unknown>)['extraction_state'])
      .filter(Boolean) as string[];
  }

  function redactionStatusWrites(): string[] {
    return mockSourcesUpdate2.mock.calls
      .map((c) => (c[0] as Record<string, unknown>)['redaction_status'])
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

  it('I2 (integration). image/png: recordModelCall called with vision usage from LLM result', async () => {
    // I2: Vision COGS must be recorded to the model_calls ledger just like the text path.
    const fakeImageBytes = Buffer.from('PNG_BYTES_COGS');
    mockStorageDownload2.mockResolvedValue({ data: fakeImageBytes, error: null });
    mockSelect2.mockResolvedValue({
      data: { origin: { filename: 'cogs.png', mime: 'image/png' }, id: SOURCE_ID },
      error: null,
    });

    mockApplyBattery.mockReturnValue({ text: 'Studio', rulesHit: [] });
    mockHeuristicNerRedact.mockResolvedValue({ redacted: 'Studio', rulesHit: [] });

    mockGroveRouterRoute2.mockResolvedValue({
      model: 'claude-haiku-4-5-20251001',
      tier: 't1',
      degraded: false,
    });

    mockGenerateFn2.mockResolvedValue({
      text: JSON.stringify({ facts: 'Studio' }),
      model: 'claude-haiku-4-5-20251001',
      usage: { inputTokens: 999, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 77 },
      stopReason: 'end_turn',
    });

    await extractDocument(SOURCE_ID, ACCOUNT_ID);

    // recordModelCall must have been called (wired from doc-extract → extractFromImage)
    expect(mockRecordModelCall2).toHaveBeenCalled();
    const rec = mockRecordModelCall2.mock.calls[0][0] as Record<string, unknown>;
    expect(rec.outcome).toBe('ok');
    expect(rec.task).toBe('doc_extract');
    const usage = rec.usage as { inputTokens: number; outputTokens: number };
    expect(usage.inputTokens).toBe(999);
    expect(usage.outputTokens).toBe(77);
  });

  it('I3 (integration). image/png: redaction_status set to clean after vision success (not stuck at pending)', async () => {
    // I3: The vision success path must set redaction_status to the terminal value
    // ('clean' or 'redacted') — never leaving it at 'pending'.
    const fakeImageBytes = Buffer.from('PNG_BYTES_I3');
    mockStorageDownload2.mockResolvedValue({ data: fakeImageBytes, error: null });
    mockSelect2.mockResolvedValue({
      data: { origin: { filename: 'i3.png', mime: 'image/png' }, id: SOURCE_ID },
      error: null,
    });

    mockApplyBattery.mockReturnValue({ text: 'Studio logo', rulesHit: [] });
    mockHeuristicNerRedact.mockResolvedValue({ redacted: 'Studio logo', rulesHit: [] });

    mockGroveRouterRoute2.mockResolvedValue({
      model: 'claude-haiku-4-5-20251001',
      tier: 't1',
      degraded: false,
    });

    mockGenerateFn2.mockResolvedValue({
      text: JSON.stringify({ facts: 'Studio logo' }),
      model: 'claude-haiku-4-5-20251001',
      usage: { inputTokens: 100, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 20 },
      stopReason: 'end_turn',
    });

    await extractDocument(SOURCE_ID, ACCOUNT_ID);

    // redaction_status must be set to a terminal value (clean or redacted), never 'pending'
    const redactionWrites = redactionStatusWrites();
    expect(redactionWrites).not.toContain('pending');
    expect(redactionWrites.some((s) => s === 'clean' || s === 'redacted')).toBe(true);
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
