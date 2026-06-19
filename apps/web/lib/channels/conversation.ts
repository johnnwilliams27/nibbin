/**
 * Conversation orchestrator — handleInbound (Plan 05 §7.1–7.3)
 *
 * Pure-ish orchestrator over injected deps so it is unit-testable without any
 * real Supabase / model clients. The three branches:
 *
 *   approval  — route the decision through decideViaChannel; never executes
 *               anything directly (C10: keeper has no hands; decide is the
 *               only authorised path).
 *   status    — gate, then call keeperChat (read-only; no tools). Budgeted.
 *   work      — gate, then honest degrade until the Planner is injected and
 *               CHANNELS_INITIATED_WORK_ENABLED is true (§7.3 placeholder).
 *
 * Real deps wiring (building gate/answer/reply/decide from live clients) is a
 * SEPARATE handoff task — do NOT wire this module into ingest-deps.
 */

import type { InboundChannelMessage, ChannelKind, Intent, TurnGateResult } from '@nibbin/channels';

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface HandleInboundDeps {
  /** Classify the inbound into an approval / status / work intent. */
  classify: (inbound: InboundChannelMessage) => Intent;

  /**
   * Rate-gate guard. Returns { ok: true } when the turn is allowed, or
   * { ok: false, notice } carrying the breather copy to deliver back.
   */
  gate: (accountId: string, channel: ChannelKind) => Promise<TurnGateResult>;

  /**
   * Approve or reject a pending run via the verified channel path.
   * Returns the decision record on success, null if security checks failed.
   * Maps directly to decideViaChannel from apps/web/lib/runtime/decide.ts.
   */
  decide: (
    channel: string,
    externalId: string,
    runId: string,
    decision: 'approved' | 'rejected',
  ) => Promise<{ decision: string } | null>;

  /**
   * Run keeperChat + recordModelCall(origin:'chat', channel) for the given
   * account and channel, returning the keeper's reply text. Read-only — the
   * keeper has no tools, no hands (C10).
   *
   * NOTE: text is intentionally NOT a parameter here. The dep is constructed
   * with the quarantined text captured in its closure (ingest-deps.ts) so raw
   * inbound text can never reach the model — enforced structurally, not by
   * convention.
   */
  answer: (accountId: string, channel: ChannelKind) => Promise<{ reply: string }>;

  /**
   * Deliver a reply body back on the originating channel.
   * Maps to port.deliver({ kind: 'reply', ... }) for the matching ChannelKind.
   */
  reply: (channel: ChannelKind, externalId: string, body: string) => Promise<void>;

  /**
   * CHANNELS_INITIATED_WORK_ENABLED — false by default until the Planner is
   * wired and the work branch is fully built out (§7.3).
   */
  workEnabled: boolean;
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export async function handleInbound(
  verified: { accountId: string; inbound: InboundChannelMessage },
  deps: HandleInboundDeps,
): Promise<void> {
  const { accountId, inbound } = verified;
  const { channel, externalId } = inbound;

  const intent = deps.classify(inbound);

  // -------------------------------------------------------------------------
  // §7.1 Approval branch — user approved or rejected a pending run via channel
  // -------------------------------------------------------------------------
  if (intent.kind === 'approval') {
    const mapped: 'approved' | 'rejected' = intent.decision === 'approve' ? 'approved' : 'rejected';
    const result = await deps.decide(channel, externalId, intent.requestId, mapped);

    if (result !== null) {
      // What happened → what it means.
      const body =
        intent.decision === 'approve'
          ? 'Done — your grove is on it.'
          : 'Okay — held off.';
      await deps.reply(channel, externalId, body);
    } else {
      // Security checks failed or the run was already actioned — no partial state.
      await deps.reply(
        channel,
        externalId,
        "I couldn't action that — open the app to take a look.",
      );
    }
    return;
  }

  // -------------------------------------------------------------------------
  // §7.2 Status branch — read-only question / status enquiry
  // -------------------------------------------------------------------------
  if (intent.kind === 'status') {
    const g = await deps.gate(accountId, channel);
    if (!g.ok) {
      await deps.reply(channel, externalId, g.notice);
      return; // no model call when gate is closed
    }
    const { reply: text } = await deps.answer(accountId, channel);
    await deps.reply(channel, externalId, text);
    if (g.warn) await deps.reply(channel, externalId, g.warn.notice);
    return;
  }

  // -------------------------------------------------------------------------
  // §7.3 Work branch — initiated work (deferred until Planner is available)
  // -------------------------------------------------------------------------
  if (intent.kind === 'work') {
    const g = await deps.gate(accountId, channel);
    if (!g.ok) {
      await deps.reply(channel, externalId, g.notice);
      return; // no model call when gate is closed
    }

    // Plan 05 §7.3: when a Planner is injected AND deps.workEnabled, route here →
    // plan-preview → approval gate. Until then, degrade honestly:
    await deps.reply(
      channel,
      externalId,
      "I can't take that on just yet — but I can tell you what your grove's up to, or you can do it in the app.",
    );
    if (g.warn) await deps.reply(channel, externalId, g.warn.notice);
    return;
  }

  // defensive: unknown intent kind never silently drops
  await deps.reply(
    channel,
    externalId,
    "I didn't quite catch that — you can ask what your grove's up to, or do it in the app.",
  );
}
