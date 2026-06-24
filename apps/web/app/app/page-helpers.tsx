/**
 * Grove Home — pure helpers extracted for unit testability (Task 7g/7h).
 *
 * These are RSC-safe (no hooks, no client-only APIs). The file is .tsx so
 * the JSX in renderProposalCards compiles cleanly under the project's
 * automatic JSX transform.
 *
 * Consumed by:
 *   apps/web/app/app/page.tsx          — production
 *   apps/web/app/app/page.test.ts      — vitest unit tests (7g + 7h)
 */

import React from 'react';
import home from './home.module.css';

// Minimal type alias for a Next.js server action that accepts FormData.
// Using a loose function signature so tests can pass a simple no-op without
// importing next/dist internals.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FormAction = (formData: FormData) => any;

// ── Types ─────────────────────────────────────────────────────────────────────

/** A pending memory proposal row fetched for the inline-approve card UX. */
export interface PendingProposalRow {
  id: string;
  field_key: string;
  rationale: string | null;
  /** Only 'normal' and 'high' are stored; the check constraint ensures this. */
  stakes: string;
}

// ── computeNeedsYouTotal ─────────────────────────────────────────────────────

/**
 * §10.3 — The single computation point for the "NEEDS YOUR EYES" total.
 *
 * waitingCount  = COUNT of runs.status='awaiting_approval'  (from notifications table read via runs query)
 * reviewItemCount = COUNT of notifications.kind='review_item' AND read_at IS NULL
 *
 * Both counts come from Supabase `count: 'exact', head: true` queries on the
 * same /app page load. Neither comes from proposals.status='pending' directly
 * (which would double-count — each proposal already emits a review_item
 * notification). The dock badge and bell both derive from the notifications
 * table independently, keeping §10.3 intact.
 */
export function computeNeedsYouTotal(
  waitingCount: number | null,
  reviewItemCount: number | null,
): number {
  return (waitingCount ?? 0) + (reviewItemCount ?? 0);
}

// ── renderProposalCards ───────────────────────────────────────────────────────

/**
 * Renders the inline Approve/Reject card section for pending memory proposals.
 *
 * Returns null when the proposals array is empty — the caller can conditionally
 * mount this below the existing draftStack without CSS complexity.
 *
 * Each card:
 *   - Displays the field_key and (truncated) rationale.
 *   - Shows a "High stakes" pill badge when stakes === 'high'.
 *   - Has two <form action={decideProposalAction}> elements — one for
 *     'approved', one for 'rejected' — matching the decideRunAction pattern.
 *
 * The `decideAction` parameter accepts the server action so the helper remains
 * testable without importing a server-only module (the test passes a no-op).
 */
export function renderProposalCards(
  proposals: PendingProposalRow[],
  // In production page.tsx passes decideProposalAction here.
  // In tests, this is omitted (action attribute is checked by value in markup).
  decideAction?: FormAction,
): React.ReactElement | null {
  if (proposals.length === 0) return null;

  return (
    <div className={home.proposalStack}>
      <div className={home.proposalSectionHead}>Memory proposals</div>
      {proposals.map((p) => {
        const displayRationale =
          p.rationale && p.rationale.length > 80
            ? p.rationale.slice(0, 79) + '…'
            : (p.rationale ?? '');

        return (
          <div className={home.proposalCard} key={p.id}>
            <div className={home.proposalField}>{p.field_key}</div>
            {displayRationale && (
              <div className={home.proposalRationale}>{displayRationale}</div>
            )}
            {p.stakes === 'high' && (
              <span className={home.proposalHighStakes}>High stakes</span>
            )}
            <div className={home.qbtns}>
              <form action={decideAction} className={home.qbtnForm}>
                <input type="hidden" name="proposalId" value={p.id} />
                <input type="hidden" name="decision" value="approved" />
                <button className={`${home.qbtn} ${home.qbtnOk}`} type="submit">
                  Approve
                </button>
              </form>
              <form action={decideAction} className={home.qbtnForm}>
                <input type="hidden" name="proposalId" value={p.id} />
                <input type="hidden" name="decision" value="rejected" />
                <button className={`${home.qbtn} ${home.qbtnEdit}`} type="submit">
                  Reject
                </button>
              </form>
            </div>
          </div>
        );
      })}
    </div>
  );
}
