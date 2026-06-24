import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { suspendGrantsForConnection } from './grants';

/**
 * Minimal interface for the Nango client used in the disconnect flow.
 * Structural typing lets tests supply a simple mock without satisfying the
 * full @nangohq/node Nango class (which returns AxiosResponse — awkward in tests).
 */
export interface NangoDeleteClient {
  deleteConnection(providerConfigKey: string, connectionId: string): Promise<unknown>;
}

/**
 * Optional Nango dependencies for disconnecting a [N]-lane connection.
 *
 * When present, `nango.deleteConnection(providerConfigKey, connectionId)` is
 * called before the local row revoke so Nango's token vault is cleared.
 * The call is fail-open: a Nango error is swallowed and the local revoke
 * always proceeds regardless (Global Constraint 8 — fail-open is the rule).
 */
export interface NangoRevokeDeps {
  /** Nango SDK instance (or any object with deleteConnection). */
  nango: NangoDeleteClient;
  /** Nango connection id stored on the connections row (nango_connection_id). */
  nangoConnectionId: string;
  /** Nango provider config key stored on the connections row (nango_provider_config_key). */
  nangoProviderConfigKey: string;
}

/**
 * Revoke a connection (vault secret destroyed, status → revoked) then
 * cascade-suspend all active nibbin_write_grants for that connection_id.
 * Design §4.4, §8 — disconnect closes the write gate.
 *
 * For [N] Nango-lane connections, pass `nangoDeps` to also delete the
 * token from Nango's vault before revoking the local row. The Nango call
 * is fail-open: a delete error does NOT block the local revoke.
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
  nangoDeps?: NangoRevokeDeps,
): Promise<void> {
  // [N] lane: delete the token from Nango's vault before local revoke.
  // Argument order: deleteConnection(providerConfigKey, connectionId) — NOT reversed.
  // Fail-open: a Nango error must never block the local revoke.
  if (nangoDeps) {
    await nangoDeps.nango
      .deleteConnection(nangoDeps.nangoProviderConfigKey, nangoDeps.nangoConnectionId)
      .catch(() => {
        // Intentionally swallowed — local revoke must always proceed.
      });
  }

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
