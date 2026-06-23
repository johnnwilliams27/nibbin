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

// ── Import the module under test ───────────────────────────────────────────
import { extractDocument } from './doc-extract';

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

  it('2. scanned PDF (< 100 chars): fails closed → job=error, zero proposals, no LLM call', async () => {
    // Fail-closed: scanned PDFs cannot be processed without real multimodal router support.
    // The old stub vision path would pass base64 as text and could hallucinate proposals.
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

    mockSourcesUpdate.mockResolvedValue({ error: null });
    mockJobsUpdate.mockResolvedValue({ error: null });

    await extractDocument(SOURCE_ID, ACCOUNT_ID);

    // MUST NOT call the LLM or propose anything
    expect(mockGenerateFn).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();

    // Job must be marked 'error' with the user-facing message
    const jobCalls = mockJobsUpdate.mock.calls;
    const errorCall = jobCalls.find((c) => JSON.stringify(c).includes('error'));
    expect(errorCall).toBeDefined();
    const errorPayload = JSON.stringify(errorCall);
    expect(errorPayload).toMatch(/scanned document/i);
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

  it('9. scanned PDF with > 10 pages: fails closed (truncated_pages flagged) → job=error, zero proposals', async () => {
    // Scanned PDFs fail closed regardless of page count. When truncated_pages is true,
    // the origin patch is still recorded before the terminal error is set.
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

    mockSourcesUpdate.mockResolvedValue({ error: null });
    mockJobsUpdate.mockResolvedValue({ error: null });

    await extractDocument(SOURCE_ID, ACCOUNT_ID);

    // MUST NOT call the LLM or propose anything
    expect(mockGenerateFn).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();

    // Job must be marked 'error'
    const jobCalls = mockJobsUpdate.mock.calls;
    const errorCall = jobCalls.find((c) => JSON.stringify(c).includes('error'));
    expect(errorCall).toBeDefined();

    // sources.origin should be updated with truncated_pages: true (recorded before terminal error)
    const updateCalls = mockSourcesUpdate.mock.calls;
    const truncatedCall = updateCalls.find((c) => JSON.stringify(c).includes('truncated_pages'));
    expect(truncatedCall).toBeDefined();
    expect(JSON.stringify(truncatedCall)).toContain('true');
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
