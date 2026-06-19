import 'server-only';

/**
 * Style/Taste Profile reader (SPEC §4A Slice 1).
 * Returns the account's style profile, or null if none exists yet.
 * Uses the service role — called from server-only pipeline + settings paths.
 */
import { serviceClient } from '../supabase/service';
import type { StyleProfile } from './schema';
import { DEFAULT_STATS } from './schema';

interface StyleProfileRow {
  account_id: string;
  tone_profile: StyleProfile['tone_profile'];
  field_study_cues: Record<string, unknown>;
  user_notes: string | null;
  stats: StyleProfile['stats'];
  version: number;
  created_at: string;
  updated_at: string;
}

export async function loadStyleProfile(accountId: string): Promise<StyleProfile | null> {
  try {
    const { data } = await serviceClient()
      .from('style_profiles')
      .select('account_id, tone_profile, field_study_cues, user_notes, stats, version, created_at, updated_at')
      .eq('account_id', accountId)
      .maybeSingle<StyleProfileRow>();
    if (!data) return null;
    return {
      account_id: data.account_id,
      tone_profile: data.tone_profile ?? null,
      field_study_cues: data.field_study_cues ?? {},
      user_notes: data.user_notes ?? null,
      stats: data.stats ?? DEFAULT_STATS,
      version: data.version ?? 0,
      created_at: data.created_at,
      updated_at: data.updated_at,
    };
  } catch (err) {
    console.error('[style] load failed (best-effort)', err instanceof Error ? err.message : err);
    return null;
  }
}
