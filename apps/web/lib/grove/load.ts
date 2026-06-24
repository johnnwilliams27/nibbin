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
import { loadPendingItems } from './pending-items';
import type { KeeperExpression, KeeperMessage, OnboardingState, PendingQueue } from '@nibbin/keeper';

const EMPTY_QUEUE: PendingQueue = { proposals: [], runs: [], conflicts: [], total: 0, hasHighStakes: false };

export interface GroveLoad {
  state: OnboardingState;
  initialMessages: KeeperMessage[];
  expression: KeeperExpression;
  credits: number;
  /** True when a grove_state row already exists in the database. */
  rowExists: boolean;
  /**
   * Read-only snapshot of items waiting for the person's attention (P6).
   * Always present (empty queue when there is nothing pending).
   * Callers pass this into buildKeeperContext({ pendingItems }) so the model
   * can open with what's waiting. C10: read-only, no write path.
   */
  pendingItems: PendingQueue;
}

export async function loadGroveState(
  supabase: SupabaseClient,
  accountId: string,
  userId: string,
): Promise<GroveLoad> {
  const [{ data: row }, { data: me }, { data: balanceRow }, pendingItems] = await Promise.all([
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
    // P6: read-only pending queue. Fail-safe: errors return an empty queue and
    // never break the grove page load (C10 preserved — no write path).
    loadPendingItems(supabase, accountId).catch((err) => {
      console.error('[loadGroveState] loadPendingItems failed — empty queue', err instanceof Error ? err.message : err);
      return EMPTY_QUEUE;
    }),
  ]);

  const state = stateFromRow(row ?? null, me?.name ?? null);
  const turn = turnForState(state);

  return {
    state,
    initialMessages: [...turn.messages],
    expression: turn.expression,
    credits: balanceRow?.balance ?? 0,
    rowExists: row != null,
    pendingItems,
  };
}
