import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface CreateWriteGrantInput {
  accountId: string;
  nibbinId: string;
  connectionId: string;
  capability: 'email.draft' | 'email.send';
  grantedBy: string;
  plainLanguageReason: string;
}

export type CapabilityTier =
  | 'read_only'       // no write grants
  | 'draft_only'      // email.draft active, email.send absent or revoked
  | 'one_click_send'  // email.send active (Senior)
  | 'autonomous_send'; // email.send active + nibbin stage = 'grad'

/** Idempotent upsert — ON CONFLICT (nibbin_id, connection_id, capability) sets revoked_at = null */
export async function createWriteGrant(
  input: CreateWriteGrantInput,
  svc: SupabaseClient,
): Promise<void> {
  const { error } = await svc.from('nibbin_write_grants').upsert(
    {
      account_id: input.accountId,
      nibbin_id: input.nibbinId,
      connection_id: input.connectionId,
      capability: input.capability,
      granted_by: input.grantedBy,
      plain_language_reason: input.plainLanguageReason,
      revoked_at: null,
    },
    { onConflict: 'nibbin_id,connection_id,capability' },
  );
  if (error) throw new Error(`createWriteGrant failed: ${error.message}`);
}

/** Shortcut when compose already held — no OAuth round-trip needed. */
export async function grantWriteCapability(
  nibbinId: string,
  connectionId: string,
  accountId: string,
  userId: string,
  capability: 'email.draft' | 'email.send',
  plainLanguageReason: string,
  svc: SupabaseClient,
): Promise<void> {
  return createWriteGrant(
    { accountId, nibbinId, connectionId, capability, grantedBy: userId, plainLanguageReason },
    svc,
  );
}

/** Sets revoked_at = now() for one (nibbinId, connectionId, capability). */
export async function revokeWriteGrant(
  nibbinId: string,
  connectionId: string,
  capability: 'email.draft' | 'email.send',
  svc: SupabaseClient,
): Promise<void> {
  const { error } = await svc
    .from('nibbin_write_grants')
    .update({ revoked_at: new Date().toISOString() })
    .eq('nibbin_id', nibbinId)
    .eq('connection_id', connectionId)
    .eq('capability', capability)
    .is('revoked_at', null);
  if (error) throw new Error(`revokeWriteGrant failed: ${error.message}`);
}

/** Sets revoked_at on ALL active grants for a connection_id (called on disconnect). */
export async function suspendGrantsForConnection(
  connectionId: string,
  svc: SupabaseClient,
): Promise<void> {
  const { error } = await svc
    .from('nibbin_write_grants')
    .update({ revoked_at: new Date().toISOString() })
    .eq('connection_id', connectionId)
    .is('revoked_at', null);
  if (error) throw new Error(`suspendGrantsForConnection failed: ${error.message}`);
}

/**
 * Reads nibbin_write_grants to produce a display tier.
 * Does NOT read nibbins.stage — the caller passes stage if needed for 'autonomous_send'.
 */
export async function deriveCapabilityTier(
  nibbinId: string,
  connectionId: string,
  nibbinStage: 'egg' | 'student' | 'senior' | 'grad',
  svc: SupabaseClient,
): Promise<CapabilityTier> {
  const { data, error } = await svc
    .from('nibbin_write_grants')
    .select('capability, revoked_at')
    .eq('nibbin_id', nibbinId)
    .eq('connection_id', connectionId)
    .is('revoked_at', null);
  if (error) throw new Error(`deriveCapabilityTier failed: ${error.message}`);
  // Filter to only active (non-revoked) grants defensively in case of mock/test env
  const active = new Set(
    (data ?? [])
      .filter((r) => r.revoked_at === null || r.revoked_at === undefined)
      .map((r) => r.capability as string),
  );
  if (!active.has('email.draft')) return 'read_only';
  if (!active.has('email.send')) return 'draft_only';
  if (nibbinStage === 'grad') return 'autonomous_send';
  return 'one_click_send';
}
