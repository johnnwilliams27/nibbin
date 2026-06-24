/**
 * Style/Taste Profile types (SPEC §4A Slice 1).
 *
 * tone_profile captures ABSTRACTED voice attributes derived from edit signals.
 * NEVER raw draft or edit sentences — only pattern descriptors.
 */

export interface ToneProfile {
  /** 0 = very casual, 1 = very formal. null = not yet determined. */
  formality: number | null;
  /** -1 = blunt/direct, 0 = neutral, 1 = warm. null = not yet determined. */
  sentiment: number | null;
  /** 0 = terse, 1 = verbose. null = not yet determined. */
  pace: number | null;
  /** Recurring sign-off patterns the user keeps (max 5). e.g. "Thanks," */
  signature_sign_offs: string[];
  /** Words or phrasings the user consistently removes (max 10). */
  removals: string[];
}

export interface StyleStats {
  edits_analyzed: number;
  /** 0..1 — grows as more edits are analysed. */
  confidence: number;
  /** ISO timestamp of last extraction, or null if no extraction yet. */
  last_updated: string | null;
  /** Run ids that seeded the latest extraction round (bounded list). */
  derived_from: string[];
}

export interface StyleProfile {
  account_id: string;
  tone_profile: ToneProfile | null;
  field_study_cues: Record<string, unknown>;
  user_notes: string | null;
  stats: StyleStats;
  version: number;
  created_at: string;
  updated_at: string;
}

export const DEFAULT_STATS: StyleStats = {
  edits_analyzed: 0,
  confidence: 0,
  last_updated: null,
  derived_from: [],
};
