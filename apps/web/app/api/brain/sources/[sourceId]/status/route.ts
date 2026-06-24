import 'server-only';

/**
 * GET /api/brain/sources/[sourceId]/status
 *
 * Status-poll route the UI polls for job progress.
 * Returns {status, proposalCount, errorMessage?} scoped to the authenticated account.
 *
 * status mapping (job status takes precedence; redaction_status used for done/error detail):
 *   job.status = 'error'                   → 'error'  (with errorMessage)
 *   job.status = 'done' or 'pending'/'processing'
 *     redaction_status 'clean'|'redacted'  → 'done'
 *     redaction_status 'quarantined'       → 'error'
 *     redaction_status 'pending'           → 'processing'
 *   no job row (race / missing)            → fall back to redaction_status mapping
 */

export const dynamic = 'force-dynamic';

import { appSession } from '../../../../../../lib/auth/app-session';
import { serviceClient } from '../../../../../../lib/supabase/service';

type RedactionStatus = 'pending' | 'clean' | 'redacted' | 'quarantined';
type JobStatus = 'pending' | 'processing' | 'done' | 'error';
type PollStatus = 'processing' | 'done' | 'error';

function mapRedactionStatus(s: RedactionStatus): PollStatus {
  if (s === 'clean' || s === 'redacted') return 'done';
  if (s === 'quarantined') return 'error';
  return 'processing'; // 'pending'
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ sourceId: string }> },
): Promise<Response> {
  // 1. Authenticate
  let accountId: string;
  try {
    const session = await appSession();
    accountId = session.accountId;
  } catch {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { sourceId } = await params;

  if (!sourceId) {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }

  const svc = serviceClient();

  // 2. Fetch the sources row scoped to this account (service-role; we scope by
  //    accountId from the session so no RLS bypass is needed).
  const { data: source, error: sourceError } = await svc
    .from('sources')
    .select('id, redaction_status, account_id')
    .eq('id', sourceId)
    .eq('account_id', accountId)
    .maybeSingle();

  if (sourceError) {
    console.error('[status] sources fetch failed', sourceError.message);
    return Response.json({ error: 'fetch_failed' }, { status: 502 });
  }

  // 3. Not found or wrong account → 404
  if (!source) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }

  // 4. Fetch the extraction job row to get the canonical job status.
  //    A failed job (C1 RPC error, scanned-doc terminal error, any throw) must
  //    surface as 'error' — not "processing forever" or a false 'done'.
  const { data: job } = await svc
    .from('source_extraction_jobs')
    .select('status, error_message')
    .eq('source_id', sourceId)
    .eq('account_id', accountId)
    .maybeSingle();

  const jobStatus = (job as { status?: JobStatus; error_message?: string | null } | null)?.status ?? null;
  const jobErrorMessage = (job as { status?: JobStatus; error_message?: string | null } | null)?.error_message ?? null;

  // 5. Determine poll status.
  //    Job 'error' is authoritative — the job worker explicitly marked it failed.
  let status: PollStatus;
  let errorMessage: string | undefined;

  if (jobStatus === 'error') {
    status = 'error';
    errorMessage = jobErrorMessage ?? undefined;
  } else {
    // For done/processing/pending/null, use redaction_status for the definitive signal.
    const redactionStatus = (source as { redaction_status: RedactionStatus }).redaction_status ?? 'pending';
    status = mapRedactionStatus(redactionStatus);
  }

  // 6. Count proposals for this source (origin='doc_extract').
  //    Skip for error states — proposal count is always 0 and the query is unnecessary.
  let proposalCount = 0;
  if (status !== 'error') {
    const { count, error: countError } = await svc
      .from('proposals')
      .select('*', { count: 'exact', head: true })
      .eq('source_id', sourceId)
      .eq('origin', 'doc_extract');

    if (!countError && typeof count === 'number') {
      proposalCount = count;
    }
  }

  const responseBody: { status: PollStatus; proposalCount: number; errorMessage?: string } = {
    status,
    proposalCount,
  };
  if (errorMessage) {
    responseBody.errorMessage = errorMessage;
  }

  return Response.json(responseBody);
}
