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
import { buildStoragePath } from '../../../../../lib/brain/storage-path';
import { mapRowToSourceListItem } from '../../../../app/memory/sourcesQuery';

/** 20 MB cap enforced before Storage PUT. */
const MAX_SIZE_BYTES = 20 * 1024 * 1024;

/** Legacy Word format — reject with a save-as nudge. */
const DOC_MIME = 'application/msword';

/**
 * Classify a MIME type for extraction routing.
 *
 * - 'extractable'  → store + enqueue extraction job (extraction_state='pending')
 * - 'unsupported'  → store only, no job (extraction_state='unsupported')
 *
 * Phase 2 types (pptx, xlsx) are unsupported for now; they will be handled
 * when a structured parser is added. Everything else (unknown types) is also
 * stored as unsupported — store-never-drop.
 */
type ExtractionClass = 'extractable' | 'unsupported';

function classifyMime(mime: string): ExtractionClass {
  // text-native
  if (
    mime === 'text/plain' ||
    mime === 'text/markdown' ||
    mime === 'text/csv' ||
    mime === 'text/html'
  ) return 'extractable';

  // PDF
  if (mime === 'application/pdf') return 'extractable';

  // docx
  if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'extractable';

  // images (vision extraction path)
  if (mime.startsWith('image/')) return 'extractable';

  // Phase 2 unsupported: pptx + xlsx — stored but not extracted yet
  // Everything else is also stored as unsupported (store-never-drop)
  return 'unsupported';
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

  // 3a. Validate MIME: .doc → nudge (save-as required; we cannot process these)
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

  // All other MIME types are accepted (store-never-drop). Unsupported types
  // are stored with extraction_state='unsupported' and never enqueued.
  const extractionClass = classifyMime(file.type);

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

  // 5. Sanitize filename and build storage path (always prefixed {accountId}/{sourceId}/)
  const storagePath = buildStoragePath(accountId, sourceId, file.name || 'document');

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
  //
  // NOTE: `redaction_status` is intentionally NOT set here. The column default
  // is 'clean' and its CHECK constraint only permits ('clean','redacted',
  // 'quarantined'). The extraction worker (doc-extract) sets the *terminal*
  // redaction_status from the redaction gate result after the row is created.
  // Writing 'pending' here (the old behavior) violated the CHECK constraint, so
  // EVERY upload insert failed — which then triggered the storage cleanup below,
  // leaving 0 sources rows AND 0 storage objects. That was the upload-persistence
  // bug. Leave redaction_status to its default.
  const insertExtractionState = extractionClass === 'extractable' ? 'pending' : 'unsupported';
  const { data: insertedSource, error: sourceError } = await svc
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
      // Task 4: new columns added by P1 branch migration
      mime_type: file.type,
      byte_size: file.size,
      extraction_state: insertExtractionState,
    })
    .select('id, title, mime_type, byte_size, captured_at, extraction_state')
    .single();

  if (sourceError || !insertedSource) {
    console.error('[upload] sources insert failed', sourceError?.message);
    // Best-effort cleanup of the uploaded file
    void svc.storage.from('brain-sources').remove([storagePath]);
    return Response.json({ error: 'store_failed', message: 'Failed to register document. Please try again.' }, { status: 502 });
  }

  // 8. Enqueue source_extraction_jobs row (only for extractable types)
  if (extractionClass === 'extractable') {
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
  }
  // For unsupported types: file is stored + sources row created with
  // extraction_state='unsupported'. No job enqueued; retained + searchable by name.

  // 10. Return 202 with the persisted source row so the client can render the
  // REAL item (it survives a server refetch) instead of a phantom optimistic
  // placeholder. `item` is shaped like the GET /api/brain/sources list rows.
  const item = mapRowToSourceListItem(insertedSource as Record<string, unknown>);
  return Response.json({ sourceId, item }, { status: 202 });
}
