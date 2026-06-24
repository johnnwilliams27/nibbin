/**
 * Task 7 tests — Grove Home: extended "NEEDS YOUR EYES" count + inline proposal cards.
 *
 * Coverage:
 *  7g-1  computeNeedsYouTotal: waitingCount + reviewItemCount
 *  7g-2  computeNeedsYouTotal: null inputs coerce to 0
 *  7g-3  computeNeedsYouTotal: both zero returns 0
 *  7g-4  computeNeedsYouTotal: only awaiting_approval (reviewItemCount = null)
 *  7g-5  computeNeedsYouTotal: only review_item (waitingCount = null)
 *
 * Proposal-card markup:
 *  7h-1  renderProposalCards: renders one card per pending proposal
 *  7h-2  renderProposalCards: approve form has proposalId + decision='approved'
 *  7h-3  renderProposalCards: reject form has proposalId + decision='rejected'
 *  7h-4  renderProposalCards: high-stakes proposal shows "High stakes" badge
 *  7h-5  renderProposalCards: normal-stakes proposal does NOT show "High stakes" badge
 *  7h-6  renderProposalCards: renders section header "Memory proposals"
 *  7h-7  renderProposalCards: rationale longer than 80 chars is truncated with "…"
 *  7h-8  renderProposalCards: null rationale does not crash
 *  7h-9  renderProposalCards: empty proposals array renders nothing (no section)
 *  7h-10 renderProposalCards: multiple proposals each get their own approve + reject form
 */

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { computeNeedsYouTotal, renderProposalCards } from './page-helpers';

// ── 7g — computeNeedsYouTotal ────────────────────────────────────────────────

describe('computeNeedsYouTotal (Task 7g)', () => {
  it('7g-1 — sums waitingCount + reviewItemCount', () => {
    expect(computeNeedsYouTotal(3, 2)).toBe(5);
  });

  it('7g-2 — null inputs coerce to 0', () => {
    expect(computeNeedsYouTotal(null, null)).toBe(0);
  });

  it('7g-3 — both zero returns 0', () => {
    expect(computeNeedsYouTotal(0, 0)).toBe(0);
  });

  it('7g-4 — only waitingCount when reviewItemCount is null', () => {
    expect(computeNeedsYouTotal(4, null)).toBe(4);
  });

  it('7g-5 — only reviewItemCount when waitingCount is null', () => {
    expect(computeNeedsYouTotal(null, 7)).toBe(7);
  });
});

// ── 7h — renderProposalCards markup ──────────────────────────────────────────

type PendingProposal = {
  id: string;
  field_key: string;
  rationale: string | null;
  stakes: string;
};

function renderCards(proposals: PendingProposal[]): string {
  const el = renderProposalCards(proposals);
  if (el === null) return '';
  return renderToStaticMarkup(el);
}

describe('renderProposalCards (Task 7h)', () => {
  const singleNormal: PendingProposal = {
    id: 'prop-uuid-1',
    field_key: 'pricing',
    rationale: 'Updated rate from proposal meeting',
    stakes: 'normal',
  };

  const singleHigh: PendingProposal = {
    id: 'prop-uuid-2',
    field_key: 'availability',
    rationale: 'Conflict detected with existing value',
    stakes: 'high',
  };

  it('7h-1 — renders one card per pending proposal', () => {
    const html = renderCards([singleNormal]);
    // The card should mention the field key
    expect(html).toContain('pricing');
  });

  it('7h-2 — approve form has proposalId + decision=approved', () => {
    const html = renderCards([singleNormal]);
    expect(html).toContain('name="proposalId"');
    expect(html).toContain('value="prop-uuid-1"');
    expect(html).toContain('name="decision"');
    expect(html).toContain('value="approved"');
  });

  it('7h-3 — reject form has proposalId + decision=rejected', () => {
    const html = renderCards([singleNormal]);
    expect(html).toContain('value="rejected"');
  });

  it('7h-4 — high-stakes proposal shows "High stakes" badge', () => {
    const html = renderCards([singleHigh]);
    expect(html).toContain('High stakes');
  });

  it('7h-5 — normal-stakes proposal does NOT show "High stakes" badge', () => {
    const html = renderCards([singleNormal]);
    expect(html).not.toContain('High stakes');
  });

  it('7h-6 — renders section header "Memory proposals"', () => {
    const html = renderCards([singleNormal]);
    expect(html).toContain('Memory proposals');
  });

  it('7h-7 — rationale longer than 80 chars is truncated with "…"', () => {
    const longRationale = 'A'.repeat(100);
    const proposal: PendingProposal = { ...singleNormal, rationale: longRationale };
    const html = renderCards([proposal]);
    // Should contain the truncated prefix (79 chars of A) + ellipsis
    expect(html).toContain('A'.repeat(79) + '…');
    // Should NOT contain the full 100-char string
    expect(html).not.toContain('A'.repeat(100));
  });

  it('7h-8 — null rationale does not crash', () => {
    const proposal: PendingProposal = { ...singleNormal, rationale: null };
    expect(() => renderCards([proposal])).not.toThrow();
    const html = renderCards([proposal]);
    expect(html).toContain('pricing');
  });

  it('7h-9 — empty proposals array renders nothing (returns null)', () => {
    const html = renderCards([]);
    expect(html).toBe('');
  });

  it('7h-10 — multiple proposals each get their own approve + reject forms', () => {
    const proposals: PendingProposal[] = [
      { id: 'prop-a', field_key: 'pricing', rationale: 'first', stakes: 'normal' },
      { id: 'prop-b', field_key: 'email', rationale: 'second', stakes: 'high' },
    ];
    const html = renderCards(proposals);
    // Both proposal IDs appear
    expect(html).toContain('value="prop-a"');
    expect(html).toContain('value="prop-b"');
    // Both field keys appear
    expect(html).toContain('pricing');
    expect(html).toContain('email');
    // High stakes only on prop-b card — appears once
    const count = (html.match(/High stakes/g) ?? []).length;
    expect(count).toBe(1);
    // Both have approve + reject: 4 decision inputs total
    const decisionMatches = html.match(/name="decision"/g) ?? [];
    expect(decisionMatches.length).toBe(4);
  });
});
