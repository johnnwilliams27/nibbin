'use server';

/**
 * Grove chat server actions. The server is authoritative: state loads from
 * grove_state under the caller's own RLS session, the keeper state machine
 * runs here, and persistence goes through the membership-checked
 * save_grove_state RPC. The client only ever sends raw input.
 *
 * C10: nothing in this file (or anything it calls) gives the Grovekeeper a
 * side-effect tool. The only writes are the user's own onboarding state and
 * their own users.name row.
 */
import {
  advanceOnboarding,
  applyUnderstandingTurn,
  buildKeeperContext,
  KEEPER_SYSTEM_PROMPT,
  keeperChat,
  skipUnderstanding,
  type KeeperExpression,
  type KeeperMessage,
  type OnboardingStep,
  type UnderstandingProfile,
} from '@nibbin/keeper';
import { understandingModelTurn } from '../../../lib/llm/understanding';
import { writeHandoff } from '../../../lib/onboarding/handoff';
import type { TokenUsage } from '@nibbin/router';
import { CHAT_DAILY_CEILING, type Tier } from '@nibbin/shared';
import { ensureAccount } from '../../../lib/auth/bootstrap';
import { upsertOwnProfile } from '../../../lib/auth/profile';
import { groveRouter } from '../../../lib/grove/router';
import { anthropicGenerate, recordModelCall } from '../../../lib/llm/client';
import { answersForSave, sanitizeInput, stateFromRow, type GroveRow } from '../../../lib/grove/state';
import { loadPendingItems } from '../../../lib/grove/pending-items';
import { createClient } from '../../../lib/supabase/server';
import { serviceClient } from '../../../lib/supabase/service';
import { DONE, NEXT_STEP } from '@nibbin/keeper';

export interface GroveTurnPayload {
  messages: KeeperMessage[];
  expression: KeeperExpression;
  step: OnboardingStep;
  keeperName: string | null;
  profile?: UnderstandingProfile | null;
}

async function groveSession() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('not signed in');
  const accountId = await ensureAccount({
    getEmail: async () => user.email ?? null,
    ensureProfile: () => upsertOwnProfile(supabase, user),
    bootstrap: async (name) => {
      const { data, error } = await supabase.rpc('bootstrap_account', { account_name: name });
      if (error) throw error;
      return data as string;
    },
  });
  return { supabase, user, accountId };
}

/**
 * Emit the two onboarding-done notification leaves via the service client.
 * The RPC is idempotent (ON CONFLICT (account_id, kind, source_id) DO NOTHING),
 * so calling this more than once per account is safe. Best-effort: callers
 * should fire-and-forget with `void` and never await in a critical path.
 */
async function emitOnboardingLeaves(accountId: string): Promise<void> {
  try {
    const svc = serviceClient();
    await Promise.all([
      svc.rpc('insert_system_notification', {
        p_account: accountId,
        p_kind: 'nudge',
        p_source_id: `onboarding_done:${accountId}`,
        p_title: DONE.title,
        p_body: DONE.detail,
        p_payload: { ctaPath: '/app/connections', ctaLabel: 'Connect an account' },
      }),
      svc.rpc('insert_system_notification', {
        p_account: accountId,
        p_kind: 'nudge',
        p_source_id: `field_study_nudge:${accountId}`,
        p_title: NEXT_STEP.fieldStudy.title,
        p_body: NEXT_STEP.fieldStudy.detail,
        p_payload: { ctaPath: '/app', ctaLabel: NEXT_STEP.fieldStudy.cta },
      }),
    ]);
  } catch {
    // best-effort; never disrupt the onboarding save path
  }
}

export async function advanceGroveAction(rawInput: unknown): Promise<GroveTurnPayload> {
  const { supabase, user, accountId } = await groveSession();
  const input = sanitizeInput(rawInput);

  const [{ data: row }, { data: me }] = await Promise.all([
    supabase
      .from('grove_state')
      .select('keeper_name, onboarding_step, answers')
      .eq('account_id', accountId)
      .maybeSingle<GroveRow>(),
    supabase.from('users').select('name').eq('id', user.id).maybeSingle<{ name: string | null }>(),
  ]);

  const state = stateFromRow(row, me?.name ?? null);
  const turn = advanceOnboarding(state, input);

  const progressed =
    turn.state.step !== state.step ||
    turn.state.keeperName !== state.keeperName ||
    JSON.stringify(turn.state.understanding) !== JSON.stringify(state.understanding) ||
    JSON.stringify(turn.state.answers) !== JSON.stringify(state.answers);

  if (progressed) {
    const { error } = await supabase.rpc('save_grove_state', {
      target_account: accountId,
      new_step: turn.state.step,
      new_keeper_name: turn.state.keeperName,
      new_answers: answersForSave({
        answers: turn.state.answers,
        understanding: turn.state.understanding,
        profile: turn.state.profile,
      }),
    });
    if (error) throw new Error('could not save your grove — try again in a moment');
  }

  // The user's name lives on their own users row (self-update under RLS).
  // Surface a failure the same way save_grove_state does — a silently
  // swallowed error would let the displayed name diverge from storage.
  if (turn.state.userName && turn.state.userName !== state.userName) {
    const { error } = await supabase.from('users').update({ name: turn.state.userName }).eq('id', user.id);
    if (error) throw new Error('could not save your name — try again in a moment');
  }

  return {
    messages: turn.messages,
    expression: turn.expression,
    step: turn.state.step,
    keeperName: turn.state.keeperName,
  };
}

export interface GroveChatPayload {
  message: KeeperMessage;
  expression: KeeperExpression;
  // Structured routing signal (§6.3) for the surface + M8 COGS dashboards.
  // The user-facing degradation copy is already inside message.text; this is
  // the machine-readable mirror so telemetry survives once a model authors
  // the prose. Tier/signals only — never the model id (server-internal).
  routing: { tier: string; degraded: boolean; complexity?: number };
}

export async function keeperChatAction(rawText: unknown): Promise<GroveChatPayload> {
  const { supabase, user, accountId } = await groveSession();
  const text = typeof rawText === 'string' ? rawText : '';

  // No tz fetch: the budget day is UTC-pinned in the router (#24/#52). We do
  // read the plan to size the daily chat ceiling (#230) — a runaway backstop
  // scaled by plan so paying users get more headroom. No subscription row =
  // free tier (the tightest ceiling), matching the adopt-RPC convention.
  //
  // P6: loadPendingItems runs in the same Promise.all batch for a single round-
  // trip. It is read-only (C10) and fail-safe: a DB error returns an empty queue
  // rather than breaking the chat turn.
  const [{ data: row }, { data: sub }, pendingItems] = await Promise.all([
    supabase
      .from('grove_state')
      .select('keeper_name')
      .eq('account_id', accountId)
      .maybeSingle<{ keeper_name: string | null }>(),
    supabase
      .from('subscriptions')
      .select('tier')
      .eq('account_id', accountId)
      .maybeSingle<{ tier: Tier | null }>(),
    loadPendingItems(supabase, accountId).catch((err) => {
      // Fail-safe: a pending-items read error must not break the chat reply.
      console.error('[keeper] loadPendingItems failed — proceeding without pending context', err instanceof Error ? err.message : err);
      return { proposals: [], runs: [], total: 0, hasHighStakes: false };
    }),
  ]);
  const dailyChatCeiling = CHAT_DAILY_CEILING[(sub?.tier ?? 'hatchling') as Tier];

  // M6.5: the real generate path. Without an API key this is null, keeperChat
  // gets no generate dep, and the scripted floor answers with zero routing
  // and zero debits (#25). With one, the stable persona block caches (§6.3
  // prefix discipline) and only the small context suffix is paid per turn.
  const llm = anthropicGenerate();
  let lastCall: { model: string; usage: TokenUsage } | null = null;
  // Slice A signals captured in the closure: the latency of the dispatched call,
  // and the model attempted when it failed gracefully (so the failure is ledgered).
  let lastLatencyMs: number | null = null;
  let failedCall: { model: string } | null = null;
  const generate = llm
    ? async (model: string, userText: string) => {
        const t0 = Date.now();
        try {
          const result = await llm({
            model,
            system: [
              { text: KEEPER_SYSTEM_PROMPT, cache: true },
              { text: buildKeeperContext({ keeperName: row?.keeper_name, pendingItems }) },
            ],
            messages: [{ role: 'user', content: userText }],
            maxTokens: 400,
            temperature: 0.7,
          });
          lastCall = { model: result.model, usage: result.usage };
          lastLatencyMs = Date.now() - t0;
          return result.text;
        } catch (err) {
          // keeperChat falls back to the scripted floor and reports it
          // honestly; the turn never fails on a provider outage.
          console.error('[keeper] model call failed — scripted floor', err instanceof Error ? err.message : err);
          failedCall = { model };
          return null;
        }
      }
    : undefined;

  const reply = await keeperChat(
    text,
    { userId: user.id, keeperName: row?.keeper_name ?? null, dailyChatCeiling },
    { route: (r) => groveRouter.route(r), ...(generate ? { generate } : {}) },
  );

  if (lastCall !== null && reply.dispatchedTier !== null) {
    const call = lastCall as { model: string; usage: TokenUsage };
    // Key COGS on the tier the model was actually dispatched at, never
    // reply.decision.tier — an empty completion rewrites decision to the
    // scripted floor (t0) while the real T1/T2 call was still billed (gate
    // finding logic-skeptic P2).
    await recordModelCall({
      accountId,
      userId: user.id,
      tier: reply.dispatchedTier,
      task: 'chat',
      model: call.model,
      usage: call.usage,
      origin: 'chat',
      degraded: reply.decision.degraded,
      latencyMs: lastLatencyMs,
      outcome: 'ok',
    });
  } else if (failedCall !== null) {
    // The dispatched chat call failed gracefully (scripted floor served) —
    // ledger the previously-invisible failure (Slice A): zero tokens, no content,
    // keyed on the tier the router dispatched at.
    const fc = failedCall as { model: string };
    await recordModelCall({
      accountId,
      userId: user.id,
      tier: reply.dispatchedTier ?? reply.decision.tier,
      task: 'chat',
      model: fc.model,
      usage: { inputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 0 },
      origin: 'chat',
      outcome: 'error',
      // dispatchedDegraded, NOT decision.degraded — chat.ts resets decision to
      // the scripted floor (degraded:false) on a failed call, so reading
      // decision.degraded would mis-record a degraded-then-failed turn as not
      // degraded (gate finding P3).
      degraded: reply.dispatchedDegraded,
      latencyMs: null,
    });
  }

  return {
    message: reply.message,
    expression: reply.expression,
    routing: {
      tier: reply.decision.tier,
      degraded: reply.decision.degraded,
      complexity: reply.decision.classification?.score,
    },
  };
}

export async function understandStepAction(rawText: unknown): Promise<GroveTurnPayload> {
  const { supabase, user, accountId } = await groveSession();
  const text = typeof rawText === 'string' ? rawText.slice(0, 2000) : '';

  const [{ data: row }, { data: me }] = await Promise.all([
    supabase
      .from('grove_state')
      .select('keeper_name, onboarding_step, answers')
      .eq('account_id', accountId)
      .maybeSingle<GroveRow>(),
    supabase.from('users').select('name').eq('id', user.id).maybeSingle<{ name: string | null }>(),
  ]);
  const state = stateFromRow(row, me?.name ?? null);
  if (state.step !== 'understand' || !state.understanding) {
    // Not in the understanding phase — nothing to do (defensive).
    return { messages: [], expression: 'idle', step: state.step, keeperName: state.keeperName };
  }

  // One model call for this turn; null → the pure engine serves the static fallback.
  // Build the up-to-date transcript (current answer included) so the model sees the latest reply.
  const transcript = [...state.understanding.turns, { q: state.understanding.currentQuestion.prompt, a: text }];
  const modelTurn = await understandingModelTurn(accountId, user.id, transcript, {});
  const turn = applyUnderstandingTurn(state, text, modelTurn);

  // On completion, derive + persist the desktop handoff before saving state.
  if (turn.state.step === 'done' && turn.state.profile) {
    await writeHandoff(supabase, accountId, turn.state.profile);
    // Emit the two onboarding-done leaves to the notification centre.
    // Best-effort: never block the state save on a leaf failure.
    void emitOnboardingLeaves(accountId);
  }

  const { error } = await supabase.rpc('save_grove_state', {
    target_account: accountId,
    new_step: turn.state.step,
    new_keeper_name: turn.state.keeperName,
    new_answers: answersForSave({
      answers: turn.state.answers,
      understanding: turn.state.understanding,
      profile: turn.state.profile,
    }),
  });
  if (error) throw new Error('could not save your grove — try again in a moment');

  return { messages: turn.messages, expression: turn.expression, step: turn.state.step, keeperName: turn.state.keeperName, profile: turn.state.profile };
}

export async function skipUnderstandingAction(): Promise<GroveTurnPayload> {
  const { supabase, user, accountId } = await groveSession();
  const { data: row } = await supabase
    .from('grove_state')
    .select('keeper_name, onboarding_step, answers')
    .eq('account_id', accountId)
    .maybeSingle<GroveRow>();
  const { data: me } = await supabase
    .from('users')
    .select('name')
    .eq('id', user.id)
    .maybeSingle<{ name: string | null }>();
  const state = stateFromRow(row, me?.name ?? null);
  const turn = skipUnderstanding(state);
  if (turn.state.step !== 'done') {
    return { messages: [], expression: 'idle', step: state.step, keeperName: state.keeperName };
  }
  if (turn.state.profile) {
    await writeHandoff(supabase, accountId, turn.state.profile);
  }
  // Emit the two onboarding-done leaves to the notification centre.
  // Best-effort: never block the state save on a leaf failure.
  void emitOnboardingLeaves(accountId);
  const { error } = await supabase.rpc('save_grove_state', {
    target_account: accountId,
    new_step: turn.state.step,
    new_keeper_name: turn.state.keeperName,
    new_answers: answersForSave({
      answers: turn.state.answers,
      understanding: turn.state.understanding,
      profile: turn.state.profile,
    }),
  });
  if (error) throw new Error('could not save your grove — try again in a moment');
  return { messages: turn.messages, expression: turn.expression, step: turn.state.step, keeperName: turn.state.keeperName, profile: turn.state.profile };
}
