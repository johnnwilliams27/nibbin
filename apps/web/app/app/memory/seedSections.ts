/**
 * Task 7 — Pure seed helper extracted from page.tsx for testability.
 *
 * Converts onboarding answer blobs into the initial sections map for a new
 * account's Grove Memory. Seeds the `about` key (NOT the legacy `facts` key).
 *
 * Guard-free / client-safe: no `server-only` import.
 */

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** One "Label: value" line from a string or string[]; null if there's nothing. */
function answerLine(label: string, v: unknown): string | null {
  if (typeof v === 'string' && v.trim() !== '') return `${label}: ${v.trim()}`;
  if (Array.isArray(v)) {
    const xs = v.filter((x): x is string => typeof x === 'string' && x.trim() !== '');
    if (xs.length) return `${label}: ${xs.join(', ')}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// seedSectionsFromAnswers — public export
// ---------------------------------------------------------------------------

/**
 * Seed the `about` section from the onboarding answers blob. Post-#73 that
 * blob also carries the model's `_understanding`/`_profile` OBJECTS, so we must
 * never blindly stringify it (that yields "[object Object]"). Prefer the model's
 * profile; fall back to the legacy interview scalars. Returns {} when empty.
 *
 * Seeds `about` (the neutral primary field), NOT the legacy `facts` key.
 * Any stored legacy `facts` values are handled by `forwardMapLegacy` in registry.ts.
 */
export function seedSectionsFromAnswers(answers: Record<string, unknown>): Record<string, string> {
  const lines: string[] = [];
  const profile = answers._profile;
  if (profile && typeof profile === 'object' && !Array.isArray(profile)) {
    const p = profile as Record<string, unknown>;
    for (const [label, key] of [
      ['What I do', 'jobTitle'],
      ['Business model', 'businessModel'],
      ['Main work', 'workShape'],
      ['Channels', 'channels'],
      ['Tools', 'tools'],
      ['Frustrations', 'pains'],
    ] as const) {
      if (key === 'businessModel' && p[key] === 'unknown') continue;
      const line = answerLine(label, p[key]);
      if (line) lines.push(line);
    }
  }
  if (lines.length === 0) {
    // legacy interview scalars only — never the `_`-prefixed state objects
    for (const [label, key] of [
      ['What I do', 'craft'],
      ['Time sinks', 'timeSinks'],
      ['Channels', 'channels'],
    ] as const) {
      const line = answerLine(label, answers[key]);
      if (line) lines.push(line);
    }
  }
  return lines.length ? { about: lines.join('\n') } : {};
}
