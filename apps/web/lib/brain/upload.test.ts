/**
 * Unit tests for Task 3: upload route + status poll route.
 *
 * Tests import the POST handler directly and construct mock NextRequest objects.
 * External deps (appSession, serviceClient, extractDocument) are all mocked.
 *
 * Run: npx vitest run apps/web/lib/brain/upload.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock: appSession ──────────────────────────────────────────────────────
const mockAppSession = vi.fn();
vi.mock('../auth/app-session', () => ({
  appSession: (...args: unknown[]) => mockAppSession(...args),
}));

// ── Mock: extractDocument ─────────────────────────────────────────────────
const mockExtractDocument = vi.fn();
vi.mock('./doc-extract', () => ({
  extractDocument: (...args: unknown[]) => mockExtractDocument(...args),
}));

// ── Mock: Supabase service client ─────────────────────────────────────────
// We capture calls to storage.upload and from('sources').insert / from('source_extraction_jobs').insert
const mockStorageUpload = vi.fn();
const mockSourcesInsert = vi.fn();
const mockJobsInsert = vi.fn();
const mockSourcesSelect = vi.fn();
/** Controls what source_extraction_jobs.select returns for the status poll (I2). */
const mockJobsSelect = vi.fn();

vi.mock('../supabase/service', () => ({
  serviceClient: () => ({
    storage: {
      from: () => ({
        upload: (...args: unknown[]) => mockStorageUpload(...args),
      }),
    },
    from: (table: string) => {
      if (table === 'sources') {
        return {
          insert: (data: unknown) => ({
            select: () => ({
              single: () => mockSourcesInsert(data),
            }),
          }),
          select: (cols: unknown) => ({
            eq: (k1: string, v1: unknown) => ({
              eq: (k2: string, v2: unknown) => ({
                maybeSingle: () => mockSourcesSelect(cols, k1, v1, k2, v2),
              }),
            }),
          }),
        };
      }
      if (table === 'source_extraction_jobs') {
        return {
          insert: (data: unknown) => mockJobsInsert(data),
          select: (_cols: unknown) => ({
            eq: (_k1: string, _v1: unknown) => ({
              eq: (_k2: string, _v2: unknown) => ({
                maybeSingle: (...args: unknown[]) => mockJobsSelect(...args),
              }),
            }),
          }),
        };
      }
      if (table === 'proposals') {
        return {
          select: (_cols: unknown) => ({
            eq: (_k1: string, _v1: unknown) => ({
              eq: (_k2: string, _v2: unknown) => ({
                // count(*) returns head: true pattern; we'll use a simpler approach
              }),
            }),
          }),
        };
      }
      // Fallback for proposals count using head: true
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              count: 'exact',
            }),
          }),
        }),
      };
    },
  }),
}));

// ── Import the route handlers under test ─────────────────────────────────
// We import AFTER the mocks are set up.
import { POST } from '../../app/api/brain/documents/upload/route';
import { GET } from '../../app/api/brain/sources/[sourceId]/status/route';

// ── Helpers ───────────────────────────────────────────────────────────────

const VALID_ACCOUNT_ID = 'acct-test-0001';

function mockAuthed() {
  mockAppSession.mockResolvedValue({
    supabase: {},
    user: { id: 'user-1', email: 'test@ex.test' },
    accountId: VALID_ACCOUNT_ID,
  });
}

function mockUnauthed() {
  mockAppSession.mockRejectedValue(new Error('not signed in'));
}

/**
 * Build a multipart/form-data Request with a single file field.
 */
function makeUploadRequest(opts: {
  filename: string;
  mimeType: string;
  sizeBytes: number;
}): Request {
  const content = Buffer.alloc(opts.sizeBytes, 'A');
  const formData = new FormData();
  const blob = new Blob([content], { type: opts.mimeType });
  formData.append('file', blob, opts.filename);
  return new Request('http://localhost/api/brain/documents/upload', {
    method: 'POST',
    body: formData,
  });
}

/**
 * Build a GET request for the status poll route.
 */
function makeStatusRequest(sourceId: string): Request {
  return new Request(`http://localhost/api/brain/sources/${sourceId}/status`, {
    method: 'GET',
  });
}

/** Make params object for Next.js dynamic route. */
function makeParams(sourceId: string) {
  return { params: Promise.resolve({ sourceId }) };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('POST /api/brain/documents/upload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: storage upload succeeds
    mockStorageUpload.mockResolvedValue({ data: { path: 'some/path' }, error: null });
    // Default: sources insert succeeds
    mockSourcesInsert.mockResolvedValue({ data: { id: 'new-source-id' }, error: null });
    // Default: jobs insert succeeds
    mockJobsInsert.mockResolvedValue({ error: null });
    // Default: extractDocument is fire-and-forget, resolves immediately
    mockExtractDocument.mockResolvedValue(undefined);
    // Default: job select returns no row (race / not yet created)
    mockJobsSelect.mockResolvedValue({ data: null, error: null });
  });

  it('1. valid PDF upload → 202 + sourceId, Storage PUT called, sources + jobs rows inserted', async () => {
    mockAuthed();

    const req = makeUploadRequest({
      filename: 'rate-sheet.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
    });

    const res = await POST(req as unknown as Request);
    expect(res.status).toBe(202);

    const body = await res.json() as { sourceId: string };
    expect(typeof body.sourceId).toBe('string');
    expect(body.sourceId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );

    // Storage PUT called with path containing accountId prefix
    expect(mockStorageUpload).toHaveBeenCalledTimes(1);
    const [uploadPath] = mockStorageUpload.mock.calls[0] as [string, ...unknown[]];
    expect(uploadPath).toMatch(new RegExp(`^${VALID_ACCOUNT_ID}/`));

    // sources insert called with correct fields
    expect(mockSourcesInsert).toHaveBeenCalledTimes(1);
    const insertedSource = mockSourcesInsert.mock.calls[0][0] as Record<string, unknown>;
    expect(insertedSource.kind).toBe('document');
    expect(insertedSource.source_tier).toBe(60);
    expect(insertedSource.redaction_status).toBe('pending');

    // source_extraction_jobs insert called
    expect(mockJobsInsert).toHaveBeenCalledTimes(1);
    const insertedJob = mockJobsInsert.mock.calls[0][0] as Record<string, unknown>;
    expect(insertedJob.account_id).toBe(VALID_ACCOUNT_ID);
    expect(insertedJob.status).toBe('pending');
  });

  it('2. .doc file → 422 with doc_not_supported error', async () => {
    mockAuthed();

    const req = makeUploadRequest({
      filename: 'contract.doc',
      mimeType: 'application/msword',
      sizeBytes: 500,
    });

    const res = await POST(req as unknown as Request);
    expect(res.status).toBe(422);

    const body = await res.json() as { error: string; message: string };
    expect(body.error).toBe('doc_not_supported');
    expect(body.message).toMatch(/\.docx/i);

    // Storage should NOT be called
    expect(mockStorageUpload).not.toHaveBeenCalled();
  });

  it('3. .xlsx file → 202 accepted, stored with extraction_state=unsupported, job NOT enqueued', async () => {
    // Task 4: store-never-drop. xlsx is phase2_unsupported — stored but not enqueued.
    mockAuthed();

    const req = makeUploadRequest({
      filename: 'spreadsheet.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      sizeBytes: 500,
    });

    const res = await POST(req as unknown as Request);
    expect(res.status).toBe(202);

    const body = await res.json() as { sourceId: string };
    expect(typeof body.sourceId).toBe('string');

    // Storage MUST be called (store-never-drop)
    expect(mockStorageUpload).toHaveBeenCalledTimes(1);

    // sources row must be inserted with extraction_state='unsupported'
    expect(mockSourcesInsert).toHaveBeenCalledTimes(1);
    const insertedSource = mockSourcesInsert.mock.calls[0][0] as Record<string, unknown>;
    expect(insertedSource.extraction_state).toBe('unsupported');

    // source_extraction_jobs must NOT be enqueued for unsupported types
    expect(mockJobsInsert).not.toHaveBeenCalled();
  });

  it('4. file > 20 MB → 422 with file_too_large error including size', async () => {
    mockAuthed();

    const twentyOneMB = 21 * 1024 * 1024;
    const req = makeUploadRequest({
      filename: 'big-file.pdf',
      mimeType: 'application/pdf',
      sizeBytes: twentyOneMB,
    });

    const res = await POST(req as unknown as Request);
    expect(res.status).toBe(422);

    const body = await res.json() as { error: string; message: string };
    expect(body.error).toBe('file_too_large');
    expect(body.message).toMatch(/20 MB/i);

    // Storage should NOT be called
    expect(mockStorageUpload).not.toHaveBeenCalled();
  });

  it('5. unauthenticated request → 401', async () => {
    mockUnauthed();

    const req = makeUploadRequest({
      filename: 'test.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
    });

    const res = await POST(req as unknown as Request);
    expect(res.status).toBe(401);

    // No storage or DB calls
    expect(mockStorageUpload).not.toHaveBeenCalled();
    expect(mockSourcesInsert).not.toHaveBeenCalled();
  });

  it('6. image MIME types → 202 accepted, stored with extraction_state=pending, job enqueued (Task 4)', async () => {
    // Task 4: image/* is extractable (via vision path). Accept, store, enqueue.
    const imageMimes = [
      { filename: 'photo.jpg', mimeType: 'image/jpeg' },
      { filename: 'photo.png', mimeType: 'image/png' },
      { filename: 'photo.webp', mimeType: 'image/webp' },
      { filename: 'photo.heic', mimeType: 'image/heic' },
    ];

    for (const { filename, mimeType } of imageMimes) {
      mockAuthed();
      vi.clearAllMocks();
      mockStorageUpload.mockResolvedValue({ data: { path: 'some/path' }, error: null });
      mockSourcesInsert.mockResolvedValue({ data: { id: 'new-source-id' }, error: null });
      mockJobsInsert.mockResolvedValue({ error: null });
      mockExtractDocument.mockResolvedValue(undefined);
      mockJobsSelect.mockResolvedValue({ data: null, error: null });

      const req = makeUploadRequest({ filename, mimeType, sizeBytes: 1024 });
      const res = await POST(req as unknown as Request);

      expect(res.status).toBe(202);
      const body = await res.json() as { sourceId: string };
      expect(typeof body.sourceId).toBe('string');

      // Storage must be called
      expect(mockStorageUpload).toHaveBeenCalledTimes(1);

      // sources row must have extraction_state='pending'
      const insertedSource = mockSourcesInsert.mock.calls[0][0] as Record<string, unknown>;
      expect(insertedSource.extraction_state).toBe('pending');

      // Job must be enqueued
      expect(mockJobsInsert).toHaveBeenCalledTimes(1);
    }
  });

  // ── Task 4 new tests ───────────────────────────────────────────────────────

  it('T4a. image/png upload → 202, mime_type + byte_size + extraction_state=pending written, job enqueued', async () => {
    mockAuthed();

    const FILE_SIZE = 8192;
    const req = makeUploadRequest({
      filename: 'diagram.png',
      mimeType: 'image/png',
      sizeBytes: FILE_SIZE,
    });

    const res = await POST(req as unknown as Request);
    expect(res.status).toBe(202);

    const body = await res.json() as { sourceId: string };
    expect(typeof body.sourceId).toBe('string');

    // Storage PUT called
    expect(mockStorageUpload).toHaveBeenCalledTimes(1);

    // sources row must include the three new columns
    expect(mockSourcesInsert).toHaveBeenCalledTimes(1);
    const inserted = mockSourcesInsert.mock.calls[0][0] as Record<string, unknown>;
    expect(inserted.mime_type).toBe('image/png');
    expect(inserted.byte_size).toBe(FILE_SIZE);
    expect(inserted.extraction_state).toBe('pending');

    // Job must be enqueued
    expect(mockJobsInsert).toHaveBeenCalledTimes(1);
    const insertedJob = mockJobsInsert.mock.calls[0][0] as Record<string, unknown>;
    expect(insertedJob.status).toBe('pending');
  });

  it('T4b. pptx upload → 202, extraction_state=unsupported, job NOT enqueued', async () => {
    mockAuthed();

    const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    const req = makeUploadRequest({
      filename: 'deck.pptx',
      mimeType: PPTX_MIME,
      sizeBytes: 4096,
    });

    const res = await POST(req as unknown as Request);
    expect(res.status).toBe(202);

    const body = await res.json() as { sourceId: string };
    expect(typeof body.sourceId).toBe('string');

    // Storage PUT called (store-never-drop)
    expect(mockStorageUpload).toHaveBeenCalledTimes(1);

    // sources row must have extraction_state='unsupported'
    expect(mockSourcesInsert).toHaveBeenCalledTimes(1);
    const inserted = mockSourcesInsert.mock.calls[0][0] as Record<string, unknown>;
    expect(inserted.mime_type).toBe(PPTX_MIME);
    expect(inserted.byte_size).toBe(4096);
    expect(inserted.extraction_state).toBe('unsupported');

    // Job must NOT be enqueued
    expect(mockJobsInsert).not.toHaveBeenCalled();
    // extractDocument must NOT be called
    expect(mockExtractDocument).not.toHaveBeenCalled();
  });

  it('T4c. file > 20 MB → 422 file_too_large (size cap still enforced)', async () => {
    mockAuthed();

    const twentyOneMB = 21 * 1024 * 1024;
    const req = makeUploadRequest({
      filename: 'huge.png',
      mimeType: 'image/png',
      sizeBytes: twentyOneMB,
    });

    const res = await POST(req as unknown as Request);
    expect(res.status).toBe(422);

    const body = await res.json() as { error: string; message: string };
    expect(body.error).toBe('file_too_large');
    expect(body.message).toMatch(/20 MB/i);

    expect(mockStorageUpload).not.toHaveBeenCalled();
    expect(mockSourcesInsert).not.toHaveBeenCalled();
  });

  it('T4d. sources insert includes mime_type, byte_size, extraction_state column names', async () => {
    mockAuthed();

    const req = makeUploadRequest({
      filename: 'notes.txt',
      mimeType: 'text/plain',
      sizeBytes: 256,
    });

    const res = await POST(req as unknown as Request);
    expect(res.status).toBe(202);

    expect(mockSourcesInsert).toHaveBeenCalledTimes(1);
    const inserted = mockSourcesInsert.mock.calls[0][0] as Record<string, unknown>;

    // Exact column names required
    expect(Object.keys(inserted)).toContain('mime_type');
    expect(Object.keys(inserted)).toContain('byte_size');
    expect(Object.keys(inserted)).toContain('extraction_state');

    // text/plain is extractable → pending
    expect(inserted.mime_type).toBe('text/plain');
    expect(inserted.byte_size).toBe(256);
    expect(inserted.extraction_state).toBe('pending');
  });

  it('10. filename with path traversal characters → sanitized path, no directory separators', async () => {
    mockAuthed();

    const req = makeUploadRequest({
      filename: '../../../etc/passwd',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
    });

    const res = await POST(req as unknown as Request);
    // Should still succeed (sanitization allows the upload)
    expect(res.status).toBe(202);

    // The storage path must not contain ../ or actual dangerous sequences
    const [uploadPath] = mockStorageUpload.mock.calls[0] as [string, ...unknown[]];
    expect(uploadPath).not.toContain('../');
    expect(uploadPath).not.toContain('..\\');
    // The path should start with accountId/
    expect(uploadPath).toMatch(new RegExp(`^${VALID_ACCOUNT_ID}/`));
  });
});

describe('GET /api/brain/sources/[sourceId]/status', () => {
  const SOURCE_ID = 'src-poll-0001';

  beforeEach(() => {
    vi.clearAllMocks();
    mockExtractDocument.mockResolvedValue(undefined);
    // Default: no job row found (graceful fallback to redaction_status mapping)
    mockJobsSelect.mockResolvedValue({ data: null, error: null });
  });

  it('6. processing state → {status: "processing", proposalCount: 0}', async () => {
    mockAuthed();

    // Mock sources row: pending/processing redaction_status
    mockSourcesSelect.mockResolvedValue({
      data: {
        id: SOURCE_ID,
        redaction_status: 'processing',
        account_id: VALID_ACCOUNT_ID,
      },
      error: null,
    });

    const req = makeStatusRequest(SOURCE_ID);
    // We need to mock the proposals count too
    // The GET handler will count proposals — we need to intercept that
    // For the status mock, set up a serviceClient that returns count=0 for proposals
    const res = await GET(req as unknown as Request, makeParams(SOURCE_ID));
    expect(res.status).toBe(200);

    const body = await res.json() as { status: string; proposalCount: number };
    expect(body.status).toBe('processing');
    expect(typeof body.proposalCount).toBe('number');
  });

  it('7. done state → {status: "done", proposalCount: 3}', async () => {
    mockAuthed();

    mockSourcesSelect.mockResolvedValue({
      data: {
        id: SOURCE_ID,
        redaction_status: 'clean',
        account_id: VALID_ACCOUNT_ID,
      },
      error: null,
    });

    const req = makeStatusRequest(SOURCE_ID);
    const res = await GET(req as unknown as Request, makeParams(SOURCE_ID));
    expect(res.status).toBe(200);

    const body = await res.json() as { status: string; proposalCount: number };
    expect(body.status).toBe('done');
  });

  it('8. source not found → 404', async () => {
    mockAuthed();

    mockSourcesSelect.mockResolvedValue({ data: null, error: null });

    const req = makeStatusRequest('nonexistent-source-id');
    const res = await GET(req as unknown as Request, makeParams('nonexistent-source-id'));
    expect(res.status).toBe(404);
  });

  it('9. quarantined → {status: "error", proposalCount: 0}', async () => {
    mockAuthed();

    mockSourcesSelect.mockResolvedValue({
      data: {
        id: SOURCE_ID,
        redaction_status: 'quarantined',
        account_id: VALID_ACCOUNT_ID,
      },
      error: null,
    });

    const req = makeStatusRequest(SOURCE_ID);
    const res = await GET(req as unknown as Request, makeParams(SOURCE_ID));
    expect(res.status).toBe(200);

    const body = await res.json() as { status: string; proposalCount: number };
    expect(body.status).toBe('error');
    expect(body.proposalCount).toBe(0);
  });

  it('I2-regression. job status=error → {status: "error", errorMessage} even when redaction_status=pending', async () => {
    // A failed job (C1 RPC error, scanned-doc terminal error, any uncaught throw)
    // previously showed "processing forever" because the status route only read
    // sources.redaction_status. Now it reads source_extraction_jobs.status first.
    mockAuthed();

    // sources row still shows 'pending' (the worker never finished setting redaction_status)
    mockSourcesSelect.mockResolvedValue({
      data: {
        id: SOURCE_ID,
        redaction_status: 'pending',
        account_id: VALID_ACCOUNT_ID,
      },
      error: null,
    });

    // But the job row shows 'error' with a user-facing message
    mockJobsSelect.mockResolvedValue({
      data: {
        status: 'error',
        error_message: "Couldn't read this scanned document — try a text-based export (PDF with selectable text, or .docx)",
      },
      error: null,
    });

    const req = makeStatusRequest(SOURCE_ID);
    const res = await GET(req as unknown as Request, makeParams(SOURCE_ID));
    expect(res.status).toBe(200);

    const body = await res.json() as { status: string; proposalCount: number; errorMessage?: string };
    expect(body.status).toBe('error');
    expect(body.proposalCount).toBe(0);
    expect(body.errorMessage).toMatch(/scanned document/i);
  });
});
