/**
 * Conversation orchestrator — handleInbound (Plan 05 §7.1–7.3)
 *
 * Pure-ish orchestrator over injected deps so it is unit-testable without any
 * real Supabase / model clients. The four branches:
 *
 *   approval  — route the decision through decideViaChannel; never executes
 *               anything directly (C10: keeper has no hands; decide is the
 *               only authorised path).
 *   status    — gate, then call keeperChat (read-only; no tools). Budgeted.
 *   work      — session-first routing → propose / start / respond loop (§7.3).
 *               Degrades honestly when workEnabled=false or proposeWork absent.
 *
 * Real deps wiring (building gate/answer/reply/decide from live clients) is a
 * SEPARATE handoff task — do NOT wire this module into ingest-deps.
 */

import type { InboundChannelMessage, ChannelKind, ChannelAction, Intent, TurnGateResult } from '@nibbin/channels';
import type { ProposeResult } from '../planner/channel';
import type { PlanOutcome, PlanSpec } from '@nibbin/runtime';

// ---------------------------------------------------------------------------
// Session type
// ---------------------------------------------------------------------------

export interface WorkSession {
  accountId: string;
  channel: string;
  externalId: string;
  kind: 'proposed' | 'awaiting';
  plan?: PlanSpec;
  planRunId?: string;
  requestId?: string;
  requestKind?: 'approval' | 'auth' | 'decision' | 'value';
}

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
   * Deliver a reply with inline button actions (for plan propose/approve flows).
   * Task 4 wires this to port.deliver with the actions field populated.
   */
  replyWithActions?: (
    channel: ChannelKind,
    externalId: string,
    body: string,
    actions: ChannelAction[],
  ) => Promise<void>;

  /**
   * CHANNELS_INITIATED_WORK_ENABLED — false by default until the Planner is
   * wired and the work branch is fully built out (§7.3).
   */
  workEnabled: boolean;

  // ── Work session deps (§7.3 Task 3) ──────────────────────────────────────

  /**
   * The userId (linked_by from the verified binding) of the inbound sender.
   * Passed in the verified payload by ingest-deps; the Planner calls need it
   * explicitly since there is no appSession on the channel path.
   */
  userId?: string;

  /**
   * Per-(channel, externalId) work session store. One row per binding holds
   * the single in-flight conversational state (proposed plan or awaiting input).
   */
  session?: {
    get(channel: string, externalId: string): Promise<WorkSession | null>;
    set(s: WorkSession): Promise<void>;
    clear(channel: string, externalId: string): Promise<void>;
  };

  /**
   * Propose a plan for a free-text intent. Does NOT run the plan.
   * Delegates to proposePlanForChannel in apps/web/lib/planner/channel.ts.
   */
  proposeWork?: (accountId: string, userId: string, text: string) => Promise<ProposeResult>;

  /**
   * Start a plan run from a reviewed plan.
   * Delegates to startPlanRunForChannel in apps/web/lib/planner/channel.ts.
   */
  startWork?: (accountId: string, userId: string, plan: PlanSpec) => Promise<PlanOutcome | { error: string }>;

  /**
   * Resume a paused run with the human's response.
   * Delegates to respondToPlanRunForChannel in apps/web/lib/planner/channel.ts.
   */
  respondWork?: (
    accountId: string,
    userId: string,
    runId: string,
    response: { requestId: string; approval: 'approved' | 'rejected' } | { requestId: string; value: string },
  ) => Promise<PlanOutcome>;
}

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------

function preview(p: { goal: string; intendedSteps: string[]; surface: string[]; connectorsNeeded: string[] }): string {
  const steps = p.intendedSteps.map((s, i) => `${i + 1}. ${s}`).join('\n');
  const tools = p.surface.length > 0 ? `\nIt can use: ${p.surface.join(', ')}` : '';
  return `*${p.goal}*\n\n${steps}${tools}`;
}

function draftSummary(request: { kind: string; question: string; context: Record<string, unknown> }): string {
  const title = typeof request.context['title'] === 'string' ? request.context['title'] : request.question;
  return `*${title}*\n\n${request.question}`;
}

function resultSummary(artifact: unknown): string {
  if (!artifact || typeof artifact !== 'object') return 'Done.';
  const a = artifact as Record<string, unknown>;
  if (typeof a['summary'] === 'string' && a['summary']) return a['summary'];
  if (typeof a['text'] === 'string' && a['text']) return a['text'];
  if (typeof a['result'] === 'string' && a['result']) return a['result'];
  return 'Done.';
}

function killSummary(reason: string): string {
  if (reason === 'ceiling_exceeded') return "That ran into its budget ceiling — open the app to see what happened.";
  if (reason === 'user_cancelled') return "Okay — cancelled.";
  if (reason === 'max_iterations') return "That ran longer than expected — open the app to pick up where it left off.";
  if (reason === 'no_progress') return "The run stalled and was stopped — open the app to see what happened.";
  return "That stopped unexpectedly — open the app to see what happened.";
}

// ---------------------------------------------------------------------------
// applyOutcome — update session + reply based on PlanOutcome
// ---------------------------------------------------------------------------

async function applyOutcome(
  outcome: PlanOutcome,
  ctx: {
    accountId: string;
    channel: ChannelKind;
    externalId: string;
    deps: HandleInboundDeps;
  },
): Promise<void> {
  const { accountId, channel, externalId, deps } = ctx;
  const session = deps.session!;

  if (outcome.kind === 'needs_input') {
    const { runId, request } = outcome;
    if (request.kind === 'approval') {
      await session.set({
        accountId, channel, externalId,
        kind: 'awaiting', planRunId: runId, requestId: request.requestId, requestKind: 'approval',
      });
      // FIX 4: embed requestId in button ids so a stale tap carries its own requestId.
      const actions: ChannelAction[] = [
        { id: `pw:approve:${request.requestId}`, label: 'Approve', kind: 'approve' },
        { id: `pw:reject:${request.requestId}`, label: 'Reject', kind: 'deny' },
      ];
      if (deps.replyWithActions) {
        await deps.replyWithActions(channel, externalId, draftSummary(request), actions);
      } else {
        await deps.reply(channel, externalId, draftSummary(request));
      }
    } else {
      // auth | decision | value — ask as plain text
      await session.set({
        accountId, channel, externalId,
        kind: 'awaiting', planRunId: runId, requestId: request.requestId, requestKind: request.kind,
      });
      await deps.reply(channel, externalId, request.question);
    }
    return;
  }

  if (outcome.kind === 'done') {
    await session.clear(channel, externalId);
    await deps.reply(channel, externalId, resultSummary(outcome.artifact));
    return;
  }

  if (outcome.kind === 'failed') {
    await session.clear(channel, externalId);
    await deps.reply(channel, externalId, "That didn't work out — open the app to see what happened.");
    return;
  }

  if (outcome.kind === 'killed') {
    await session.clear(channel, externalId);
    await deps.reply(channel, externalId, killSummary(outcome.reason));
    return;
  }

  // FIX 5: defensive fallback — never leave a session orphaned on an unknown outcome kind.
  await session.clear(channel, externalId);
  await deps.reply(channel, externalId, "Something went sideways — open the app to take a look.");
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

const CANCEL_RE = /^\s*cancel\s*$/i;

export async function handleInbound(
  verified: { accountId: string; inbound: InboundChannelMessage },
  deps: HandleInboundDeps,
): Promise<void> {
  const { accountId, inbound } = verified;
  const { channel, externalId } = inbound;

  // ── Session-first routing (§7.3) ─────────────────────────────────────────
  // Load the session before classifying, so button callbacks can be handled
  // without going through the classifier at all.
  const session = deps.session ?? null;
  const activeSession = session ? await session.get(channel, externalId) : null;
  const userId = deps.userId;

  // (A) Plan-action button callbacks
  if (inbound.planAction) {
    const act = inbound.planAction;

    if (act === 'ps:go' && activeSession?.kind === 'proposed') {
      if (!activeSession.plan) {
        // FIX 3: proposed session with no plan — orphan; clear and error.
        await session!.clear(channel, externalId);
        await deps.reply(channel, externalId, "Something went wrong with that plan — try asking again.");
        return;
      }
      if (!userId) {
        await deps.reply(channel, externalId, "I couldn't action that — open the app to take a look.");
        return;
      }
      const startWork = deps.startWork;
      if (!startWork) {
        await deps.reply(channel, externalId, "Work isn't available yet — try again soon.");
        return;
      }
      const result = await startWork(accountId, userId, activeSession.plan);
      if ('error' in result) {
        await deps.reply(channel, externalId, result.error);
        return;
      }
      await applyOutcome(result, { accountId, channel, externalId, deps });
      return;
    }

    if (act === 'ps:cancel' && activeSession?.kind === 'proposed') {
      await session!.clear(channel, externalId);
      await deps.reply(channel, externalId, "Okay — dropped it.");
      return;
    }

    if (act === 'pw:approve' && activeSession?.kind === 'awaiting' && activeSession.requestKind === 'approval') {
      const respondWork = deps.respondWork;
      if (!respondWork || !activeSession.planRunId || !activeSession.requestId || !userId) {
        await deps.reply(channel, externalId, "I couldn't action that — open the app to take a look.");
        return;
      }
      // FIX 4: use planRequestId from button (stale-tap safety) or fall back to session's requestId.
      const outcome = await respondWork(accountId, userId, activeSession.planRunId, {
        requestId: inbound.planRequestId ?? activeSession.requestId,
        approval: 'approved',
      });
      await applyOutcome(outcome, { accountId, channel, externalId, deps });
      return;
    }

    if (act === 'pw:reject' && activeSession?.kind === 'awaiting' && activeSession.requestKind === 'approval') {
      const respondWork = deps.respondWork;
      if (!respondWork || !activeSession.planRunId || !activeSession.requestId || !userId) {
        await deps.reply(channel, externalId, "I couldn't action that — open the app to take a look.");
        return;
      }
      // FIX 4: use planRequestId from button (stale-tap safety) or fall back to session's requestId.
      const outcome = await respondWork(accountId, userId, activeSession.planRunId, {
        requestId: inbound.planRequestId ?? activeSession.requestId,
        approval: 'rejected',
      });
      await applyOutcome(outcome, { accountId, channel, externalId, deps });
      return;
    }
    // Unknown or unmatched plan action — fall through to normal routing below
  }

  // FIX 2: stray planAction with an active session — never fall through to free-text (B) branch.
  if (inbound.planAction && activeSession) {
    await deps.reply(channel, externalId, "Tap the buttons on the message above, or say 'cancel'.");
    return;
  }

  // (B) Free-text while a session is active
  if (activeSession) {
    // 'cancel' keyword always escapes
    if (CANCEL_RE.test(inbound.text)) {
      await session!.clear(channel, externalId);
      await deps.reply(channel, externalId, "Okay — dropped it.");
      return;
    }

    if (activeSession.kind === 'awaiting' && activeSession.requestKind && activeSession.requestKind !== 'approval') {
      // auth | decision | value — free text is the answer
      const respondWork = deps.respondWork;
      if (!respondWork || !activeSession.planRunId || !activeSession.requestId || !userId) {
        await deps.reply(channel, externalId, "I couldn't continue — open the app to take a look.");
        return;
      }
      const outcome = await respondWork(accountId, userId, activeSession.planRunId, {
        requestId: activeSession.requestId,
        value: inbound.text,
      });
      await applyOutcome(outcome, { accountId, channel, externalId, deps });
      return;
    }

    if (activeSession.kind === 'awaiting' && activeSession.requestKind === 'approval') {
      // Approval awaiting a button tap — nudge
      await deps.reply(channel, externalId, "Tap Approve or Reject on the message above (or say 'cancel').");
      return;
    }

    if (activeSession.kind === 'proposed') {
      // Proposed plan awaiting Start/Cancel tap
      await deps.reply(channel, externalId, "Tap Start to go ahead, or Cancel.");
      return;
    }
  }

  // ── (C) No active session — classify and route ────────────────────────────

  const intent = deps.classify(inbound);

  // -------------------------------------------------------------------------
  // §7.1 Approval branch — user approved or rejected a pending run via channel
  // -------------------------------------------------------------------------
  if (intent.kind === 'approval') {
    const mapped: 'approved' | 'rejected' = intent.decision === 'approve' ? 'approved' : 'rejected';
    const result = await deps.decide(channel, externalId, intent.requestId, mapped);

    if (result !== null) {
      const body =
        intent.decision === 'approve'
          ? 'Done — your grove is on it.'
          : 'Okay — held off.';
      await deps.reply(channel, externalId, body);
    } else {
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
      return;
    }
    const { reply: text } = await deps.answer(accountId, channel);
    await deps.reply(channel, externalId, text);
    if (g.warn) await deps.reply(channel, externalId, g.warn.notice);
    return;
  }

  // -------------------------------------------------------------------------
  // §7.3 Work branch — initiated work via the Planner
  // -------------------------------------------------------------------------
  if (intent.kind === 'work') {
    const g = await deps.gate(accountId, channel);
    if (!g.ok) {
      await deps.reply(channel, externalId, g.notice);
      return;
    }

    if (!deps.workEnabled || !deps.proposeWork || !session || !userId) {
      await deps.reply(
        channel,
        externalId,
        "I can't take that on just yet — but I can tell you what your grove's up to, or you can do it in the app.",
      );
      if (g.warn) await deps.reply(channel, externalId, g.warn.notice);
      return;
    }

    const res = await deps.proposeWork(accountId, userId, intent.text);
    if ('error' in res) {
      await deps.reply(channel, externalId, res.error);
      return;
    }

    await session.set({
      accountId, channel, externalId,
      kind: 'proposed', plan: res.plan,
    });

    const previewText = preview(res.preview);
    const proposeActions: ChannelAction[] = [
      { id: 'ps:go', label: 'Start', kind: 'approve' },
      { id: 'ps:cancel', label: 'Cancel', kind: 'deny' },
    ];
    if (deps.replyWithActions) {
      await deps.replyWithActions(channel, externalId, previewText, proposeActions);
    } else {
      await deps.reply(channel, externalId, previewText);
    }
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
