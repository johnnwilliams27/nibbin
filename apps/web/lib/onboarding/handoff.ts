import 'server-only';

/**
 * Writes the desktop handoff row (spec Component 2) via the membership-checked
 * save_onboarding_handoff RPC, under the caller's own RLS session.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { UnderstandingProfile } from '@nibbin/keeper';
import { deriveRecommendations } from './recommendations';

export async function writeHandoff(
  supabase: SupabaseClient,
  accountId: string,
  profile: UnderstandingProfile,
): Promise<void> {
  const rec = deriveRecommendations(profile);
  const { error } = await supabase.rpc('save_onboarding_handoff', {
    target_account: accountId,
    new_profile: profile,
    new_recommendations: { connections: rec.connections, nibbins: rec.nibbins },
    new_source: rec.source,
  });
  if (error) throw new Error('could not save your setup — try again in a moment');
}
