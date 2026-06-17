import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { serviceClient } from '../supabase/service';

export interface PendingAuth {
  state: string;
  provider: string;
  accountId: string;
  userId: string;
  codeVerifier?: string;
  scopes: string[];
  returnTo: string | null;
  resumeTemplate: string | null;
  expiresAt: string;
  consumedAt: string | null;
}

export interface StorePendingInput {
  state: string; provider: string; accountId: string; userId: string; nonce: string;
  codeVerifier?: string; scopes: string[]; returnTo: string | null; resumeTemplate: string | null;
  expiresAtMs: number;
}

export async function storePending(
  input: StorePendingInput,
  svc: SupabaseClient = serviceClient(),
): Promise<void> {
  const { error } = await svc.from('oauth_pending_authorizations').insert({
    state: input.state,
    provider: input.provider,
    account_id: input.accountId,
    user_id: input.userId,
    nonce: input.nonce,
    code_verifier: input.codeVerifier ?? null,
    scopes: input.scopes,
    return_to: input.returnTo,
    resume_template: input.resumeTemplate,
    expires_at: new Date(input.expiresAtMs).toISOString(),
  });
  if (error) throw new Error(`pending store failed: ${error.message}`);
}

export async function consumePending(
  state: string,
  nowMs: number,
  svc: SupabaseClient = serviceClient(),
): Promise<PendingAuth | null> {
  const nowIso = new Date(nowMs).toISOString();
  const { data, error } = await svc
    .from('oauth_pending_authorizations')
    .update({ consumed_at: nowIso })
    .eq('state', state)
    .is('consumed_at', null)
    .gt('expires_at', nowIso)
    .select('*')
    .maybeSingle();
  if (error) throw new Error(`pending consume failed: ${error.message}`);
  if (!data) return null;
  return {
    state: data.state,
    provider: data.provider,
    accountId: data.account_id,
    userId: data.user_id,
    codeVerifier: data.code_verifier ?? undefined,
    scopes: data.scopes ?? [],
    returnTo: data.return_to ?? null,
    resumeTemplate: data.resume_template ?? null,
    expiresAt: data.expires_at,
    consumedAt: data.consumed_at ?? null,
  };
}
