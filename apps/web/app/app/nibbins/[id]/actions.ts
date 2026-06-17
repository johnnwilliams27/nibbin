'use server';

import { appSession } from '../../../../lib/auth/app-session';
import { serviceClient } from '../../../../lib/supabase/service';
import { GmailClient, SupabaseTokenVault } from '@nibbin/connectors';
import { pushDraftToGmail } from '../../../../lib/connections/push-draft';
import { revokeWriteGrant } from '../../../../lib/connections/grants';
import { connectionFromRow } from '../../../../lib/runtime/engine';
import { maybePromote } from '../../../../lib/runtime/engine';

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
      hasGrant: async (nId, connId) => {
        const { count } = await svc
          .from('nibbin_write_grants')
          .select('id', { count: 'exact', head: true })
          .eq('nibbin_id', nId)
          .eq('connection_id', connId)
          .eq('capability', 'email.draft')
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
  capability: 'email.draft' | 'email.send',
): Promise<void> {
  await appSession(); // enforce authentication
  const svc = serviceClient();
  await revokeWriteGrant(nibbinId, connectionId, capability, svc);
}

/**
 * Server action to explicitly promote a Nibbin to Senior/Graduate if eligible,
 * and wire the email.send grant at Senior.
 */
export async function promoteNibbinAction(nibbinId: string): Promise<{ promotedTo: string | null }> {
  await appSession();
  const promotedTo = await maybePromote(nibbinId);
  return { promotedTo };
}
