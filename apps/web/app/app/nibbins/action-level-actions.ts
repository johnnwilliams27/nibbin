'use server';

import { revalidatePath } from 'next/cache';
import { appSession } from '../../../lib/auth/app-session';
import { serviceClient } from '../../../lib/supabase/service';

export type ActionLevel = 'observe' | 'draft' | 'send';

export interface SetActionLevelResult {
  ok: boolean;
  error?: string;
}

/**
 * Set the action_level on one of the caller's own Nibbins (observe/draft/send).
 *
 * Ownership check mirrors beginWriteConnectAction (connections/actions.ts:69-74):
 * nibbinId is client-supplied so we verify it belongs to the session account
 * before touching any data — prevents IDOR pollution of the nibbin or grant
 * tables against another account's Nibbin.
 *
 * Grant reconciliation (for audit; the runtime gate reads action_level, not grants):
 *   send    → upsert email.send grant rows for every active write connection
 *             so nibbin_write_grants stays coherent with the elected level.
 *   draft / observe → revoke all active grant rows for the Nibbin so the audit
 *             table reflects that the Nibbin no longer has send authority.
 */
export async function setNibbinActionLevel(
  nibbinId: string,
  level: ActionLevel,
): Promise<SetActionLevelResult> {
  const id = nibbinId?.trim();
  if (!id) return { ok: false, error: 'nibbinId required' };
  if (!['observe', 'draft', 'send'].includes(level)) {
    return { ok: false, error: `invalid action level: ${level}` };
  }

  let accountId: string;
  let userId: string;
  try {
    const session = await appSession();
    accountId = session.accountId;
    userId = session.user.id;
  } catch {
    return { ok: false, error: 'You need to be signed in.' };
  }

  const svc = serviceClient();

  // ── Ownership check (IDOR guard) ────────────────────────────────────────────
  // Mirror: beginWriteConnectAction, connections/actions.ts:69-74
  const { count: owns } = await svc
    .from('nibbins')
    .select('id', { count: 'exact', head: true })
    .eq('id', id)
    .eq('account_id', accountId);
  if (!owns) return { ok: false, error: `nibbin ${id} not found for this account` };

  // ── Update action_level ─────────────────────────────────────────────────────
  const { error: updateError } = await svc
    .from('nibbins')
    .update({ action_level: level })
    .eq('id', id)
    .eq('account_id', accountId);
  if (updateError) return { ok: false, error: `setNibbinActionLevel update failed: ${updateError.message}` };

  // ── Grant reconciliation ────────────────────────────────────────────────────
  if (level === 'send') {
    // Ensure a nibbin_write_grants row exists for every active write connection.
    // This is purely for audit trail — the runtime gate reads action_level.
    const { data: activeConns } = await svc
      .from('connections')
      .select('id')
      .eq('account_id', accountId)
      .eq('status', 'active')
      .eq('provider', 'gmail');    // only provider with write capability currently

    if (activeConns && activeConns.length > 0) {
      const grantRows = activeConns.map((conn: { id: string }) => ({
        account_id: accountId,
        nibbin_id: id,
        connection_id: conn.id,
        capability: 'email.send' as const,
        granted_by: userId,
        plain_language_reason: 'Action level set to send by user.',
        revoked_at: null,
      }));

      const { error: upsertError } = await svc
        .from('nibbin_write_grants')
        .upsert(grantRows, { onConflict: 'nibbin_id,connection_id,capability' });
      if (upsertError) return { ok: false, error: `setNibbinActionLevel grant upsert failed: ${upsertError.message}` };
    }
  } else {
    // draft / observe — revoke all active grants for this Nibbin so the audit
    // table reflects the lowered permission level.
    const { error: revokeError } = await svc
      .from('nibbin_write_grants')
      .update({ revoked_at: new Date().toISOString() })
      .eq('nibbin_id', id)
      .eq('account_id', accountId)
      .is('revoked_at', null);
    if (revokeError) return { ok: false, error: `setNibbinActionLevel grant revoke failed: ${revokeError.message}` };
  }

  revalidatePath('/app/nibbins');
  return { ok: true };
}
