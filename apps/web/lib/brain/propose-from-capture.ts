import 'server-only';

/**
 * P3 Task 4 — DI'd orchestration core for the propose-from-capture pipeline.
 *
 * Privacy invariants (C1/C7/§11 — non-negotiable):
 * - The `ObservationSummary` is already strict-parsed + battery-scanned by the
 *   caller (the route) before this function is invoked. This function performs
 *   NO additional structural validation of the summary — that is the route's job.
 * - Each model-proposed `value` is independently battery-scanned here before
 *   `propose_memory_change` is called. A dirty value is silently dropped; the
 *   source row survives (§11: the source row is staleness evidence regardless).
 * - The `sources.origin` JSONB stores ONLY structural derivations (aggregate
 *   timing, top-app list, workflow shapes, busiest hour) — never event ids, AX
 *   labels, window titles, URL paths, or keystroke content.
 * - Nothing here writes to `grove_memory` directly. The only write path is the
 *   existing security-definer RPC `propose_memory_change` (service-role-only),
 *   which enqueues the proposal for the F2 human-review queue.
 *
 * COGS (M6.5): `deriveProposalsFromObservation` now returns `{ proposals, model,
 * usage }`. When `model` and `usage` are non-null (a real T0 call was made),
 * this function calls `recordModelCall` with task='capture_propose' and
 * origin='pipeline'. The no-key / thin-data / error paths return null model/usage
 * — nothing is ledgered in those cases, preserving the "no key → no record"
 * invariant. The `recordCall` parameter is DI'd for testability (production
 * callers pass `recordModelCall` from `lib/llm/client`).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Generate } from '@nibbin/router';
import { batteryStillMatches } from '@nibbin/redaction';
import type { ModelCallRecord } from '../llm/client';
import type { ObservationSummary } from './observation-schema';
import { deriveProposalsFromObservation } from './derive-proposals';

export interface ProposeFromCaptureResult {
  source_id: string;
  proposal_ids: string[];
}

/** Minimal recorder type — matches `recordModelCall` from `lib/llm/client`. */
type RecordCall = (rec: ModelCallRecord) => Promise<void>;

/**
 * Core orchestration — DI'd so it is testable under vitest without a live route.
 *
 * @param accountId  - Resolved owner account (from ensureAccount in the route).
 * @param summary    - Validated + battery-scanned ObservationSummary.
 * @param svc        - Service-role Supabase client (bypasses RLS; required for
 *                     sources INSERT and propose_memory_change RPC).
 * @param generate   - Anthropic model client (null → no proposals, [] path).
 * @param recordCall - COGS recorder DI'd for testability; production callers pass
 *                     `recordModelCall` from `lib/llm/client`. When omitted,
 *                     COGS recording is silently skipped (safe for tests that do
 *                     not care about ledgering).
 */
export async function proposeFromCaptureCore(
  accountId: string,
  summary: ObservationSummary,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  svc: any,
  generate: Generate | null,
  recordCall?: RecordCall,
): Promise<ProposeFromCaptureResult> {
  // ── Step 1: Insert sources(kind='observation') row ──────────────────────
  // C1: origin stores ONLY structural fields (aggregate stats + app list + shapes).
  // No event ids, AX labels, window titles, URL paths, or keystroke content.
  const { data: src, error: srcErr } = await (svc as SupabaseClient)
    .from('sources')
    .insert({
      account_id: accountId,
      kind: 'observation',
      title: `Field Study — ${summary.study_period.start}`,
      origin: {
        study_id: summary.study_id,
        active_ms: summary.active_ms,
        top_apps: summary.top_apps,       // app name + duration + optional category
        workflow_shapes: summary.workflow_shapes, // transition patterns only
        busiest_hour: summary.busiest_hour,
      },
      source_tier: 40,
      redaction_status: 'clean',
      captured_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (srcErr || !src) throw new Error('source_insert_failed');
  const sourceId: string = (src as { id: string }).id;

  // ── Step 2: Derive 0–3 pattern proposals (returns [] on no-model / thin) ─
  const { proposals, model, usage } = await deriveProposalsFromObservation(summary, generate);

  // ── COGS ledger (M6.5): record the model call when one was actually made ──
  // `model` and `usage` are non-null only when deriveProposalsFromObservation
  // made a real API call. We never record on the no-key / thin-data / error
  // paths (those return null model/usage).
  if (recordCall && model !== null && usage !== null) {
    // Fire-and-forget: COGS failure must never fail the user's request.
    void recordCall({
      accountId,
      userId: null,   // pipeline call — no interactive user session
      runId: null,
      tier: 't0',
      task: 'capture_propose',
      model,
      usage,
      origin: 'pipeline',
    });
  }

  // ── Step 3: Per proposal — battery-scan value, then service-role propose ─
  // C1: each model-proposed value is independently scanned before write.
  // A dirty value is silently dropped (§11); the source row is already written.
  const proposalIds: string[] = [];
  for (const p of proposals) {
    if (batteryStillMatches(p.value) !== null) {
      // Silent drop — residual token detected in model output.
      continue;
    }
    const { data: id, error } = await (svc as SupabaseClient).rpc('propose_memory_change', {
      p_account: accountId,
      p_field_key: p.field_key,
      p_op: 'append',
      p_value: p.value,
      p_rationale: p.rationale,
      p_source_id: sourceId,
      p_origin: 'capture',
    });
    if (!error && id) proposalIds.push(id as string);
  }

  return { source_id: sourceId, proposal_ids: proposalIds };
}
