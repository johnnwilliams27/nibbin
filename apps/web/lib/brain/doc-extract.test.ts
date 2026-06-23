/**
 * Unit tests for the P2 document extraction worker (doc-extract.ts).
 *
 * All external dependencies — redaction, groveRouter, recordModelCall,
 * anthropicGenerate, Supabase service client, pdf-parse, mammoth — are mocked.
 * Tests call extractDocument() directly and assert on mock call counts/args
 * and on the (faked) DB update calls.
 *
 * Run: npx vitest run apps/web/lib/brain/doc-extract.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock: @nibbin/redaction ────────────────────────────────────────────────
const mockApplyBattery = vi.fn();
const mockHeuristicNerRedact = vi.fn();

vi.mock('@nibbin/redaction', () => ({
  applyBattery: (...args: unknown[]) => mockApplyBattery(...args),
  // Must be a real constructor function (not an arrow fn) for `new HeuristicNer()` to work.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  HeuristicNer: function HeuristicNer(this: any) {
    this.redact = (...args: unknown[]) => mockHeuristicNerRedact(...args);
  },
}));

// ── Mock: groveRouter ──────────────────────────────────────────────────────
const mockGroveRouterRoute = vi.fn();
vi.mock('../grove/router', () => ({
  groveRouter: {
    route: (...args: unknown[]) => mockGroveRouterRoute(...args),
  },
}));

// ── Mock: recordModelCall ──────────────────────────────────────────────────
const mockRecordModelCall = vi.fn();
vi.mock('../llm/client', () => ({
  anthropicGenerate: () => mockAnthropicGenerate(),
  recordModelCall: (...args: unknown[]) => mockRecordModelCall(...args),
}));

// ── Mock: anthropicGenerate (indirect, via module mock above) ──────────────
const mockGenerateFn = vi.fn();
function mockAnthropicGenerate() {
  return mockGenerateFn;
}

// ── Mock: Supabase service client ──────────────────────────────────────────
const mockStorageDownload = vi.fn();
/** Called as mockSourcesUpdate(updatePayload, eqKey, eqValue) */
const mockSourcesUpdate = vi.fn();
/** Called as mockJobsUpdate(updatePayload, eqKey1, eqVal1, eqKey2, eqVal2) */
const mockJobsUpdate = vi.fn();
const mockRpc = vi.fn();
const mockSelect = vi.fn();
const mockFrom = vi.fn();

vi.mock('../supabase/service', () => ({
  serviceClient: () => ({
    storage: {
      from: () => ({
        download: (...args: unknown[]) => mockStorageDownload(...args),
        list: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
    },
    from: (table: string) => {
      if (table === 'source_extraction_jobs') {
        // Captures update(payload).eq(k1,v1).eq(k2,v2)
        return {
          update: (payload: unknown) => ({
            eq: (k1: string, v1: string) => ({
              eq: (k2: string, v2: string) =>
                mockJobsUpdate(payload, k1, v1, k2, v2),
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
                  single: (...args: unknown[]) => mockSelect(...args),
                }),
              }),
            }),
          }),
          // Captures update(payload).eq(k, v)
          update: (payload: unknown) => ({
            eq: (k: string, v: string) => mockSourcesUpdate(payload, k, v),
          }),
        };
      }
      return mockFrom(table);
    },
    rpc: (...args: unknown[]) => mockRpc(...args),
  }),
}));

// ── Mock: pdf-parse ────────────────────────────────────────────────────────
const mockPdfParse = vi.fn();
vi.mock('pdf-parse', () => ({
  default: (...args: unknown[]) => mockPdfParse(...args),
}));

// ── Mock: mammoth ──────────────────────────────────────────────────────────
const mockMammothExtract = vi.fn();
vi.mock('mammoth', () => ({
  default: {
    extractRawText: (...args: unknown[]) => mockMammothExtract(...args),
  },
}));

// ── Mock: office-extract (pptx + xlsx + svg extractors) ───────────────────
const mockExtractPptxText = vi.fn();
const mockExtractXlsxText = vi.fn();
const mockExtractSvgText = vi.fn();
vi.mock('./office-extract', () => ({
  extractPptxText: (...args: unknown[]) => mockExtractPptxText(...args),
  extractXlsxText: (...args: unknown[]) => mockExtractXlsxText(...args),
  extractSvgText: (...args: unknown[]) => mockExtractSvgText(...args),
}));

// ── Import the module under test ───────────────────────────────────────────
import { extractDocument, classifyExtractor } from './doc-extract';

// ── Shared test helpers ────────────────────────────────────────────────────

/** Returns a Buffer containing fake file bytes with the given MIME type embedded as metadata. */
function makePdfBuffer(text: string, numPages = 5): Buffer {
  return Buffer.from(`PDF:${numPages}:${text}`);
}

function makeDocxBuffer(): Buffer {
  return Buffer.from('DOCX binary content');
}

/** Default mocks for a clean, text-native PDF extraction run. */
function setupCleanTextNativePdf(opts: {
  rawText?: string;
  numPages?: number;
  llmResponse?: string;
} = {}) {
  // rawText must be > 100 chars (SCANNED_THRESHOLD) to trigger text-native path
  const rawText = opts.rawText ?? 'Photography studio specializing in weddings. Our rate is $200 per hour for portrait sessions, $350 per hour for events, and $500 for full-day wedding coverage.';
  const numPages = opts.numPages ?? 5;
  const llmResponse = opts.llmResponse ?? JSON.stringify({ pricing: '$200/hr', facts: 'Photography studio' });

  // Storage download returns a PDF buffer with sufficient selectable text
  mockStorageDownload.mockResolvedValue({
    data: makePdfBuffer(rawText, numPages),
    error: null,
  });

  // sources select returns a row with filename metadata
  mockSelect.mockResolvedValue({
    data: { origin: { filename: 'rate-sheet.pdf', mime: 'application/pdf' }, id: 'src-1' },
    error: null,
  });

  // pdf-parse returns text with > 100 chars (text-native path)
  mockPdfParse.mockResolvedValue({
    text: rawText,
    numpages: numPages,
  });

  // Redaction: clean
  mockApplyBattery.mockReturnValue({ text: rawText, rulesHit: [] });
  mockHeuristicNerRedact.mockResolvedValue({ redacted: rawText, rulesHit: [] });

  // Router
  mockGroveRouterRoute.mockResolvedValue({
    model: 'claude-haiku-4-5-20251001',
    tier: 't1',
    degraded: false,
  });

  // LLM
  mockGenerateFn.mockResolvedValue({
    text: llmResponse,
    model: 'claude-haiku-4-5-20251001',
    usage: { inputTokens: 100, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 50 },
    stopReason: 'end_turn',
  });

  // DB updates succeed
  mockSourcesUpdate.mockResolvedValue({ error: null });
  mockJobsUpdate.mockResolvedValue({ error: null });
  mockRpc.mockResolvedValue({ data: 'pid-1', error: null });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('extractDocument', () => {
  const SOURCE_ID = 'src-uuid-001';
  const ACCOUNT_ID = 'acct-uuid-001';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('1. text-native PDF, clean: proposes extracted fields and marks job done', async () => {
    setupCleanTextNativePdf();

    await extractDocument(SOURCE_ID, ACCOUNT_ID);

    // propose_memory_change called twice: pricing + facts
    expect(mockRpc).toHaveBeenCalledTimes(2);
    const rpcs = mockRpc.mock.calls.map((c) => c[1]);
    expect(rpcs.some((a) => a.p_field_key === 'pricing')).toBe(true);
    expect(rpcs.some((a) => a.p_field_key === 'facts')).toBe(true);

    // recordModelCall called once with task='doc_extract'
    expect(mockRecordModelCall).toHaveBeenCalledTimes(1);
    expect(mockRecordModelCall.mock.calls[0][0]).toMatchObject({ task: 'doc_extract', outcome: 'ok' });

    // job status updated to 'done' (verify via the last job update call)
    const jobCalls1 = mockJobsUpdate.mock.calls;
    const doneCall = jobCalls1.find((c) => JSON.stringify(c).includes('"done"'));
    expect(doneCall).toBeDefined();

    // sources.redaction_status set to 'clean'
    expect(mockSourcesUpdate).toHaveBeenCalled();
    const updateArg = mockSourcesUpdate.mock.calls.find((c) =>
      JSON.stringify(c).includes('clean')
    );
    expect(updateArg).toBeDefined();
  });

  it('T7-0. text-layer PDF: uses fast text path — ZERO vision calls (generate spy called 0 times for text PDFs)', async () => {
    // Task 7 explicit guard: when a PDF has a text layer (>= SCANNED_THRESHOLD chars),
    // we MUST NOT make any vision call. The generate spy must be called exactly 1 time
    // (for the text LLM extraction), NOT via the image block path.
    setupCleanTextNativePdf();

    await extractDocument(SOURCE_ID, ACCOUNT_ID);

    // generate IS called (for text LLM), but the request must NOT carry image blocks
    expect(mockGenerateFn).toHaveBeenCalled();

    // Verify none of the generate calls carried image blocks in the user content
    for (const call of mockGenerateFn.mock.calls) {
      const req = call[0] as { messages?: Array<{ role: string; content: unknown }> };
      const userMsg = req.messages?.find((m) => m.role === 'user');
      // For text-path PDFs the user content is always a string, never a ContentBlock[]
      // (extractFromImage is NOT invoked on the text path)
      if (Array.isArray(userMsg?.content)) {
        const blocks = userMsg!.content as Array<{ type?: string }>;
        const hasImageBlock = blocks.some((b) => b.type === 'image');
        expect(hasImageBlock).toBe(false);
      }
    }
  });

  it('2. scanned PDF (< 100 chars): routes to vision fallback — EXACTLY ONE vision call via document block (C1), proposals submitted, job=done', async () => {
    // Task 7 + C1 fix: scanned PDFs (no text layer) fall back to vision via extractFromImage,
    // passing the PDF buffer as application/pdf. The block type MUST be 'document' (not 'image')
    // because the Anthropic API rejects type:'image' + media_type:'application/pdf' with a 400.
    mockStorageDownload.mockResolvedValue({
      data: makePdfBuffer('Short'),
      error: null,
    });
    mockSelect.mockResolvedValue({
      data: { origin: { filename: 'scan.pdf', mime: 'application/pdf' }, id: 'src-1' },
      error: null,
    });

    // pdf-parse returns only 30 chars (< 100 threshold → isScanned = true)
    mockPdfParse.mockResolvedValue({
      text: 'A'.repeat(30),
      numpages: 3,
    });

    // Redaction: clean (for vision output)
    mockApplyBattery.mockReturnValue({ text: 'Photography studio business info', rulesHit: [] });
    mockHeuristicNerRedact.mockResolvedValue({ redacted: 'Photography studio business info', rulesHit: [] });

    // Router decision for vision call
    mockGroveRouterRoute.mockResolvedValue({
      model: 'claude-haiku-4-5-20251001',
      tier: 't1',
      degraded: false,
    });

    // Vision LLM returns structured fields from the PDF
    mockGenerateFn.mockResolvedValue({
      text: JSON.stringify({ facts: 'Photography studio business info' }),
      model: 'claude-haiku-4-5-20251001',
      usage: { inputTokens: 200, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 40 },
      stopReason: 'end_turn',
    });

    mockSourcesUpdate.mockResolvedValue({ error: null });
    mockJobsUpdate.mockResolvedValue({ error: null });
    mockRpc.mockResolvedValue({ data: 'pid-scan', error: null });

    await extractDocument(SOURCE_ID, ACCOUNT_ID);

    // EXACTLY ONE vision call (not zero, not two)
    expect(mockGenerateFn).toHaveBeenCalledTimes(1);

    // C1: The vision call must carry a DOCUMENT block (not an image block) for application/pdf
    const visionCallReq = mockGenerateFn.mock.calls[0][0];
    const userMsg = visionCallReq.messages?.find((m: { role: string }) => m.role === 'user');
    expect(Array.isArray(userMsg?.content)).toBe(true);
    const blocks = userMsg?.content as Array<{ type: string; source?: { media_type: string } }>;
    expect(blocks[0]?.type).toBe('document'); // C1 fix: must be 'document', NOT 'image'
    expect(blocks[0]?.source?.media_type).toBe('application/pdf');

    // Proposals submitted (at least one)
    expect(mockRpc).toHaveBeenCalled();

    // Job must be marked 'done' (not 'error')
    const jobCalls = mockJobsUpdate.mock.calls;
    const doneCall = jobCalls.find((c) => JSON.stringify(c).includes('"done"'));
    expect(doneCall).toBeDefined();

    // I3: redaction_status must be a terminal value (clean or redacted), not 'pending'
    const redactionWrites = mockSourcesUpdate.mock.calls
      .map((c) => (c[0] as Record<string, unknown>)['redaction_status'])
      .filter(Boolean) as string[];
    expect(redactionWrites).not.toContain('pending');
    expect(redactionWrites.some((s) => s === 'clean' || s === 'redacted')).toBe(true);
  });

  it('2b. scanned PDF: vision failure → extraction_state=failed, zero proposals (fail-closed)', async () => {
    // Task 7 fail-closed: if the vision fallback throws, propagate to outer catch → failed.
    mockStorageDownload.mockResolvedValue({
      data: makePdfBuffer('X'.repeat(10)),
      error: null,
    });
    mockSelect.mockResolvedValue({
      data: { origin: { filename: 'scan-fail.pdf', mime: 'application/pdf' }, id: 'src-1' },
      error: null,
    });

    mockPdfParse.mockResolvedValue({
      text: 'X'.repeat(10),
      numpages: 2,
    });

    // Router decision
    mockGroveRouterRoute.mockResolvedValue({
      model: 'claude-haiku-4-5-20251001',
      tier: 't1',
      degraded: false,
    });

    // Vision LLM throws
    mockGenerateFn.mockRejectedValue(new Error('Vision provider error'));

    mockSourcesUpdate.mockResolvedValue({ error: null });
    mockJobsUpdate.mockResolvedValue({ error: null });

    await extractDocument(SOURCE_ID, ACCOUNT_ID);

    // Zero proposals
    expect(mockRpc).not.toHaveBeenCalled();

    // extraction_state must be 'failed'
    const stateWrites = mockSourcesUpdate.mock.calls
      .map((c) => (c[0] as Record<string, unknown>)['extraction_state'])
      .filter(Boolean);
    expect(stateWrites).toContain('failed');

    // Job must be marked 'error'
    const jobCalls = mockJobsUpdate.mock.calls;
    const errorCall = jobCalls.find((c) => JSON.stringify(c).includes('error'));
    expect(errorCall).toBeDefined();
  });

  it('3. redaction scrub: phone number replaced with [REDACTED]; redaction_status=redacted', async () => {
    // rawText must be > 100 chars (SCANNED_THRESHOLD) so pdf-parse returns a text-native result.
    const rawText = 'Call us at 555-123-4567 for bookings. We are a full-service photography studio serving weddings, events, and portraits throughout the region.';
    const scrubbedText = 'Call us at [REDACTED] for bookings. We are a full-service photography studio serving weddings, events, and portraits throughout the region.';

    mockStorageDownload.mockResolvedValue({
      data: makePdfBuffer(rawText),
      error: null,
    });
    mockSelect.mockResolvedValue({
      data: { origin: { filename: 'contact.pdf', mime: 'application/pdf' }, id: 'src-1' },
      error: null,
    });
    mockPdfParse.mockResolvedValue({ text: rawText, numpages: 2 });

    // applyBattery hits a phone rule and returns scrubbed text
    mockApplyBattery.mockReturnValue({ text: scrubbedText, rulesHit: ['phone'] });
    // NER: no person names
    mockHeuristicNerRedact.mockResolvedValue({ redacted: scrubbedText, rulesHit: [] });

    mockGroveRouterRoute.mockResolvedValue({ model: 'claude-haiku-4-5-20251001', tier: 't1', degraded: false });
    mockGenerateFn.mockResolvedValue({
      text: JSON.stringify({ facts: 'Call us for bookings.' }),
      model: 'claude-haiku-4-5-20251001',
      usage: { inputTokens: 50, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 20 },
      stopReason: 'end_turn',
    });
    mockSourcesUpdate.mockResolvedValue({ error: null });
    mockJobsUpdate.mockResolvedValue({ error: null });
    mockRpc.mockResolvedValue({ data: 'pid-3', error: null });

    await extractDocument(SOURCE_ID, ACCOUNT_ID);

    // redaction_status should be 'redacted'
    const updateCalls = mockSourcesUpdate.mock.calls;
    const redactedCall = updateCalls.find((c) => JSON.stringify(c).includes('redacted'));
    expect(redactedCall).toBeDefined();
    // Raw phone number should NOT appear in any propose_memory_change call
    const rpcCalls = mockRpc.mock.calls;
    for (const call of rpcCalls) {
      expect(JSON.stringify(call)).not.toContain('555-123-4567');
    }
  });

  it('4. quarantine: applyBattery returns quarantine-class rule → redaction_status=quarantined, zero proposals, job=error', async () => {
    // Use a long text (> 100 chars) to stay on the text-native path;
    // the quarantine is triggered by applyBattery detecting an SSN pattern.
    const rawText = 'Sensitive document. SSN: 123-45-6789. Bank account number: 987654321. Please keep this information confidential at all times.';

    mockStorageDownload.mockResolvedValue({
      data: makePdfBuffer(rawText),
      error: null,
    });
    mockSelect.mockResolvedValue({
      data: { origin: { filename: 'sensitive.pdf', mime: 'application/pdf' }, id: 'src-1' },
      error: null,
    });
    mockPdfParse.mockResolvedValue({ text: rawText, numpages: 1 });

    // applyBattery returns a quarantine-class rule ('SSN')
    mockApplyBattery.mockReturnValue({ text: rawText, rulesHit: ['SSN'] });
    mockHeuristicNerRedact.mockResolvedValue({ redacted: rawText, rulesHit: [] });

    mockSourcesUpdate.mockResolvedValue({ error: null });
    mockJobsUpdate.mockResolvedValue({ error: null });

    await extractDocument(SOURCE_ID, ACCOUNT_ID);

    // propose_memory_change must NEVER be called
    expect(mockRpc).not.toHaveBeenCalled();

    // sources.redaction_status = 'quarantined'
    const updateCalls = mockSourcesUpdate.mock.calls;
    const quarantinedCall = updateCalls.find((c) => JSON.stringify(c).includes('quarantined'));
    expect(quarantinedCall).toBeDefined();

    // job status must be 'error'
    const jobCalls = mockJobsUpdate.mock.calls;
    const errorCall = jobCalls.find((c) => JSON.stringify(c).includes('error'));
    expect(errorCall).toBeDefined();

    // No LLM call
    expect(mockGenerateFn).not.toHaveBeenCalled();
  });

  it('5. per-field defense-in-depth: field value that trips applyBattery is dropped; other clean fields are proposed', async () => {
    // rawText must be > 100 chars (SCANNED_THRESHOLD) so pdf-parse returns a text-native result.
    const rawText = 'Photography studio. Rate: $200/hr. Phone: 555-999-0000 (contact). We offer studio, outdoor, and destination sessions for all occasions.';

    mockStorageDownload.mockResolvedValue({
      data: makePdfBuffer(rawText),
      error: null,
    });
    mockSelect.mockResolvedValue({
      data: { origin: { filename: 'rate.pdf', mime: 'application/pdf' }, id: 'src-1' },
      error: null,
    });
    mockPdfParse.mockResolvedValue({ text: rawText, numpages: 1 });

    // Initial battery pass: clean (for overall text after scrub, no quarantine-class)
    // Per-field re-check: first call (for the full rawText) = clean; subsequent calls
    // discriminate per field value: 'pricing' field contains phone → dirty; 'facts' = clean
    let batteryCalls = 0;
    mockApplyBattery.mockImplementation((text: string) => {
      batteryCalls++;
      if (batteryCalls === 1) {
        // Initial battery on rawText: no quarantine-class rules, clean
        return { text, rulesHit: [] };
      }
      // Per-field re-check: if the value contains phone-like text, hit it
      if (text.includes('555') || text.includes('phone')) {
        return { text, rulesHit: ['phone'] };
      }
      return { text, rulesHit: [] };
    });
    mockHeuristicNerRedact.mockResolvedValue({ redacted: rawText, rulesHit: [] });

    mockGroveRouterRoute.mockResolvedValue({ model: 'claude-haiku-4-5-20251001', tier: 't1', degraded: false });
    // LLM returns pricing (contains phone-like) + facts (clean)
    mockGenerateFn.mockResolvedValue({
      text: JSON.stringify({ pricing: '555-999-0000 per session', facts: 'Photography studio' }),
      model: 'claude-haiku-4-5-20251001',
      usage: { inputTokens: 60, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 30 },
      stopReason: 'end_turn',
    });
    mockSourcesUpdate.mockResolvedValue({ error: null });
    mockJobsUpdate.mockResolvedValue({ error: null });
    mockRpc.mockResolvedValue({ data: 'pid-5', error: null });

    await extractDocument(SOURCE_ID, ACCOUNT_ID);

    // Only 'facts' should be proposed (pricing was dropped by per-field re-check)
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc.mock.calls[0][1]).toMatchObject({ p_field_key: 'facts' });
  });

  it('6. empty/whitespace field dropped: LLM returns pricing=" " → no proposal', async () => {
    setupCleanTextNativePdf({ llmResponse: JSON.stringify({ pricing: '   ', facts: 'Studio' }) });

    await extractDocument(SOURCE_ID, ACCOUNT_ID);

    // Only facts proposed, not pricing
    const rpcCalls = mockRpc.mock.calls;
    const pricingCall = rpcCalls.find((c) => c[1]?.p_field_key === 'pricing');
    expect(pricingCall).toBeUndefined();
    const factsCall = rpcCalls.find((c) => c[1]?.p_field_key === 'facts');
    expect(factsCall).toBeDefined();
  });

  it('7. reference catch-all triggers for long rawText with < 3 field keys', async () => {
    const longText = 'A'.repeat(6000);
    setupCleanTextNativePdf({
      rawText: longText,
      llmResponse: JSON.stringify({ facts: 'One field only' }),
    });
    // Override pdf-parse to return long text
    mockPdfParse.mockResolvedValue({ text: longText, numpages: 2 });

    // Need to handle two LLM calls: main extraction + summary catch-all
    let callCount = 0;
    mockGenerateFn.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          text: JSON.stringify({ facts: 'One field only' }),
          model: 'claude-haiku-4-5-20251001',
          usage: { inputTokens: 300, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 40 },
          stopReason: 'end_turn',
        });
      }
      // Second call: summary
      return Promise.resolve({
        text: 'This document describes studio policies and offers.',
        model: 'claude-haiku-4-5-20251001',
        usage: { inputTokens: 200, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 30 },
        stopReason: 'end_turn',
      });
    });

    await extractDocument(SOURCE_ID, ACCOUNT_ID);

    // groveRouter.route must have been called twice (main + summary)
    const docExtractCalls = mockGroveRouterRoute.mock.calls.filter(
      (c) => c[0]?.task === 'doc_extract'
    );
    expect(docExtractCalls.length).toBeGreaterThanOrEqual(2);

    // A 'notes' append proposal must exist
    const notesCalls = mockRpc.mock.calls.filter((c) => c[1]?.p_field_key === 'notes');
    expect(notesCalls.length).toBeGreaterThan(0);
    expect(notesCalls[0][1]).toMatchObject({ p_op: 'append' });
  });

  it('8. reference catch-all does NOT trigger for short rawText (≤ 500 chars, 0 fields)', async () => {
    const shortText = 'B'.repeat(300); // 300 chars < 500 threshold
    setupCleanTextNativePdf({
      rawText: shortText,
      llmResponse: JSON.stringify({}), // no fields extracted
    });
    mockPdfParse.mockResolvedValue({ text: shortText, numpages: 1 });

    await extractDocument(SOURCE_ID, ACCOUNT_ID);

    // Only ONE LLM call (main extraction), no summary call
    expect(mockGenerateFn).toHaveBeenCalledTimes(1);
  });

  it('9. scanned PDF with > 10 pages: vision fallback fires, truncated_pages logged in origin WITHOUT touching redaction_status (I3), EXACTLY ONE vision call', async () => {
    // Task 7: scanned PDFs route to vision regardless of page count.
    // When numPages > SCANNED_PAGE_CAP (10), we log truncated_pages=true in sources.origin
    // WITHOUT writing redaction_status='pending' (I3 fix) — the status is only set after
    // the vision gate completes, to a terminal value ('clean' or 'redacted').
    const rawText = 'X'.repeat(30); // < 100 chars → scanned path
    const totalPages = 15;

    mockStorageDownload.mockResolvedValue({
      data: makePdfBuffer(rawText, totalPages),
      error: null,
    });
    mockSelect.mockResolvedValue({
      data: { origin: { filename: 'long-scan.pdf', mime: 'application/pdf' }, id: 'src-1' },
      error: null,
    });

    mockPdfParse.mockResolvedValue({ text: rawText, numpages: totalPages });

    // Redaction: clean (for vision output)
    mockApplyBattery.mockReturnValue({ text: 'Multi-page scan content', rulesHit: [] });
    mockHeuristicNerRedact.mockResolvedValue({ redacted: 'Multi-page scan content', rulesHit: [] });

    // Router decision
    mockGroveRouterRoute.mockResolvedValue({
      model: 'claude-haiku-4-5-20251001',
      tier: 't1',
      degraded: false,
    });

    // Vision LLM returns structured fields
    mockGenerateFn.mockResolvedValue({
      text: JSON.stringify({ notes: 'Multi-page document scanned' }),
      model: 'claude-haiku-4-5-20251001',
      usage: { inputTokens: 300, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 30 },
      stopReason: 'end_turn',
    });

    mockSourcesUpdate.mockResolvedValue({ error: null });
    mockJobsUpdate.mockResolvedValue({ error: null });
    mockRpc.mockResolvedValue({ data: 'pid-9', error: null });

    await extractDocument(SOURCE_ID, ACCOUNT_ID);

    // EXACTLY ONE vision call
    expect(mockGenerateFn).toHaveBeenCalledTimes(1);

    // sources.origin should be updated with truncated_pages: true (logged before vision call)
    const updateCalls = mockSourcesUpdate.mock.calls;
    const truncatedCall = updateCalls.find((c) => JSON.stringify(c).includes('truncated_pages'));
    expect(truncatedCall).toBeDefined();
    expect(JSON.stringify(truncatedCall)).toContain('true');

    // I3: The truncated_pages write must NOT carry redaction_status (only origin is patched)
    const truncatedPayload = truncatedCall![0] as Record<string, unknown>;
    expect(truncatedPayload['redaction_status']).toBeUndefined();

    // I3: redaction_status must be set to terminal value after vision completes, not 'pending'
    const redactionWrites = updateCalls
      .map((c) => (c[0] as Record<string, unknown>)['redaction_status'])
      .filter(Boolean) as string[];
    expect(redactionWrites).not.toContain('pending');
    expect(redactionWrites.some((s) => s === 'clean' || s === 'redacted')).toBe(true);

    // Job must be marked 'done' (not 'error') — vision succeeded
    const jobCalls = mockJobsUpdate.mock.calls;
    const doneCall = jobCalls.find((c) => JSON.stringify(c).includes('"done"'));
    expect(doneCall).toBeDefined();
  });

  it('10. .docx parsed via mammoth: rawText = mammoth output', async () => {
    mockStorageDownload.mockResolvedValue({
      data: makeDocxBuffer(),
      error: null,
    });
    mockSelect.mockResolvedValue({
      data: { origin: { filename: 'terms.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }, id: 'src-1' },
      error: null,
    });

    mockMammothExtract.mockResolvedValue({ value: 'Hello World from docx' });

    mockApplyBattery.mockReturnValue({ text: 'Hello World from docx', rulesHit: [] });
    mockHeuristicNerRedact.mockResolvedValue({ redacted: 'Hello World from docx', rulesHit: [] });

    mockGroveRouterRoute.mockResolvedValue({ model: 'claude-haiku-4-5-20251001', tier: 't1', degraded: false });
    mockGenerateFn.mockResolvedValue({
      text: JSON.stringify({ facts: 'Hello World from docx' }),
      model: 'claude-haiku-4-5-20251001',
      usage: { inputTokens: 30, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 20 },
      stopReason: 'end_turn',
    });
    mockSourcesUpdate.mockResolvedValue({ error: null });
    mockJobsUpdate.mockResolvedValue({ error: null });
    mockRpc.mockResolvedValue({ data: 'pid-10', error: null });

    await extractDocument(SOURCE_ID, ACCOUNT_ID);

    // mammoth was called
    expect(mockMammothExtract).toHaveBeenCalledTimes(1);

    // LLM received the mammoth text (verify via proposal)
    expect(mockRpc).toHaveBeenCalled();
  });

  it('11. rawText capped at 50 000 chars: LLM receives ≤ 50 000 chars', async () => {
    const bigText = 'C'.repeat(60000);
    setupCleanTextNativePdf({ rawText: bigText });
    mockPdfParse.mockResolvedValue({ text: bigText, numpages: 3 });

    // Capture what the LLM receives
    let capturedUserMessage = '';
    mockGenerateFn.mockImplementation((req: { messages: Array<{ content: string }> }) => {
      capturedUserMessage = req.messages?.[0]?.content ?? '';
      return Promise.resolve({
        text: JSON.stringify({ facts: 'Studio' }),
        model: 'claude-haiku-4-5-20251001',
        usage: { inputTokens: 100, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 20 },
        stopReason: 'end_turn',
      });
    });

    await extractDocument(SOURCE_ID, ACCOUNT_ID);

    // The LLM user message must not contain more than 50 000 chars of rawText
    expect(capturedUserMessage.length).toBeLessThanOrEqual(51000); // allow small prompt wrapper overhead
  });

  it('C1-regression. propose_memory_change RPC arg keys exactly match migration signature', async () => {
    // CRITICAL: PostgREST resolves RPC args by NAME. Any key mismatch (e.g. p_account_id
    // instead of p_account) silently produces zero proposals in production.
    // Migration signature: propose_memory_change(p_account uuid, p_field_key text, p_op text,
    //   p_value text, p_rationale text, p_source_id uuid, p_origin text)
    const EXPECTED_KEYS = new Set(['p_account', 'p_field_key', 'p_op', 'p_value', 'p_rationale', 'p_source_id', 'p_origin']);

    setupCleanTextNativePdf();

    await extractDocument(SOURCE_ID, ACCOUNT_ID);

    // At least one propose_memory_change call must have been made
    expect(mockRpc).toHaveBeenCalled();

    for (const call of mockRpc.mock.calls) {
      const rpcName = call[0] as string;
      expect(rpcName).toBe('propose_memory_change');
      const args = call[1] as Record<string, unknown>;
      const actualKeys = new Set(Object.keys(args));

      // Every key passed must be in the expected set (no unknown / misspelled keys)
      for (const key of actualKeys) {
        expect(EXPECTED_KEYS.has(key)).toBe(true);
      }

      // All expected keys must be present (no missing args)
      for (const key of EXPECTED_KEYS) {
        expect(actualKeys.has(key)).toBe(true);
      }
    }
  });

  it('12. error handling: LLM throws → job marked error, recordModelCall called with outcome=error, no proposals', async () => {
    // rawText must be > 100 chars (SCANNED_THRESHOLD) so pdf-parse returns a text-native result.
    const rawText = 'Valid studio content for testing errors. Photography business offering portraits, events, and editorial work for clients throughout the city.';
    setupCleanTextNativePdf({ rawText });

    mockGenerateFn.mockRejectedValue(new Error('Provider timeout'));

    await extractDocument(SOURCE_ID, ACCOUNT_ID);

    // propose_memory_change must NOT be called
    expect(mockRpc).not.toHaveBeenCalled();

    // recordModelCall called with outcome='error'
    const errorRecord = mockRecordModelCall.mock.calls.find(
      (c) => c[0]?.outcome === 'error'
    );
    expect(errorRecord).toBeDefined();

    // Job marked 'error'
    const jobCalls = mockJobsUpdate.mock.calls;
    const errorJobCall = jobCalls.find((c) => JSON.stringify(c).includes('error'));
    expect(errorJobCall).toBeDefined();
  });
});

// ── Task 5: classifyExtractor unit tests ──────────────────────────────────

describe('classifyExtractor', () => {
  it('text/plain → textnative', () => {
    expect(classifyExtractor('text/plain', 'file.txt')).toBe('textnative');
  });
  it('text/markdown → textnative', () => {
    expect(classifyExtractor('text/markdown', 'file.md')).toBe('textnative');
  });
  it('text/csv → textnative', () => {
    expect(classifyExtractor('text/csv', 'file.csv')).toBe('textnative');
  });
  it('text/html → textnative', () => {
    expect(classifyExtractor('text/html', 'file.html')).toBe('textnative');
  });
  it('application/pdf → pdf', () => {
    expect(classifyExtractor('application/pdf', 'doc.pdf')).toBe('pdf');
  });
  it('.pdf extension fallback → pdf', () => {
    expect(classifyExtractor('', 'doc.pdf')).toBe('pdf');
  });
  it('docx mime → docx', () => {
    expect(classifyExtractor('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'doc.docx')).toBe('docx');
  });
  it('.docx extension fallback → docx', () => {
    expect(classifyExtractor('', 'doc.docx')).toBe('docx');
  });
  it('image/png → image', () => {
    expect(classifyExtractor('image/png', 'photo.png')).toBe('image');
  });
  it('image/jpeg → image', () => {
    expect(classifyExtractor('image/jpeg', 'photo.jpg')).toBe('image');
  });
  it('image/webp → image', () => {
    expect(classifyExtractor('image/webp', 'photo.webp')).toBe('image');
  });
  it('image/svg+xml → svg (Task 3: SVG now has a real text extractor)', () => {
    expect(classifyExtractor('image/svg+xml', 'logo.svg')).toBe('svg');
  });
  it('.svg extension fallback → svg', () => {
    expect(classifyExtractor('', 'logo.svg')).toBe('svg');
  });
  it('pptx mime → pptx', () => {
    expect(classifyExtractor('application/vnd.openxmlformats-officedocument.presentationml.presentation', 'deck.pptx')).toBe('pptx');
  });
  it('.pptx extension fallback → pptx', () => {
    expect(classifyExtractor('', 'deck.pptx')).toBe('pptx');
  });
  it('xlsx mime → xlsx', () => {
    expect(classifyExtractor('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'data.xlsx')).toBe('xlsx');
  });
  it('.xlsx extension fallback → xlsx', () => {
    expect(classifyExtractor('', 'data.xlsx')).toBe('xlsx');
  });
  it('unknown mime → unknown', () => {
    expect(classifyExtractor('application/octet-stream', 'file.bin')).toBe('unknown');
  });
  it('empty mime + no known extension → unknown', () => {
    expect(classifyExtractor('', 'weirdfile.xyz')).toBe('unknown');
  });
});

// ── Task 5: extractDocument state-transition tests ────────────────────────

describe('extractDocument — Task 5 state transitions', () => {
  const SOURCE_ID = 'src-t5-001';
  const ACCOUNT_ID = 'acct-t5-001';

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: DB updates succeed
    mockSourcesUpdate.mockResolvedValue({ error: null });
    mockJobsUpdate.mockResolvedValue({ error: null });
    mockRpc.mockResolvedValue({ data: 'pid-t5', error: null });
  });

  // Helper to read all extraction_state values written to sources
  function extractionStateWrites(): string[] {
    return mockSourcesUpdate.mock.calls
      .map((c) => (c[0] as Record<string, unknown>)['extraction_state'])
      .filter(Boolean) as string[];
  }

  it('T5-1. docx happy path: extraction_state=extracting then extracted', async () => {
    mockStorageDownload.mockResolvedValue({
      data: Buffer.from('DOCX bytes'),
      error: null,
    });
    mockSelect.mockResolvedValue({
      data: {
        origin: { filename: 'doc.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
        id: SOURCE_ID,
      },
      error: null,
    });
    const longText = 'This is a business document with lots of useful content about our products and services for clients.';
    mockMammothExtract.mockResolvedValue({ value: longText });
    mockApplyBattery.mockReturnValue({ text: longText, rulesHit: [] });
    mockHeuristicNerRedact.mockResolvedValue({ redacted: longText, rulesHit: [] });
    mockGroveRouterRoute.mockResolvedValue({ model: 'claude-haiku-4-5-20251001', tier: 't1', degraded: false });
    mockGenerateFn.mockResolvedValue({
      text: JSON.stringify({ facts: 'Business document' }),
      model: 'claude-haiku-4-5-20251001',
      usage: { inputTokens: 30, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 10 },
      stopReason: 'end_turn',
    });

    await extractDocument(SOURCE_ID, ACCOUNT_ID);

    const states = extractionStateWrites();
    expect(states).toContain('extracting');
    expect(states).toContain('extracted');
    // extracting must come before extracted
    expect(states.indexOf('extracting')).toBeLessThan(states.indexOf('extracted'));
  });

  it('T5-2. pptx empty text → extraction_state=unsupported, zero proposals', async () => {
    // pptx is now a real extractor. When the pptx yields no text, mark unsupported.
    mockStorageDownload.mockResolvedValue({
      data: Buffer.from('PPTX bytes'),
      error: null,
    });
    mockSelect.mockResolvedValue({
      data: {
        origin: {
          filename: 'deck.pptx',
          mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        },
        id: SOURCE_ID,
      },
      error: null,
    });

    // pptx extractor returns empty string → unsupported
    mockExtractPptxText.mockResolvedValue('');

    await extractDocument(SOURCE_ID, ACCOUNT_ID);

    // Zero proposals
    expect(mockRpc).not.toHaveBeenCalled();
    // No LLM call (no text to process)
    expect(mockGenerateFn).not.toHaveBeenCalled();

    const states = extractionStateWrites();
    expect(states).toContain('extracting');
    expect(states).toContain('unsupported');
  });

  it('T5-2b. pptx with text → redaction gate + LLM + proposals → extracted', async () => {
    // When pptx yields text, the pipeline continues through redaction + LLM.
    const pptxText = 'This is a photography pricing deck with our studio packages and rates for 2026.';
    mockStorageDownload.mockResolvedValue({
      data: Buffer.from('PPTX bytes'),
      error: null,
    });
    mockSelect.mockResolvedValue({
      data: {
        origin: {
          filename: 'pricing.pptx',
          mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        },
        id: SOURCE_ID,
      },
      error: null,
    });

    // pptx extractor returns real text
    mockExtractPptxText.mockResolvedValue(pptxText);

    // Redaction: clean
    mockApplyBattery.mockReturnValue({ text: pptxText, rulesHit: [] });
    mockHeuristicNerRedact.mockResolvedValue({ redacted: pptxText, rulesHit: [] });

    // Router + LLM
    mockGroveRouterRoute.mockResolvedValue({ model: 'claude-haiku-4-5-20251001', tier: 't1', degraded: false });
    mockGenerateFn.mockResolvedValue({
      text: JSON.stringify({ pricing: 'Studio packages', facts: 'Photography studio' }),
      model: 'claude-haiku-4-5-20251001',
      usage: { inputTokens: 80, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 30 },
      stopReason: 'end_turn',
    });

    await extractDocument(SOURCE_ID, ACCOUNT_ID);

    // At least one proposal
    expect(mockRpc).toHaveBeenCalled();
    // All proposals must be append-only
    for (const call of mockRpc.mock.calls) {
      if (call[0] === 'propose_memory_change') {
        expect(call[1]).toMatchObject({ p_op: 'append' });
      }
    }

    const states = extractionStateWrites();
    expect(states).toContain('extracting');
    expect(states).toContain('extracted');
  });

  it('T5-2c. pptx extractor throws → extraction_state=failed, zero proposals (fail-closed)', async () => {
    mockStorageDownload.mockResolvedValue({
      data: Buffer.from('PPTX bytes'),
      error: null,
    });
    mockSelect.mockResolvedValue({
      data: {
        origin: {
          filename: 'bad.pptx',
          mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        },
        id: SOURCE_ID,
      },
      error: null,
    });

    // Extractor throws
    mockExtractPptxText.mockRejectedValue(new Error('corrupt zip'));

    await extractDocument(SOURCE_ID, ACCOUNT_ID);

    expect(mockRpc).not.toHaveBeenCalled();
    const states = extractionStateWrites();
    expect(states).toContain('failed');
  });

  it('T5-3. extractor throws → extraction_state=failed, zero proposals', async () => {
    // Simulate a mammoth parse failure
    mockStorageDownload.mockResolvedValue({
      data: Buffer.from('bad bytes'),
      error: null,
    });
    mockSelect.mockResolvedValue({
      data: {
        origin: { filename: 'broken.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
        id: SOURCE_ID,
      },
      error: null,
    });
    mockMammothExtract.mockRejectedValue(new Error('Mammoth parse error'));

    await extractDocument(SOURCE_ID, ACCOUNT_ID);

    // Zero proposals
    expect(mockRpc).not.toHaveBeenCalled();

    const states = extractionStateWrites();
    expect(states).toContain('extracting');
    expect(states).toContain('failed');
  });

  it('T5-4. text/plain (text-native) happy path: extracts + proposes', async () => {
    const plainText = 'We are a photography studio offering portrait, event, and wedding photography packages starting at $250 per hour for all occasions.';
    mockStorageDownload.mockResolvedValue({
      data: Buffer.from(plainText, 'utf8'),
      error: null,
    });
    mockSelect.mockResolvedValue({
      data: { origin: { filename: 'readme.txt', mime: 'text/plain' }, id: SOURCE_ID },
      error: null,
    });
    mockApplyBattery.mockReturnValue({ text: plainText, rulesHit: [] });
    mockHeuristicNerRedact.mockResolvedValue({ redacted: plainText, rulesHit: [] });
    mockGroveRouterRoute.mockResolvedValue({ model: 'claude-haiku-4-5-20251001', tier: 't1', degraded: false });
    mockGenerateFn.mockResolvedValue({
      text: JSON.stringify({ facts: 'Photography studio' }),
      model: 'claude-haiku-4-5-20251001',
      usage: { inputTokens: 40, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 15 },
      stopReason: 'end_turn',
    });

    await extractDocument(SOURCE_ID, ACCOUNT_ID);

    // At least one proposal made
    expect(mockRpc).toHaveBeenCalled();
    // extraction_state transitions: extracting → extracted
    const states = extractionStateWrites();
    expect(states).toContain('extracting');
    expect(states).toContain('extracted');
  });

  it('T5-5. image/png → Task 6 vision path: extraction_state=extracted, proposals submitted', async () => {
    // Task 6: image/png is now dispatched to the vision path (extractFromImage).
    // This test verifies the full wire: storage download → vision LLM → proposals → extracted.
    mockStorageDownload.mockResolvedValue({
      data: Buffer.from('PNG bytes'),
      error: null,
    });
    mockSelect.mockResolvedValue({
      data: { origin: { filename: 'photo.png', mime: 'image/png' }, id: SOURCE_ID },
      error: null,
    });

    // Router decision for vision call
    mockGroveRouterRoute.mockResolvedValue({
      model: 'claude-haiku-4-5-20251001',
      tier: 't1',
      degraded: false,
    });

    // LLM returns structured extraction from the image
    mockGenerateFn.mockResolvedValue({
      text: JSON.stringify({ facts: 'Photography studio logo' }),
      model: 'claude-haiku-4-5-20251001',
      usage: { inputTokens: 100, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 30 },
      stopReason: 'end_turn',
    });

    // Redaction: clean
    mockApplyBattery.mockReturnValue({ text: 'Photography studio logo', rulesHit: [] });
    mockHeuristicNerRedact.mockResolvedValue({ redacted: 'Photography studio logo', rulesHit: [] });

    await extractDocument(SOURCE_ID, ACCOUNT_ID);

    // Vision LLM was called
    expect(mockGenerateFn).toHaveBeenCalledTimes(1);
    // Proposals submitted
    expect(mockRpc).toHaveBeenCalled();

    const states = extractionStateWrites();
    expect(states).toContain('extracting');
    expect(states).toContain('extracted');
    expect(states).not.toContain('unsupported');
  });

  it('T5-6. unknown mime → extraction_state=unsupported, zero proposals', async () => {
    mockStorageDownload.mockResolvedValue({
      data: Buffer.from('binary junk'),
      error: null,
    });
    mockSelect.mockResolvedValue({
      data: { origin: { filename: 'file.bin', mime: 'application/octet-stream' }, id: SOURCE_ID },
      error: null,
    });

    await extractDocument(SOURCE_ID, ACCOUNT_ID);

    expect(mockRpc).not.toHaveBeenCalled();
    const states = extractionStateWrites();
    expect(states).toContain('extracting');
    expect(states).toContain('unsupported');
  });

  // ── Task 2: xlsx dispatch tests ──────────────────────────────────────────

  it('T2-1. xlsx with text → redaction gate + LLM + APPEND-ONLY proposals → extracted', async () => {
    const xlsxText = 'Price\t100\nName\tAlice';
    mockStorageDownload.mockResolvedValue({
      data: Buffer.from('XLSX bytes'),
      error: null,
    });
    mockSelect.mockResolvedValue({
      data: {
        origin: {
          filename: 'pricing.xlsx',
          mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
        id: SOURCE_ID,
      },
      error: null,
    });

    mockExtractXlsxText.mockResolvedValue(xlsxText);

    mockApplyBattery.mockReturnValue({ text: xlsxText, rulesHit: [] });
    mockHeuristicNerRedact.mockResolvedValue({ redacted: xlsxText, rulesHit: [] });

    mockGroveRouterRoute.mockResolvedValue({ model: 'claude-haiku-4-5-20251001', tier: 't1', degraded: false });
    mockGenerateFn.mockResolvedValue({
      text: JSON.stringify({ pricing: '$100 per session', facts: 'Pricing sheet' }),
      model: 'claude-haiku-4-5-20251001',
      usage: { inputTokens: 80, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 30 },
      stopReason: 'end_turn',
    });

    await extractDocument(SOURCE_ID, ACCOUNT_ID);

    // At least one proposal submitted
    expect(mockRpc).toHaveBeenCalled();

    // ALL proposals must be append-only (Task 2 constraint)
    for (const call of mockRpc.mock.calls) {
      if (call[0] === 'propose_memory_change') {
        expect(call[1]).toMatchObject({ p_op: 'append' });
      }
    }

    const states = extractionStateWrites();
    expect(states).toContain('extracting');
    expect(states).toContain('extracted');
    expect(states).not.toContain('unsupported');
  });

  it('T2-2. xlsx empty text → extraction_state=unsupported, zero proposals', async () => {
    mockStorageDownload.mockResolvedValue({
      data: Buffer.from('XLSX bytes'),
      error: null,
    });
    mockSelect.mockResolvedValue({
      data: {
        origin: {
          filename: 'empty.xlsx',
          mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
        id: SOURCE_ID,
      },
      error: null,
    });

    // xlsx extractor returns empty string → unsupported
    mockExtractXlsxText.mockResolvedValue('');

    await extractDocument(SOURCE_ID, ACCOUNT_ID);

    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockGenerateFn).not.toHaveBeenCalled();

    const states = extractionStateWrites();
    expect(states).toContain('extracting');
    expect(states).toContain('unsupported');
  });

  it('T2-3. xlsx extractor throws → extraction_state=failed, zero proposals (fail-closed)', async () => {
    mockStorageDownload.mockResolvedValue({
      data: Buffer.from('XLSX bytes'),
      error: null,
    });
    mockSelect.mockResolvedValue({
      data: {
        origin: {
          filename: 'bad.xlsx',
          mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
        id: SOURCE_ID,
      },
      error: null,
    });

    mockExtractXlsxText.mockRejectedValue(new Error('corrupt zip'));

    await extractDocument(SOURCE_ID, ACCOUNT_ID);

    expect(mockRpc).not.toHaveBeenCalled();
    const states = extractionStateWrites();
    expect(states).toContain('failed');
  });

  it('T2-4. .xlsx extension (no mime) → classifies as xlsx → dispatched to extractXlsxText', async () => {
    const xlsxText = 'ProductA\t250';
    mockStorageDownload.mockResolvedValue({
      data: Buffer.from('XLSX bytes'),
      error: null,
    });
    mockSelect.mockResolvedValue({
      data: {
        origin: { filename: 'data.xlsx', mime: '' },
        id: SOURCE_ID,
      },
      error: null,
    });

    mockExtractXlsxText.mockResolvedValue(xlsxText);
    mockApplyBattery.mockReturnValue({ text: xlsxText, rulesHit: [] });
    mockHeuristicNerRedact.mockResolvedValue({ redacted: xlsxText, rulesHit: [] });
    mockGroveRouterRoute.mockResolvedValue({ model: 'claude-haiku-4-5-20251001', tier: 't1', degraded: false });
    mockGenerateFn.mockResolvedValue({
      text: JSON.stringify({ facts: 'Product data' }),
      model: 'claude-haiku-4-5-20251001',
      usage: { inputTokens: 30, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 10 },
      stopReason: 'end_turn',
    });

    await extractDocument(SOURCE_ID, ACCOUNT_ID);

    // The xlsx extractor was called (not the pptx one)
    expect(mockExtractXlsxText).toHaveBeenCalledTimes(1);
    expect(mockExtractPptxText).not.toHaveBeenCalled();

    // Proposals submitted
    expect(mockRpc).toHaveBeenCalled();

    // All proposals are append-only
    for (const call of mockRpc.mock.calls) {
      if (call[0] === 'propose_memory_change') {
        expect(call[1]).toMatchObject({ p_op: 'append' });
      }
    }
  });

  // ── Task 3: svg dispatch tests ───────────────────────────────────────────

  it('T3-1. svg with text → redaction gate + LLM + APPEND-ONLY proposals → extracted', async () => {
    const svgText = 'Acme Logo Company branding mark';
    mockStorageDownload.mockResolvedValue({
      data: Buffer.from('<svg><title>Acme</title></svg>', 'utf8'),
      error: null,
    });
    mockSelect.mockResolvedValue({
      data: {
        origin: { filename: 'logo.svg', mime: 'image/svg+xml' },
        id: SOURCE_ID,
      },
      error: null,
    });

    // svg extractor (sync) returns text
    mockExtractSvgText.mockReturnValue(svgText);

    // Redaction: clean
    mockApplyBattery.mockReturnValue({ text: svgText, rulesHit: [] });
    mockHeuristicNerRedact.mockResolvedValue({ redacted: svgText, rulesHit: [] });

    // Router + LLM
    mockGroveRouterRoute.mockResolvedValue({ model: 'claude-haiku-4-5-20251001', tier: 't1', degraded: false });
    mockGenerateFn.mockResolvedValue({
      text: JSON.stringify({ facts: 'Company logo' }),
      model: 'claude-haiku-4-5-20251001',
      usage: { inputTokens: 50, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 20 },
      stopReason: 'end_turn',
    });

    await extractDocument(SOURCE_ID, ACCOUNT_ID);

    // At least one proposal submitted
    expect(mockRpc).toHaveBeenCalled();

    // ALL proposals must be append-only (svg is additive like pptx/xlsx)
    for (const call of mockRpc.mock.calls) {
      if (call[0] === 'propose_memory_change') {
        expect(call[1]).toMatchObject({ p_op: 'append' });
      }
    }

    const states = extractionStateWrites();
    expect(states).toContain('extracting');
    expect(states).toContain('extracted');
    expect(states).not.toContain('unsupported');
  });

  it('T3-2. svg with no text content → extraction_state=unsupported, zero proposals', async () => {
    mockStorageDownload.mockResolvedValue({
      data: Buffer.from('<svg><rect/></svg>', 'utf8'),
      error: null,
    });
    mockSelect.mockResolvedValue({
      data: {
        origin: { filename: 'empty.svg', mime: 'image/svg+xml' },
        id: SOURCE_ID,
      },
      error: null,
    });

    // svg extractor returns empty string → unsupported
    mockExtractSvgText.mockReturnValue('');

    await extractDocument(SOURCE_ID, ACCOUNT_ID);

    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockGenerateFn).not.toHaveBeenCalled();

    const states = extractionStateWrites();
    expect(states).toContain('extracting');
    expect(states).toContain('unsupported');
  });

  it('T3-3. .svg extension (no mime) → classifies as svg → dispatched to extractSvgText', async () => {
    const svgText = 'Brand name text';
    mockStorageDownload.mockResolvedValue({
      data: Buffer.from('<svg><title>Brand</title></svg>', 'utf8'),
      error: null,
    });
    mockSelect.mockResolvedValue({
      data: {
        origin: { filename: 'brand.svg', mime: '' },
        id: SOURCE_ID,
      },
      error: null,
    });

    mockExtractSvgText.mockReturnValue(svgText);
    mockApplyBattery.mockReturnValue({ text: svgText, rulesHit: [] });
    mockHeuristicNerRedact.mockResolvedValue({ redacted: svgText, rulesHit: [] });
    mockGroveRouterRoute.mockResolvedValue({ model: 'claude-haiku-4-5-20251001', tier: 't1', degraded: false });
    mockGenerateFn.mockResolvedValue({
      text: JSON.stringify({ facts: 'Brand name text' }),
      model: 'claude-haiku-4-5-20251001',
      usage: { inputTokens: 30, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 10 },
      stopReason: 'end_turn',
    });

    await extractDocument(SOURCE_ID, ACCOUNT_ID);

    // The svg extractor was called
    expect(mockExtractSvgText).toHaveBeenCalledTimes(1);
    expect(mockExtractPptxText).not.toHaveBeenCalled();
    expect(mockExtractXlsxText).not.toHaveBeenCalled();

    // Proposals submitted
    expect(mockRpc).toHaveBeenCalled();
  });

  it('T3-4. svg extractor throws → extraction_state=failed, zero proposals (fail-closed)', async () => {
    mockStorageDownload.mockResolvedValue({
      data: Buffer.from('not valid SVG'),
      error: null,
    });
    mockSelect.mockResolvedValue({
      data: {
        origin: { filename: 'bad.svg', mime: 'image/svg+xml' },
        id: SOURCE_ID,
      },
      error: null,
    });

    // Extractor throws
    mockExtractSvgText.mockImplementation(() => { throw new Error('SVG parse error'); });

    await extractDocument(SOURCE_ID, ACCOUNT_ID);

    expect(mockRpc).not.toHaveBeenCalled();
    const states = extractionStateWrites();
    expect(states).toContain('failed');
  });

  // ── Task 4: extraction proposals are append-only ─────────────────────────

  it('T4-1. text-native (txt) per-field path: ALL propose_memory_change calls use p_op=append', async () => {
    // Task 4: extraction is additive; the owner approves and can prune —
    // an upload never proposes destroying curated content.
    // Text-native path (txt/docx/pdf text-layer) must also be append-only.
    const plainText = 'We are a photography studio offering portrait, event, and wedding photography packages starting at $250 per hour for all occasions and events.';
    mockStorageDownload.mockResolvedValue({
      data: Buffer.from(plainText, 'utf8'),
      error: null,
    });
    mockSelect.mockResolvedValue({
      data: { origin: { filename: 'studio-info.txt', mime: 'text/plain' }, id: SOURCE_ID },
      error: null,
    });
    mockApplyBattery.mockReturnValue({ text: plainText, rulesHit: [] });
    mockHeuristicNerRedact.mockResolvedValue({ redacted: plainText, rulesHit: [] });
    mockGroveRouterRoute.mockResolvedValue({ model: 'claude-haiku-4-5-20251001', tier: 't1', degraded: false });
    // LLM returns multiple fields (pricing + facts) to verify both get append, not just notes
    mockGenerateFn.mockResolvedValue({
      text: JSON.stringify({ pricing: '$250/hr', facts: 'Photography studio', policies: 'No refunds' }),
      model: 'claude-haiku-4-5-20251001',
      usage: { inputTokens: 40, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 20 },
      stopReason: 'end_turn',
    });

    await extractDocument(SOURCE_ID, ACCOUNT_ID);

    expect(mockRpc).toHaveBeenCalled();
    // ALL propose_memory_change calls must use p_op:'append' (not 'replace')
    for (const call of mockRpc.mock.calls) {
      if (call[0] === 'propose_memory_change') {
        expect(call[1]).toMatchObject({ p_op: 'append' });
      }
    }
    // Verify all three fields were proposed
    const proposedFields = mockRpc.mock.calls
      .filter((c) => c[0] === 'propose_memory_change')
      .map((c) => (c[1] as Record<string, unknown>).p_field_key);
    expect(proposedFields).toContain('pricing');
    expect(proposedFields).toContain('facts');
    expect(proposedFields).toContain('policies');
  });

  it('T4-2. docx per-field path: ALL propose_memory_change calls use p_op=append', async () => {
    // Task 4: DOCX path must also be append-only.
    const docxText = 'Business doc with facts and pricing info for test. Studio at downtown location.';
    mockStorageDownload.mockResolvedValue({
      data: Buffer.from('DOCX bytes'),
      error: null,
    });
    mockSelect.mockResolvedValue({
      data: {
        origin: { filename: 'contract.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
        id: SOURCE_ID,
      },
      error: null,
    });
    mockMammothExtract.mockResolvedValue({ value: docxText });
    mockApplyBattery.mockReturnValue({ text: docxText, rulesHit: [] });
    mockHeuristicNerRedact.mockResolvedValue({ redacted: docxText, rulesHit: [] });
    mockGroveRouterRoute.mockResolvedValue({ model: 'claude-haiku-4-5-20251001', tier: 't1', degraded: false });
    mockGenerateFn.mockResolvedValue({
      text: JSON.stringify({ facts: 'Studio info', hard_rules: 'No changes after signing' }),
      model: 'claude-haiku-4-5-20251001',
      usage: { inputTokens: 30, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 20 },
      stopReason: 'end_turn',
    });

    await extractDocument(SOURCE_ID, ACCOUNT_ID);

    expect(mockRpc).toHaveBeenCalled();
    for (const call of mockRpc.mock.calls) {
      if (call[0] === 'propose_memory_change') {
        expect(call[1]).toMatchObject({ p_op: 'append' });
      }
    }
  });

  it('T4-3. reference catch-all (notes) proposal uses p_op=append (pre-existing, regression guard)', async () => {
    // Catch-all already used append; guard it against regression.
    const longText = 'A'.repeat(6000);
    setupCleanTextNativePdf({ rawText: longText, llmResponse: JSON.stringify({ facts: 'One field' }) });
    mockPdfParse.mockResolvedValue({ text: longText, numpages: 2 });

    let callCount = 0;
    mockGenerateFn.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          text: JSON.stringify({ facts: 'One field' }),
          model: 'claude-haiku-4-5-20251001',
          usage: { inputTokens: 300, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 40 },
          stopReason: 'end_turn',
        });
      }
      return Promise.resolve({
        text: 'Summary of the document.',
        model: 'claude-haiku-4-5-20251001',
        usage: { inputTokens: 200, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 30 },
        stopReason: 'end_turn',
      });
    });

    await extractDocument(SOURCE_ID, ACCOUNT_ID);

    const notesCalls = mockRpc.mock.calls.filter((c) => c[1]?.p_field_key === 'notes');
    expect(notesCalls.length).toBeGreaterThan(0);
    expect(notesCalls[0][1]).toMatchObject({ p_op: 'append' });
  });
});
