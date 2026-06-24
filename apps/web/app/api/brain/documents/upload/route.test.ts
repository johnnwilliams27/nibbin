/**
 * POST /api/brain/documents/upload — persistence guarantees.
 *
 * Regression coverage for the "reports success without persisting" bug:
 *  - The Storage `.upload()` to `brain-sources` is AWAITED and its error checked;
 *    a storage failure returns a non-2xx response (NOT a false success).
 *  - The `sources` insert is AWAITED and its error checked; an insert failure
 *    returns a non-2xx response AND best-effort removes the orphaned object.
 *  - The happy path returns 202 with BOTH `sourceId` and the persisted `item`,
 *    enqueues an extraction job, and kicks the worker.
 *  - The insert never sets `redaction_status: 'pending'` — that value violates
 *    the column CHECK constraint (only 'clean'|'redacted'|'quarantined') and was
 *    the root cause: every insert failed, the cleanup then deleted the just-
 *    uploaded object, leaving 0 sources rows AND 0 storage objects in prod.
 *
 * Colocated with route.ts so the relative import paths in vi.mock() resolve
 * identically to how route.ts imports them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── hoisted shared spies ──────────────────────────────────────────────────────

const {
  uploadSpy,
  removeSpy,
  insertSingleFn,
  sourcesInsertSpy,
  jobInsertSpy,
  extractDocumentSpy,
  appSessionFn,
} = vi.hoisted(() => {
  // storage.from('brain-sources').upload(path, buffer, opts)
  const uploadSpy = vi.fn(async () => ({
    data: { path: 'x' } as { path: string } | null,
    error: null as null | { message: string },
  }));
  const removeSpy = vi.fn(async () => ({ data: [], error: null }));

  // sources insert chain: .insert(payload).select(cols).single()
  const insertSingleFn = vi.fn(async () => ({
    data: {
      id: 'src-uuid',
      title: 'brief.pdf',
      mime_type: 'application/pdf',
      byte_size: 1234,
      captured_at: '2026-06-22T00:00:00Z',
      extraction_state: 'pending',
    } as Record<string, unknown> | null,
    error: null as null | { message: string },
  }));

  const extractDocumentSpy = vi.fn(async () => {});
  const appSessionFn = vi.fn(async () => ({ accountId: 'acct-uuid' }));

  // Built lazily per-call below.
  const sourcesInsertSpy = vi.fn();
  const jobInsertSpy = vi.fn(async () => ({ error: null as null | { message: string } }));

  return {
    uploadSpy,
    removeSpy,
    insertSingleFn,
    sourcesInsertSpy,
    jobInsertSpy,
    extractDocumentSpy,
    appSessionFn,
  };
});

// ── vi.mock declarations ──────────────────────────────────────────────────────

vi.mock('server-only', () => ({}));

vi.mock('../../../../../lib/auth/app-session', () => ({
  appSession: appSessionFn,
}));

vi.mock('../../../../../lib/brain/doc-extract', () => ({
  extractDocument: extractDocumentSpy,
}));

vi.mock('../../../../../lib/supabase/service', () => ({
  serviceClient: vi.fn(() => ({
    storage: {
      from: vi.fn(() => ({
        upload: uploadSpy,
        remove: removeSpy,
      })),
    },
    from: vi.fn((table: string) => {
      if (table === 'sources') {
        return {
          insert: (...args: unknown[]) => {
            sourcesInsertSpy(...args);
            return { select: vi.fn(() => ({ single: insertSingleFn })) };
          },
        };
      }
      // source_extraction_jobs
      return { insert: jobInsertSpy };
    }),
  })),
}));

// ── helpers ───────────────────────────────────────────────────────────────────

async function importPOST() {
  const mod = await import('./route');
  return mod.POST;
}

function makeReq(file: File): Request {
  const fd = new FormData();
  fd.set('file', file);
  return new Request('http://localhost/api/brain/documents/upload', {
    method: 'POST',
    body: fd,
  });
}

function pdfFile(): File {
  return new File([new Uint8Array([1, 2, 3, 4])], 'brief.pdf', { type: 'application/pdf' });
}

beforeEach(() => {
  vi.clearAllMocks();
  uploadSpy.mockResolvedValue({ data: { path: 'x' }, error: null });
  insertSingleFn.mockResolvedValue({
    data: {
      id: 'src-uuid',
      title: 'brief.pdf',
      mime_type: 'application/pdf',
      byte_size: 1234,
      captured_at: '2026-06-22T00:00:00Z',
      extraction_state: 'pending',
    },
    error: null,
  });
  jobInsertSpy.mockResolvedValue({ error: null });
  appSessionFn.mockResolvedValue({ accountId: 'acct-uuid' });
});

// ── tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/brain/documents/upload — persistence', () => {
  it('happy path: awaits upload + insert, enqueues job, returns 202 with sourceId + item', async () => {
    const POST = await importPOST();
    const res = await POST(makeReq(pdfFile()));

    expect(res.status).toBe(202);

    // Storage upload was awaited (it resolved before we inspect the result).
    expect(uploadSpy).toHaveBeenCalledTimes(1);
    // sources insert was awaited (single() resolved).
    expect(sourcesInsertSpy).toHaveBeenCalledTimes(1);
    expect(insertSingleFn).toHaveBeenCalledTimes(1);
    // extraction job enqueued + worker kicked.
    expect(jobInsertSpy).toHaveBeenCalledTimes(1);
    expect(extractDocumentSpy).toHaveBeenCalledTimes(1);

    const body = (await res.json()) as { sourceId?: string; item?: { id?: string } };
    expect(typeof body.sourceId).toBe('string');
    expect(body.item?.id).toBe('src-uuid');
  });

  it('NEVER writes redaction_status:"pending" (the CHECK-violating value that broke every insert)', async () => {
    const POST = await importPOST();
    await POST(makeReq(pdfFile()));

    const insertPayload = sourcesInsertSpy.mock.calls[0][0] as Record<string, unknown>;
    // The route must not set an invalid redaction_status. Either omitted entirely
    // (DB default 'clean' applies) or one of the allowed values — never 'pending'.
    expect(insertPayload.redaction_status).not.toBe('pending');
  });

  it('storage upload failure → non-2xx (no false success), and no sources insert attempted', async () => {
    uploadSpy.mockResolvedValueOnce({ data: null, error: { message: 'bucket missing' } });
    const POST = await importPOST();
    const res = await POST(makeReq(pdfFile()));

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).not.toBe(202);
    // We never reached the sources insert.
    expect(sourcesInsertSpy).not.toHaveBeenCalled();
  });

  it('sources insert failure → non-2xx AND best-effort removes the orphaned object', async () => {
    insertSingleFn.mockResolvedValueOnce({ data: null, error: { message: 'check_violation' } });
    const POST = await importPOST();
    const res = await POST(makeReq(pdfFile()));

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).not.toBe(202);
    // The just-uploaded object is cleaned up so prod does not accumulate orphans.
    expect(removeSpy).toHaveBeenCalledTimes(1);
    // No extraction work is kicked off for a row that does not exist.
    expect(extractDocumentSpy).not.toHaveBeenCalled();
  });

  it('unauthenticated → 401, nothing touched', async () => {
    appSessionFn.mockRejectedValueOnce(new Error('no session'));
    const POST = await importPOST();
    const res = await POST(makeReq(pdfFile()));

    expect(res.status).toBe(401);
    expect(uploadSpy).not.toHaveBeenCalled();
    expect(sourcesInsertSpy).not.toHaveBeenCalled();
  });
});
