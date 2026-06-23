import 'server-only';

/**
 * GET /api/brain/sources/[sourceId]/status
 *
 * Status-poll route the UI polls for job progress.
 * Returns {status, proposalCount} scoped to the authenticated account (RLS-backed).
 *
 * status mapping:
 *   'pending' | 'processing' → 'processing'
 *   'clean'   | 'redacted'  → 'done'
 *   'quarantined'            → 'error'
 */

export const dynamic = 'force-dynamic';

import { appSession } from '../../../../../../lib/auth/app-session';
import { serviceClient } from '../../../../../../lib/supabase/service';

type RedactionStatus = 'pending' | 'processing' | 'clean' | 'redacted' | 'quarantined';
type PollStatus = 'processing' | 'done' | 'error';

function mapRedactionStatus(s: RedactionStatus): PollStatus {
  if (s === 'clean' || s === 'redacted') return 'done';
  if (s === 'quarantined') return 'error';
  return 'processing'; // 'pending' | 'processing'
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

  // 2. Fetch the sources row scoped to this account (service-role; no RLS bypass
  //    needed here since we scope by accountId from the session).
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

  // 4. Map redaction_status → poll status
  const redactionStatus = (source as { redaction_status: RedactionStatus }).redaction_status ?? 'pending';
  const status = mapRedactionStatus(redactionStatus);

  // 5. Count proposals for this source (origin='doc_extract')
  // For quarantined sources, skip the count (it's always 0)
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

  return Response.json({ status, proposalCount });
}
