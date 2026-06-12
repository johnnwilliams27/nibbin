import 'server-only';

/**
 * Shared authenticated-session helper for server actions: resolves the user
 * and their account (idempotent, advisory-locked bootstrap), returning the
 * RLS-scoped session client. Mirrors the grove actions' session shape.
 */
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { ensureAccount } from './bootstrap';
import { upsertOwnProfile } from './profile';
import { createClient } from '../supabase/server';

export interface AppSession {
  supabase: SupabaseClient;
  user: User;
  accountId: string;
}

export async function appSession(): Promise<AppSession> {
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
