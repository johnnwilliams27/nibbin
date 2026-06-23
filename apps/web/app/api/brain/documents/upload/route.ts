import 'server-only';

/**
 * POST /api/brain/documents/upload
 *
 * Accepts a multipart document upload, validates type + size, stores the
 * original file in the private `brain-sources` Storage bucket, creates a
 * `sources` row (kind='document'), enqueues a `source_extraction_jobs` row,
 * and fires the extraction worker (fire-and-forget). Returns 202 + {sourceId}.
 *
 * Pinned to Node.js runtime: pdf-parse + mammoth are CJS-only.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { appSession } from '../../../../../lib/auth/app-session';
import { serviceClient } from '../../../../../lib/supabase/service';
import { extractDocument } from '../../../../../lib/brain/doc-extract';

/** 20 MB cap enforced before Storage PUT. */
const MAX_SIZE_BYTES = 20 * 1024 * 1024;

/** Accepted MIME types for document uploads. */
const ACCEPTED_MIMES = new Set<string>([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'text/plain',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
]);

/** Legacy Word format — reject with a save-as nudge. */
const DOC_MIME = 'application/msword';

/**
 * Sanitize a filename for use as a Storage path segment.
 * Strips `/`, `\`, null bytes, and leading dots to prevent path traversal.
 */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[/\\\x00]/g, '_') // strip path separators + null bytes
    .replace(/^\.+/, '_');       // replace leading dots
}

export async function POST(req: Request): Promise<Response> {
  // 1. Authenticate
  let accountId: string;
  try {
    const session = await appSession();
    accountId = session.accountId;
  } catch {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  // 2. Parse multipart body
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return Response.json({ error: 'bad_request', message: 'Expected multipart/form-data body.' }, { status: 400 });
  }

  const file = formData.get('file');
  if (!file || !(file instanceof File)) {
    return Response.json({ error: 'bad_request', message: 'Missing file field.' }, { status: 400 });
  }

  // 3a. Validate MIME: .doc → nudge, other bad types → generic error
  if (file.type === DOC_MIME) {
    return Response.json(
      {
        error: 'doc_not_supported',
        message: 'Please save the file as .docx and try again.',
      },
      { status: 422 },
    );
  }

  // Extension-based .doc check (some browsers may send empty MIME for .doc)
  if (file.name.toLowerCase().endsWith('.doc') && !file.name.toLowerCase().endsWith('.docx')) {
    return Response.json(
      {
        error: 'doc_not_supported',
        message: 'Please save the file as .docx and try again.',
      },
      { status: 422 },
    );
  }

  if (!ACCEPTED_MIMES.has(file.type)) {
    return Response.json(
      {
        error: 'unsupported_type',
        message: 'Nibbin can read PDFs, Word docs (.docx), plain text, and images. Try a different file.',
      },
      { status: 422 },
    );
  }

  // 3b. Validate size — enforce BEFORE Storage PUT
  if (file.size > MAX_SIZE_BYTES) {
    const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
    return Response.json(
      {
        error: 'file_too_large',
        message: `That file is ${sizeMb} MB — the limit is 20 MB. Try a smaller file or export a portion.`,
      },
      { status: 422 },
    );
  }

  // 4. Generate a new sourceId (UUID)
  const sourceId = crypto.randomUUID();

  // 5. Sanitize filename and build storage path
  const sanitizedFilename = sanitizeFilename(file.name || 'document');
  const storagePath = `${accountId}/${sourceId}/${sanitizedFilename}`;

  // 6. Upload to brain-sources Storage
  const buffer = Buffer.from(await file.arrayBuffer());
  const svc = serviceClient();

  const { error: uploadError } = await svc.storage.from('brain-sources').upload(storagePath, buffer, {
    contentType: file.type,
    upsert: false,
  });

  if (uploadError) {
    console.error('[upload] Storage PUT failed', uploadError.message);
    return Response.json({ error: 'upload_failed', message: 'File storage failed. Please try again.' }, { status: 502 });
  }

  // 7. Insert sources row
  const { error: sourceError } = await svc
    .from('sources')
    .insert({
      id: sourceId,
      account_id: accountId,
      kind: 'document',
      title: file.name.slice(0, 300),
      storage_path: storagePath,
      origin: {
        filename: file.name,
        mime: file.type,
        size_bytes: file.size,
      },
      source_tier: 60,
      redaction_status: 'pending',
    })
    .select()
    .single();

  if (sourceError) {
    console.error('[upload] sources insert failed', sourceError.message);
    // Best-effort cleanup of the uploaded file
    void svc.storage.from('brain-sources').remove([storagePath]);
    return Response.json({ error: 'store_failed', message: 'Failed to register document. Please try again.' }, { status: 502 });
  }

  // 8. Enqueue source_extraction_jobs row
  const { error: jobError } = await svc.from('source_extraction_jobs').insert({
    account_id: accountId,
    source_id: sourceId,
    status: 'pending',
  });

  if (jobError) {
    console.error('[upload] source_extraction_jobs insert failed', jobError.message);
    // Non-fatal: the file + sources row exist; the worker can be triggered separately
  }

  // 9. Fire-and-forget: kick the extraction worker
  // The job row tracks status; the status-poll route reflects it.
  // If the function is killed before extraction completes, the job stays 'pending'
  // and the 90-second poll timeout shows the user a "check back" message.
  void extractDocument(sourceId, accountId);

  // 10. Return 202 immediately
  return Response.json({ sourceId }, { status: 202 });
}
