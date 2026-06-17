import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { suspendGrantsForConnection } from './grants';

/**
 * Revoke a connection (vault secret destroyed, status → revoked) then
 * cascade-suspend all active nibbin_write_grants for that connection_id.
 * Design §4.4, §8 — disconnect closes the write gate.
 *
 * The DB-layer connection_revoke RPC now also suspends grants atomically
 * (FIX 3, Spec 2 migration 20260617120000). The suspendGrantsForConnection
 * call below is belt-and-suspenders: it ensures grants are suspended even
 * on already-revoked connections (where the RPC raises an error) so that
 * any grants left active by an earlier bug are always closed here.
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

  // FIX 3 (minor): suspend grants regardless of whether the RPC raised
  // "already revoked" — this closes any grants that slipped through before
  // the DB-layer fix was applied. We do this before propagating the error so
  // a pre-revoked connection still has its grants cleaned up.
  await suspendGrantsForConnection(connectionId, svc);

  if (error) throw new Error(`connection_revoke failed: ${error.message}`);
}
