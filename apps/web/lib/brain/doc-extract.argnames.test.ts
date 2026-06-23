/**
 * Regression guard: propose_memory_change arg-name invariant (Task 8)
 *
 * PostgREST resolves RPC args by NAME. A prior bug in this extractor called
 * propose_memory_change({p_account_id}) when the param is p_account — zero
 * proposals while reporting success. This test locks the arg names for BOTH
 * the text path (doc-extract.ts) and the image/vision path (vision-extract.ts).
 *
 * This branch's form is the 7-arg RPC:
 *   propose_memory_change(
 *     p_account uuid, p_field_key text, p_op text,
 *     p_value text, p_rationale text, p_source_id uuid, p_origin text
 *   )
 *
 * NOTE: The P6 merge adds p_stakes (8th arg, default 'normal').
 * At that merge the assertion list below updates to 8 keys:
 *   [...EXPECTED_ARG_KEYS, 'p_stakes'].sort()
 *
 * Run: npx vitest run apps/web/lib/brain/doc-extract.argnames.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── The exact 7-arg param list this branch's migration defines ──────────────
// Source: supabase/migrations/20260622150000_company_brain_p2_doc_ingest.sql
//   (which create-or-replaces the form first defined in 20260622140000_company_brain_foundation.sql)
const EXPECTED_ARG_KEYS = [
  'p_account',
  'p_field_key',
  'p_op',
  'p_origin',
  'p_rationale',
  'p_source_id',
  'p_value',
].sort(); // sorted for deterministic comparison

// ── Mock: @nibbin/redaction ────────────────────────────────────────────────
const mockApplyBattery = vi.fn();
const mockHeuristicNerRedact = vi.fn();

vi.mock('@nibbin/redaction', () => ({
  applyBattery: (...args: unknown[]) => mockApplyBattery(...args),
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

// ── Mock: recordModelCall + anthropicGenerate ──────────────────────────────
const mockRecordModelCall = vi.fn();
const mockGenerateFn = vi.fn();
function mockAnthropicGenerate() {
  return mockGenerateFn;
}

vi.mock('../llm/client', () => ({
  anthropicGenerate: () => mockAnthropicGenerate(),
  recordModelCall: (...args: unknown[]) => mockRecordModelCall(...args),
}));

// ── Mock: Supabase service client ──────────────────────────────────────────
const mockStorageDownload = vi.fn();
const mockSourcesUpdate = vi.fn();
const mockJobsUpdate = vi.fn();
const mockRpc = vi.fn();
const mockSelect = vi.fn();

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
          update: (payload: unknown) => ({
            eq: (k: string, v: string) => mockSourcesUpdate(payload, k, v),
          }),
        };
      }
      return { update: vi.fn(), select: vi.fn() };
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

// ── Import the module under test AFTER mocks ───────────────────────────────
import { extractDocument } from './doc-extract';
import { extractFromImage } from './vision-extract';
import type { Generate, GenerateRequest } from '@nibbin/router';

// ── Shared helpers ────────────────────────────────────────────────────────

function makePdfBuffer(text: string, numPages = 5): Buffer {
  return Buffer.from(`PDF:${numPages}:${text}`);
}

function setupCleanRedaction(text: string) {
  mockApplyBattery.mockReturnValue({ text, rulesHit: [] });
  mockHeuristicNerRedact.mockResolvedValue({ redacted: text, rulesHit: [] });
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('propose_memory_change arg-name regression guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSourcesUpdate.mockResolvedValue({ error: null });
    mockJobsUpdate.mockResolvedValue({ error: null });
    mockRpc.mockResolvedValue({ data: 'pid-guard', error: null });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // A1: TEXT PATH (doc-extract.ts) — text-native PDF drives the propose loop
  // ──────────────────────────────────────────────────────────────────────────
  it('A1. text-path: extractDocument calls propose_memory_change with EXACTLY the 7-arg branch param names', async () => {
    const rawText =
      'Photography studio specializing in weddings. Our rate is $200 per hour for portrait sessions, $350 per hour for events, and $500 for full-day wedding coverage.';

    mockStorageDownload.mockResolvedValue({
      data: makePdfBuffer(rawText, 5),
      error: null,
    });
    mockSelect.mockResolvedValue({
      data: { origin: { filename: 'rate-sheet.pdf', mime: 'application/pdf' }, id: 'src-1' },
      error: null,
    });
    mockPdfParse.mockResolvedValue({
      text: rawText,
      numpages: 5,
    });

    setupCleanRedaction(rawText);

    mockGroveRouterRoute.mockResolvedValue({
      model: 'claude-haiku-4-5-20251001',
      tier: 't1',
      degraded: false,
    });

    // LLM returns two fields so we exercise the propose loop twice
    mockGenerateFn.mockResolvedValue({
      text: JSON.stringify({ pricing: '$200/hr', facts: 'Photography studio' }),
      model: 'claude-haiku-4-5-20251001',
      usage: { inputTokens: 100, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 50 },
      stopReason: 'end_turn',
    });

    await extractDocument('src-argguard-text', 'acct-argguard');

    // Must have been called at least once (text path does propose loop)
    expect(mockRpc).toHaveBeenCalled();

    const rpcCalls = mockRpc.mock.calls.filter(
      (c: unknown[]) => c[0] === 'propose_memory_change',
    );
    expect(rpcCalls.length).toBeGreaterThan(0);

    for (const call of rpcCalls) {
      const args = call[1] as Record<string, unknown>;
      const actualKeys = Object.keys(args).sort();

      // Exact match: sorted actual keys must equal the expected 7-key list
      expect(actualKeys).toEqual(EXPECTED_ARG_KEYS);
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // A2: IMAGE/VISION PATH (vision-extract.ts) — direct call to extractFromImage
  // ──────────────────────────────────────────────────────────────────────────
  it('A2. vision-path: extractFromImage calls propose_memory_change with EXACTLY the 7-arg branch param names', async () => {
    const buffer = Buffer.from('PNG_FAKE_BYTES_FOR_ARGNAME_GUARD');
    const mime = 'image/png';
    const extractedText = 'Photography pricing: $200/hr portraits. Studio downtown.';

    // Redaction: clean pass-through
    setupCleanRedaction(extractedText);

    // LLM returns fields
    const mockGenerate: Generate = vi.fn().mockImplementation(async (req: GenerateRequest) => {
      void req; // suppress unused-arg lint
      return {
        text: JSON.stringify({
          pricing: '$200/hr for portrait sessions',
          facts: 'Downtown photography studio',
        }),
        model: 'claude-haiku-4-5-20251001',
        usage: { inputTokens: 80, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 30 },
        stopReason: 'end_turn',
      };
    });

    const visionRpc = vi.fn().mockResolvedValue({ data: 'pid-vision-guard', error: null });

    await extractFromImage(buffer, mime, mockGenerate, visionRpc, {
      accountId: 'acct-argguard-vision',
      sourceId: 'src-argguard-vision',
      filename: 'photo.png',
      model: 'claude-haiku-4-5-20251001',
    });

    // At least one RPC call
    expect(visionRpc).toHaveBeenCalled();

    const rpcCalls = visionRpc.mock.calls.filter(
      (c: unknown[]) => c[0] === 'propose_memory_change',
    );
    expect(rpcCalls.length).toBeGreaterThan(0);

    for (const call of rpcCalls) {
      const args = call[1] as Record<string, unknown>;
      const actualKeys = Object.keys(args).sort();

      // Exact match: sorted actual keys must equal the expected 7-key list
      expect(actualKeys).toEqual(EXPECTED_ARG_KEYS);
    }
  });
});
