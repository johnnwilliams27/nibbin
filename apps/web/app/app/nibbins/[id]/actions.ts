'use server';

import { appSession } from '../../../../lib/auth/app-session';
import { serviceClient } from '../../../../lib/supabase/service';
import { GmailClient, SupabaseTokenVault } from '@nibbin/connectors';
import { pushDraftToGmail } from '../../../../lib/connections/push-draft';
import { revokeWriteGrant, type WriteCapability } from '../../../../lib/connections/grants';
import { connectionFromRow } from '../../../../lib/runtime/engine';
import { maybePromote } from '../../../../lib/runtime/engine';

/**
 * Guard: verifies that nibbinId belongs to the session accountId.
 * Throws if the nibbin does not exist or belongs to a different account.
 * Prevents IDOR: callers cannot act on another account's nibbin by supplying
 * an arbitrary nibbinId (FIX 2, Spec 2 security review).
 */
async function assertNibbinOwnership(nibbinId: string, accountId: string): Promise<void> {
  const svc = serviceClient();
  const { count } = await svc
    .from('nibbins')
    .select('id', { count: 'exact', head: true })
    .eq('id', nibbinId)
    .eq('account_id', accountId);
  if ((count ?? 0) === 0) {
    throw new Error(`nibbin ${nibbinId} not found for this account`);
  }
}

export interface PushDraftResult {
  gmailDraftId: string | undefined;
}

/**
 * Bypass-runner path: reads the draft payload from run_steps, checks grants,
 * calls GmailClient.createDraft. Does NOT re-enter the runtime runner.
 * design §9.2, §6.1.
 */
export async function pushDraftToGmailAction(
  nibbinId: string,
  runId: string,
  draftStepIdx: number,
): Promise<PushDraftResult> {
  const { accountId } = await appSession();
  // FIX 2: verify nibbin belongs to session account before any privileged operation
  await assertNibbinOwnership(nibbinId, accountId);
  const svc = serviceClient();
  const vault = new SupabaseTokenVault({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    serviceKey: process.env.SUPABASE_SECRET_KEY ?? '',
  });

  return pushDraftToGmail(
    { nibbinId, runId, draftStepIdx, accountId },
    {
      loadDraftPayload: async (rId, idx, aId) => {
        const { data, error } = await svc
          .from('run_steps')
          .select('payload')
          .eq('run_id', rId)
          .eq('idx', idx)
          .eq('account_id', aId)
          .eq('kind', 'draft')
          .single();
        if (error || !data) throw new Error('draft step not found');
        const p = data.payload as Record<string, unknown>;
        if (typeof p.rfc822 !== 'string') throw new Error('draft step has no rfc822 payload');
        return p.rfc822;
      },
      // Task 4: return the stored native_draft_ref from run_steps.payload so we
      // don't create a second Gmail draft when the runner already mirrored one.
      loadNativeDraftRef: async (rId, idx, aId) => {
        const { data } = await svc
          .from('run_steps')
          .select('payload')
          .eq('run_id', rId)
          .eq('idx', idx)
          .eq('account_id', aId)
          .eq('kind', 'draft')
          .maybeSingle();
        if (!data) return null;
        const p = data.payload as Record<string, unknown>;
        return typeof p.nativeDraftRef === 'string' ? p.nativeDraftRef : null;
      },
      hasGrant: async (nId, connId) => {
        const { count } = await svc
          .from('nibbin_write_grants')
          .select('id', { count: 'exact', head: true })
          .eq('nibbin_id', nId)
          .eq('connection_id', connId)
          .eq('capability', 'email.send')
          .is('revoked_at', null);
        return (count ?? 0) > 0;
      },
      gmailConnectionId: async () => {
        const { data } = await svc
          .from('connections')
          .select('id')
          .eq('account_id', accountId)
          .eq('provider', 'gmail')
          .eq('status', 'active')
          .maybeSingle();
        return (data?.id as string) ?? null;
      },
      createDraft: async (rfc822) => {
        const { data: connRow } = await svc
          .from('connections')
          .select('*')
          .eq('account_id', accountId)
          .eq('provider', 'gmail')
          .eq('status', 'active')
          .single();
        if (!connRow) throw new Error('no active gmail connection');
        const conn = connectionFromRow(connRow as Record<string, unknown>);
        const client = new GmailClient(conn, vault);
        return client.createDraft(rfc822);
      },
    },
  );
}

/**
 * Per-capability revoke from the Permissions panel (design §7.4).
 */
export async function revokeWriteGrantAction(
  nibbinId: string,
  connectionId: string,
  capability: WriteCapability,
): Promise<void> {
  const { accountId } = await appSession();
  // FIX 2: verify nibbin belongs to session account before revoking grants
  await assertNibbinOwnership(nibbinId, accountId);
  const svc = serviceClient();
  await revokeWriteGrant(nibbinId, connectionId, capability, svc);
}

/**
 * Server action to explicitly promote a Nibbin to Senior/Graduate if eligible,
 * and wire the email.send grant at Senior.
 */
export async function promoteNibbinAction(nibbinId: string): Promise<{ promotedTo: string | null }> {
  const { accountId } = await appSession();
  // FIX 2: verify nibbin belongs to session account before promoting
  await assertNibbinOwnership(nibbinId, accountId);
  const promotedTo = await maybePromote(nibbinId);
  return { promotedTo };
}
