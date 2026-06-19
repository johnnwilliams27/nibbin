import 'server-only';

/**
 * Style/Taste Profile injector (SPEC §4A Slice 1).
 *
 * Loads the account's style profile and renders it as a concise "your voice"
 * system block for the drafter. Returns null when there is no profile yet or
 * confidence is too low. Best-effort — null on any failure.
 */
import { loadStyleProfile } from './load';

/** Minimum confidence required before injecting the profile. */
const MIN_CONFIDENCE = 0.1;

function formalityLabel(v: number): string {
  if (v < 0.25) return 'casual';
  if (v < 0.5) return 'somewhat casual';
  if (v < 0.75) return 'somewhat formal';
  return 'formal';
}

function sentimentLabel(v: number): string {
  if (v < -0.4) return 'direct and concise';
  if (v < 0.2) return 'neutral';
  return 'warm and approachable';
}

function paceLabel(v: number): string {
  if (v < 0.35) return 'brief and terse';
  if (v < 0.65) return 'moderate length';
  return 'detailed and thorough';
}

/**
 * Build a short "your voice" system block from the account's style profile.
 * Returns null when there is nothing meaningful to inject.
 */
export async function loadStyleProfileBlock(accountId: string): Promise<string | null> {
  try {
    const profile = await loadStyleProfile(accountId);
    if (!profile) return null;
    const { tone_profile: tone, user_notes, stats } = profile;
    if ((stats.confidence ?? 0) < MIN_CONFIDENCE && !user_notes) return null;

    const lines: string[] = ['What we know about your voice — match this in every draft:'];

    if (tone) {
      if (tone.formality !== null) lines.push(`- Tone: ${formalityLabel(tone.formality)}`);
      if (tone.sentiment !== null) lines.push(`- Register: ${sentimentLabel(tone.sentiment)}`);
      if (tone.pace !== null) lines.push(`- Length: ${paceLabel(tone.pace)}`);
      if (tone.signature_sign_offs.length > 0) {
        lines.push(`- Sign-offs you use: ${tone.signature_sign_offs.join(', ')}`);
      }
      if (tone.removals.length > 0) {
        lines.push(`- Things to avoid: ${tone.removals.join(', ')}`);
      }
    }

    if (user_notes?.trim()) {
      lines.push(`- Your note: ${user_notes.trim()}`);
    }

    if (lines.length === 1) return null; // header only, nothing to say
    return lines.join('\n');
  } catch (err) {
    console.error('[style] loadStyleProfileBlock failed (best-effort)', err instanceof Error ? err.message : err);
    return null;
  }
}
