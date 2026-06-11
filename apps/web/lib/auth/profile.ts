/**
 * Idempotent self-insert of the user's public.users profile row. RLS allows
 * exactly the caller's own row (users_self_insert); `ignoreDuplicates` makes
 * replays a no-op so this is safe on every sign-in and page load.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export async function upsertOwnProfile(
  supabase: SupabaseClient,
  user: { id: string; email?: string | null },
): Promise<void> {
  if (!user.email) throw new Error('profile upsert requires an email');
  const { error } = await supabase
    .from('users')
    .upsert({ id: user.id, email: user.email }, { onConflict: 'id', ignoreDuplicates: true });
  if (error) throw error;
}
