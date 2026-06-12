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
  buildKeeperContext,
  KEEPER_SYSTEM_PROMPT,
  keeperChat,
  type KeeperExpression,
  type KeeperMessage,
  type OnboardingStep,
} from '@nibbin/keeper';
import type { TokenUsage } from '@nibbin/router';
import { ensureAccount } from '../../../lib/auth/bootstrap';
import { upsertOwnProfile } from '../../../lib/auth/profile';
import { groveRouter } from '../../../lib/grove/router';
import { anthropicGenerate, recordModelCall } from '../../../lib/llm/client';
import { sanitizeInput, stateFromRow, type GroveRow } from '../../../lib/grove/state';
import { createClient } from '../../../lib/supabase/server';

export interface GroveTurnPayload {
  messages: KeeperMessage[];
  expression: KeeperExpression;
  step: OnboardingStep;
  keeperName: string | null;
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
    JSON.stringify(turn.state.answers) !== JSON.stringify(state.answers);

  if (progressed) {
    const { error } = await supabase.rpc('save_grove_state', {
      target_account: accountId,
      new_step: turn.state.step,
      new_keeper_name: turn.state.keeperName,
      new_answers: turn.state.answers,
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

  const [{ data: row }, { data: me }] = await Promise.all([
    supabase
      .from('grove_state')
      .select('keeper_name')
      .eq('account_id', accountId)
      .maybeSingle<{ keeper_name: string | null }>(),
    supabase.from('users').select('tz').eq('id', user.id).maybeSingle<{ tz: string | null }>(),
  ]);

  // M6.5: the real generate path. Without an API key this is null, keeperChat
  // gets no generate dep, and the scripted floor answers with zero routing
  // and zero debits (#25). With one, the stable persona block caches (§6.3
  // prefix discipline) and only the small context suffix is paid per turn.
  const llm = anthropicGenerate();
  let lastCall: { model: string; usage: TokenUsage } | null = null;
  const generate = llm
    ? async (model: string, userText: string) => {
        try {
          const result = await llm({
            model,
            system: [
              { text: KEEPER_SYSTEM_PROMPT, cache: true },
              { text: buildKeeperContext({ keeperName: row?.keeper_name }) },
            ],
            messages: [{ role: 'user', content: userText }],
            maxTokens: 400,
            temperature: 0.7,
          });
          lastCall = { model: result.model, usage: result.usage };
          return result.text;
        } catch (err) {
          // keeperChat falls back to the scripted floor and reports it
          // honestly; the turn never fails on a provider outage.
          console.error('[keeper] model call failed — scripted floor', err instanceof Error ? err.message : err);
          return null;
        }
      }
    : undefined;

  const reply = await keeperChat(
    text,
    { userId: user.id, keeperName: row?.keeper_name ?? null, timezone: me?.tz ?? undefined },
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
