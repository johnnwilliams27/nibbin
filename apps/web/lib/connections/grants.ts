import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Write capabilities a Nibbin can hold on a connection. Each is gated at
 * execution time by the action level (observe/draft/act) — holding the grant
 * never bypasses the runtime side-effect gate. Task 3: email.draft retired;
 * email.send is the single email write capability (nativeDraft: true in the
 * registry — the action level decides draft-vs-act).
 *   email.send            — compose/send an email (action level gates draft-vs-act)
 *   calendar.event-create — create/modify a Calendar event (with approval)
 */
export type WriteCapability = 'email.send' | 'calendar.event-create';

export interface CreateWriteGrantInput {
  accountId: string;
  nibbinId: string;
  connectionId: string;
  capability: WriteCapability;
  grantedBy: string;
  plainLanguageReason: string;
}

/**
 * Task 3: two-tier model. The action level (observe/draft/act) governs
 * draft-vs-act within each write grant. UI only needs to know whether the
 * Nibbin holds any write grant.
 */
export type CapabilityTier =
  | 'read_only'  // no active write grants
  | 'write';     // at least one active write grant (email.send or calendar.event-create)

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
  capability: WriteCapability,
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
  capability: WriteCapability,
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
 * Reads nibbin_write_grants to produce the two-tier display tier (Task 3).
 * Returns 'write' when the Nibbin holds any active write grant, else 'read_only'.
 * The action level (observe/draft/act) on the agent spec governs draft-vs-act
 * within the write tier — no stage parameter needed here.
 */
export async function deriveCapabilityTier(
  nibbinId: string,
  connectionId: string,
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
  const active = (data ?? []).filter(
    (r) => r.revoked_at === null || r.revoked_at === undefined,
  );
  return active.length > 0 ? 'write' : 'read_only';
}
