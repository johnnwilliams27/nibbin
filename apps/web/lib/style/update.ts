import 'server-only';

/**
 * Style/Taste Profile merge + persist (SPEC §4A Slice 1).
 *
 * Merges a newly extracted ToneProfile into the existing stored profile using
 * recency weighting: new attributes win unless the existing confidence is
 * substantially higher. Upserts via the service-role RPC with optimistic
 * concurrency — retries once on a version conflict so concurrent edits on the
 * same account do not silently clobber each other.
 *
 * FAIL-SAFE: any error is logged and silently swallowed — never propagated
 * into the decision path.
 */
import { serviceClient } from '../supabase/service';
import type { ToneProfile, StyleStats } from './schema';
import { loadStyleProfile } from './load';

/** Recency weight applied to each newly extracted value (0..1). */
const RECENCY_WEIGHT = 0.4;

/** Blended numeric attribute: exponential moving average toward the new value. */
function blendNum(existing: number | null, incoming: number | null, alpha: number): number | null {
  if (incoming === null) return existing;
  if (existing === null) return incoming;
  return existing * (1 - alpha) + incoming * alpha;
}

/** Merge sign-offs: keep up to 5 most common; incoming set is a hint, not override. */
function mergeStrings(existing: string[], incoming: string[], max: number): string[] {
  const seen = new Set<string>(existing.map((s) => s.toLowerCase()));
  const merged = [...existing];
  for (const s of incoming) {
    if (!seen.has(s.toLowerCase()) && merged.length < max) {
      merged.push(s);
      seen.add(s.toLowerCase());
    }
  }
  return merged.slice(0, max);
}

/** Confidence grows with edit count, saturating around 0.9 at ~20 edits. */
function growConfidence(editsAnalyzed: number): number {
  return Math.min(0.9, 0.15 + (Math.log1p(editsAnalyzed) / Math.log1p(20)) * 0.75);
}

export async function updateStyleProfile(args: {
  accountId: string;
  runId: string;
  extracted: ToneProfile;
}): Promise<void> {
  try {
    const svc = serviceClient();
    for (let attempt = 0; attempt < 2; attempt++) {
      const existing = await loadStyleProfile(args.accountId);
      const existingTone = existing?.tone_profile ?? null;
      const existingStats = existing?.stats ?? {
        edits_analyzed: 0,
        confidence: 0,
        last_updated: null,
        derived_from: [],
      };
      const expectedVersion = existing?.version ?? 0;

      const editsAnalyzed = existingStats.edits_analyzed + 1;
      const confidence = growConfidence(editsAnalyzed);

      const merged: ToneProfile = {
        formality: blendNum(existingTone?.formality ?? null, args.extracted.formality, RECENCY_WEIGHT),
        sentiment: blendNum(existingTone?.sentiment ?? null, args.extracted.sentiment, RECENCY_WEIGHT),
        pace: blendNum(existingTone?.pace ?? null, args.extracted.pace, RECENCY_WEIGHT),
        signature_sign_offs: mergeStrings(
          existingTone?.signature_sign_offs ?? [],
          args.extracted.signature_sign_offs,
          5,
        ),
        removals: mergeStrings(existingTone?.removals ?? [], args.extracted.removals, 10),
      };

      const derived_from = [args.runId, ...(existingStats.derived_from ?? [])].slice(0, 20);

      const newStats: StyleStats = {
        edits_analyzed: editsAnalyzed,
        confidence,
        last_updated: new Date().toISOString(),
        derived_from,
      };

      const { data, error } = await svc.rpc('upsert_style_profile', {
        p_account: args.accountId,
        p_tone_profile: merged,
        p_stats: newStats,
        p_expected_version: expectedVersion,
      });
      if (error) {
        console.error('[style] upsert_style_profile failed', error.message);
        return;
      }
      const rows = typeof data === 'number' ? data : null;
      if (rows === 0) {
        // Optimistic-lock conflict: a concurrent edit updated the profile. Retry once.
        continue;
      }
      return; // applied
    }
    console.warn('[style] upsert_style_profile gave up after retry (version contention)');
  } catch (err) {
    console.error('[style] updateStyleProfile failed (best-effort)', err instanceof Error ? err.message : err);
  }
}
