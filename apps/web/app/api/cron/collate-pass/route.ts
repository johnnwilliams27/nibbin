import { NextResponse, type NextRequest } from 'next/server';
import { serviceClient } from '../../../../lib/supabase/service';
import { isAuthorizedCronRequest } from '../../../../lib/connections/cron-auth';
import { collateAccount } from '../../../../lib/brain/collate';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Maximum number of accounts to process in a single cron invocation. */
const BATCH_SIZE = 200;

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const svc = serviceClient();

  // Load a bounded batch of account ids, most-recently-created first.
  let accountIds: string[];
  try {
    const { data, error } = await svc
      .from('accounts')
      .select('id')
      .order('created_at', { ascending: false })
      .limit(BATCH_SIZE);

    if (error) {
      console.error('[collate-pass] failed to load accounts:', error.message);
      return NextResponse.json({ ok: false, error: error.message });
    }

    accountIds = ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
  } catch (err) {
    console.error(
      '[collate-pass] unexpected error loading accounts:',
      err instanceof Error ? err.message : String(err),
    );
    return NextResponse.json({ ok: false, error: 'internal' });
  }

  // Aggregate counters across all accounts.
  let totalConflicts = 0;
  let totalDeduped = 0;
  let totalStale = 0;
  let totalBriefs = 0;

  // Fail-safe per account: one account's error doesn't abort the batch.
  for (const accountId of accountIds) {
    try {
      const result = await collateAccount(svc, accountId);
      totalConflicts += result.conflicts;
      totalDeduped += result.deduped;
      totalStale += result.stale;
      if (result.briefEmitted) totalBriefs += 1;
    } catch (err) {
      console.error(
        '[collate-pass] account failed:',
        accountId,
        err instanceof Error ? err.message : String(err),
      );
      // Continue with remaining accounts.
    }
  }

  console.log(
    '[collate-pass] done:',
    accountIds.length,
    'accounts,',
    totalConflicts,
    'conflicts,',
    totalDeduped,
    'deduped,',
    totalStale,
    'stale,',
    totalBriefs,
    'briefs',
  );

  return NextResponse.json({
    accounts: accountIds.length,
    conflicts: totalConflicts,
    deduped: totalDeduped,
    stale: totalStale,
    briefs: totalBriefs,
  });
}
