'use server';

/**
 * Server actions for Nibbin re-tuning (SPEC §18.2 / R52 — Slice 1).
 *
 * Architecture notes:
 *  - retune_nibbin is service_role-only (see migration
 *    20260619300000_agent_spec_versioning.sql). The service-role grant prevents
 *    a JWT caller from minting an unvalidated spec directly. The app-side
 *    validation gate (validateComposedSpec + trigger-graph cycle check) MUST run
 *    in this action before we call the RPC; skipping it would bypass the trust
 *    boundary entirely.
 *  - Auth pattern mirrors the sibling actions in this directory and
 *    apps/web/app/app/nibbins/actions.ts: appSession() derives the account from
 *    the server session — never from a client-supplied parameter.
 *  - The spec is loaded via the service client (bypass RLS) because
 *    agent_specs.insert/update/delete are revoked from authenticated. Reads are
 *    allowed under RLS, but we use the service client here for consistency and
 *    to avoid a second session round-trip.
 */

import { revalidatePath } from 'next/cache';
import { appSession } from '../../../../lib/auth/app-session';
import { serviceClient } from '../../../../lib/supabase/service';
import { activeConnections } from '../../../../lib/runtime/engine';
import {
  validateComposedSpec,
  validateTriggerGraph,
} from '@nibbin/runtime';
import { specFromRow } from '../../../../lib/runtime/engine';
import type { AgentSpec } from '@nibbin/runtime';
import type { SupabaseClient } from '@supabase/supabase-js';

/* ── Types ─────────────────────────────────────────────────────────────────── */

export interface CurrentSpec {
  specId: string;
  version: number;
  displayName: string;
  steps: AgentSpec['steps'];
  personaPolicy: AgentSpec['personaPolicy'];
}

export interface RetuneEdit {
  steps: AgentSpec['steps'];
  personaPolicy?: AgentSpec['personaPolicy'];
  displayName?: string;
}

export type RetuneResult =
  | { ok: true; newSpecId: string; version: number }
  | { ok: false; error: string };

/* ── Helpers ────────────────────────────────────────────────────────────────── */

/**
 * Load every non-sleeping spec for this account — the same set the adoption
 * path uses for the cross-account trigger-graph cycle check.
 */
async function accountSpecs(svc: SupabaseClient, accountId: string): Promise<AgentSpec[]> {
  const { data, error } = await svc
    .from('agent_specs')
    .select('*, nibbins!inner(status)')
    .eq('account_id', accountId)
    .neq('nibbins.status', 'sleeping');
  if (error) throw new Error(`spec load failed: ${error.message}`);
  const rowsTyped = (data ?? []) as Parameters<typeof specFromRow>[0][];
  return rowsTyped.map((row) => specFromRow(row));
}

/* ── Actions ────────────────────────────────────────────────────────────────── */

/**
 * Load the Nibbin's current spec for display in the RetuneDialog seed state.
 * Uses the service client (bypass RLS) so we can read agent_specs; membership
 * is verified by appSession() + the ownership query (only returns data if the
 * nibbin belongs to the session account).
 */
export async function loadCurrentSpecForRetune(nibbinId: string): Promise<CurrentSpec | { error: string }> {
  const id = nibbinId?.trim();
  if (!id) return { error: 'Missing nibbin.' };

  let accountId: string;
  try {
    ({ accountId } = await appSession());
  } catch {
    return { error: 'You need to be signed in.' };
  }

  const svc = serviceClient();
  const { data, error } = await svc
    .from('nibbins')
    .select('spec_id, agent_specs(*)')
    .eq('id', id)
    .eq('account_id', accountId)
    .single();

  if (error || !data) return { error: 'Nibbin not found on your account.' };

  const specRow = (Array.isArray(data.agent_specs) ? data.agent_specs[0] : data.agent_specs) as Parameters<typeof specFromRow>[0] | null;
  if (!specRow) return { error: 'Nibbin has no spec yet.' };

  const spec = specFromRow(specRow);
  return {
    specId: (data as { spec_id: string }).spec_id,
    version: spec.version,
    displayName: spec.displayName,
    steps: spec.steps ?? [],
    personaPolicy: spec.personaPolicy ?? {},
  };
}

/**
 * Re-tune a Nibbin's behavior by minting a new immutable spec version.
 *
 * Trust boundary:
 *  1. appSession() derives the authed account — never caller-supplied.
 *  2. Ownership is verified by the service-client query (.eq('account_id')).
 *  3. validateComposedSpec (fail-closed) + validateTriggerGraph cycle check run
 *     before any RPC call. The RPC is service_role-only precisely so this
 *     app-side gate cannot be bypassed via the JWT path.
 *  4. retune_nibbin is called only when both validators pass.
 */
export async function retuneNibbin(
  nibbinId: string,
  edit: RetuneEdit,
): Promise<RetuneResult> {
  const id = nibbinId?.trim();
  if (!id) return { ok: false, error: 'Missing nibbin.' };

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

  // Ownership check — also loads the current spec for re-validation context.
  const { data: nibbinRow, error: nibbinErr } = await svc
    .from('nibbins')
    .select('spec_id, agent_specs(*)')
    .eq('id', id)
    .eq('account_id', accountId)
    .single();

  if (nibbinErr || !nibbinRow) {
    return { ok: false, error: 'Nibbin not found on your account.' };
  }

  const specRow = (Array.isArray(nibbinRow.agent_specs) ? nibbinRow.agent_specs[0] : nibbinRow.agent_specs) as Parameters<typeof specFromRow>[0] | null;
  if (!specRow) {
    return { ok: false, error: 'Nibbin has no spec.' };
  }

  const currentSpec = specFromRow(specRow);

  // Build the candidate spec: current spec with the edited fields applied.
  // displayName, steps, personaPolicy fall back to the current value when the
  // edit omits them — matching the SQL coalesce in retune_nibbin.
  const candidateSpec: AgentSpec = {
    ...currentSpec,
    version: currentSpec.version + 1,
    displayName: edit.displayName?.trim() || currentSpec.displayName,
    steps: edit.steps ?? currentSpec.steps,
    personaPolicy: edit.personaPolicy ?? currentSpec.personaPolicy,
  };

  // Load active connectors for the account (required by validateComposedSpec).
  const connections = await activeConnections(svc, accountId);
  const providers = connections.map((c) => c.provider);

  // Load every non-sleeping account spec for the cross-spec trigger-graph cycle
  // check (same set the adoption path uses).
  let existing: AgentSpec[];
  try {
    existing = await accountSpecs(svc, accountId);
  } catch (err) {
    return {
      ok: false,
      error: `Could not load account specs for validation: ${err instanceof Error ? err.message : 'unknown error'}`,
    };
  }

  // ── Validation gate (fail-closed) ────────────────────────────────────────
  // validateComposedSpec internally calls validateTriggerGraph([...existing, spec]),
  // so it covers both the per-spec checks AND the cross-spec cycle check. We
  // also run validateTriggerGraph explicitly as a belt-and-suspenders parity
  // with adoptComposedSpec (same two-call defence).
  const composedProblems = validateComposedSpec(candidateSpec, providers, existing);
  if (composedProblems.length > 0) {
    return {
      ok: false,
      error: `Spec validation failed: ${composedProblems.join('; ')}`,
    };
  }

  const graphProblems = validateTriggerGraph([...existing, candidateSpec]);
  if (graphProblems.length > 0) {
    return {
      ok: false,
      error: `Trigger graph validation failed: ${graphProblems.join('; ')}`,
    };
  }
  // ─────────────────────────────────────────────────────────────────────────

  // Call the service_role-only RPC. The SQL re-checks nibbin/account ownership
  // under the account lock as defence-in-depth.
  const { data: rpcData, error: rpcErr } = await svc.rpc('retune_nibbin', {
    p_account: accountId,
    p_actor_user: userId,
    p_nibbin: id,
    p_display_name: candidateSpec.displayName,
    p_steps: candidateSpec.steps ?? [],
    p_persona_policy: candidateSpec.personaPolicy ?? {},
  });

  if (rpcErr) {
    // Translate known RPC errors to human-actionable copy (error-design stance).
    const msg = rpcErr.message ?? '';
    if (msg.includes('not found for account')) {
      return { ok: false, error: "We couldn't find that agent on your account." };
    }
    return { ok: false, error: "We couldn't save the changes just now. Please try again." };
  }

  const newSpecId = rpcData as string;

  revalidatePath('/app/nibbins');

  return { ok: true, newSpecId, version: candidateSpec.version };
}
