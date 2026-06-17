import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { suspendGrantsForConnection } from './grants';

/**
 * Revoke a connection (vault secret destroyed, status → revoked) then
 * cascade-suspend all active nibbin_write_grants for that connection_id.
 * Design §4.4, §8 — disconnect closes the write gate.
 */
export async function revokeAndSuspend(
  connectionId: string,
  actorUserId: string,
  svc: SupabaseClient,
): Promise<void> {
  // Revoke the connection (security-definer RPC destroys the vault secret)
  const { error } = await svc.rpc('connection_revoke', {
    p_connection: connectionId,
    p_actor_user: actorUserId,
  });
  if (error) throw new Error(`connection_revoke failed: ${error.message}`);

  // Suspend all active write grants for this connection — runner's hasGrant
  // check will deny execute on next run
  await suspendGrantsForConnection(connectionId, svc);
}
