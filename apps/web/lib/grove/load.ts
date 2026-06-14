/**
 * loadGroveState — shared server-side loader for the grove_state row.
 *
 * Reads the three data sources that both grove/page.tsx and app/page.tsx
 * need: the grove_state row, the user's display name, and the credit balance.
 * Returns the computed OnboardingState, the initial message list for the chat
 * engine, the initial KeeperExpression, and the credit count.
 *
 * All reads run under the caller's RLS session — no privilege elevation.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { turnForState } from '@nibbin/keeper';
import { stateFromRow, type GroveRow } from './state';
import type { KeeperExpression, KeeperMessage, OnboardingState } from '@nibbin/keeper';

export interface GroveLoad {
  state: OnboardingState;
  initialMessages: KeeperMessage[];
  expression: KeeperExpression;
  credits: number;
  /** True when a grove_state row already exists in the database. */
  rowExists: boolean;
}

export async function loadGroveState(
  supabase: SupabaseClient,
  accountId: string,
  userId: string,
): Promise<GroveLoad> {
  const [{ data: row }, { data: me }, { data: balanceRow }] = await Promise.all([
    supabase
      .from('grove_state')
      .select('keeper_name, onboarding_step, answers')
      .eq('account_id', accountId)
      .maybeSingle<GroveRow>(),
    supabase.from('users').select('name').eq('id', userId).maybeSingle<{ name: string | null }>(),
    supabase
      .from('credit_balances')
      .select('balance')
      .eq('account_id', accountId)
      .maybeSingle<{ balance: number }>(),
  ]);

  const state = stateFromRow(row ?? null, me?.name ?? null);
  const turn = turnForState(state);

  return {
    state,
    initialMessages: [...turn.messages],
    expression: turn.expression,
    credits: balanceRow?.balance ?? 0,
    rowExists: row != null,
  };
}
