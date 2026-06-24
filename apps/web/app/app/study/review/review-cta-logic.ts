/**
 * Pure async logic for the "Done — save what I kept" CTA (P3 Task 7).
 *
 * Extracted from the React component so it is unit-testable without jsdom.
 * The click handler on the page calls this with the live bridge + router.push.
 *
 * Sequencing (consent gate — derives only from kept events):
 *   1. Call finalizeReview() — Rust: flush deletions → mark COMPLETE → derive
 *      ObservationSummary over surviving events → upload to /api/brain/propose-from-capture.
 *   2. Navigate: proposals_requested=true → /app/memory?from_study=1 (banner);
 *                proposals_requested=false → /app/memory (no banner).
 *   3. On any error → navigate to /app/memory without a banner (silent, per §8.1).
 *
 * C1/C7: derivation and upload happen inside the Tauri process; the web surface
 * only receives the boolean result — it never sees raw event content.
 */

import type { FinalizeResult } from '../../../../lib/desktop/bridge';

/** Called by the "Done — save what I kept" button. Never throws. */
export async function handleDone(
  finalizeReview: () => Promise<FinalizeResult>,
  push: (url: string) => void,
): Promise<void> {
  try {
    const result = await finalizeReview();
    push(result.proposals_requested ? '/app/memory?from_study=1' : '/app/memory');
  } catch {
    // Bridge absent (web-only dev) or Rust command not yet registered (Task 5
    // deferred) → navigate normally without a banner. Study is already in a
    // clean state; no user-facing error is surfaced per the confirmed decision.
    push('/app/memory');
  }
}
