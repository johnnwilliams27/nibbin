import { NextResponse, type NextRequest } from 'next/server';
import { accountDeletedEmail, renderTransactional, resendProvider } from '@nibbin/email';
import { serviceClient } from '../../../../lib/supabase/service';
import { isAuthorizedCronRequest } from '../../../../lib/connections/cron-auth';

/**
 * Stage 2b of issue #29: the nightly runner that enforces the deletion clock.
 * Finds accounts whose grace window has elapsed, calls the irreversible
 * purge_deleted_account carve-out, removes the auth identity of members who
 * belong to no other account, and mails the §6.11 completion receipt.
 *
 * TWO HARD GATES, because the carve-out is irreversible:
 *  1. CRON_SECRET — only Vercel Cron (or an operator with the secret) can call.
 *  2. ACCOUNT_PURGE_ENABLED must be exactly 'true' — otherwise the route is
 *     inert and returns { skipped: 'disabled' }. A default deploy never purges.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface MemberRow {
  user_id: string;
  role: string;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (process.env.ACCOUNT_PURGE_ENABLED !== 'true') {
    return NextResponse.json({ skipped: 'disabled' });
  }

  const svc = serviceClient();

  const { data: due, error } = await svc
    .from('accounts')
    .select('id')
    .lte('purge_after', new Date().toISOString())
    .is('purged_at', null)
    .limit(50);
  if (error) {
    return NextResponse.json({ error: 'query_failed' }, { status: 500 });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM ?? 'Nibbin <keeper@nibbin.com>';
  const postalAddress = process.env.EMAIL_POSTAL_ADDRESS;

  let purged = 0;
  const errors: string[] = [];

  for (const acct of (due ?? []) as { id: string }[]) {
    try {
      // Capture everything personal BEFORE the purge scrubs it.
      const { data: members } = await svc
        .from('memberships')
        .select('user_id, role')
        .eq('account_id', acct.id);
      const memberRows = (members ?? []) as MemberRow[];

      const ownerId = memberRows.find((m) => m.role === 'owner')?.user_id ?? null;
      let ownerEmail: string | null = null;
      if (ownerId) {
        const { data: u } = await svc.from('users').select('email').eq('id', ownerId).single();
        ownerEmail = (u as { email: string } | null)?.email ?? null;
      }

      // Members who belong to no other account lose their auth identity too.
      const soleUserIds: string[] = [];
      for (const m of memberRows) {
        const { count } = await svc
          .from('memberships')
          .select('account_id', { count: 'exact', head: true })
          .eq('user_id', m.user_id)
          .neq('account_id', acct.id);
        if (!count) soleUserIds.push(m.user_id);
      }

      // The irreversible step. Clock-guarded and idempotent inside the RPC.
      const { error: pErr } = await svc.rpc('purge_deleted_account', { p_account: acct.id });
      if (pErr) {
        errors.push(`${acct.id}: ${pErr.message}`);
        continue;
      }
      purged++;

      // Remove the auth identities (cascades the already-scrubbed public.users).
      for (const uid of soleUserIds) {
        try {
          await svc.auth.admin.deleteUser(uid);
        } catch {
          /* best-effort; the personal data is already gone */
        }
      }

      // Completion receipt — best-effort, never un-purges.
      if (apiKey && ownerEmail) {
        try {
          const msg = renderTransactional(accountDeletedEmail(), { from, to: ownerEmail, postalAddress });
          await resendProvider(apiKey).send(msg);
        } catch {
          /* receipt failed to send; the deletion still stands */
        }
      }
    } catch (e) {
      errors.push(`${acct.id}: ${(e as Error).message}`);
    }
  }

  return NextResponse.json({ processed: (due ?? []).length, purged, errors });
}
