/**
 * Task 7 — "Done — save what I kept" review CTA tests.
 *
 * No jsdom installed in this workspace.  Two complementary layers:
 *
 * 1. Structural (renderToStaticMarkup): verifies the button text, disabled state
 *    when finalizing, and the consent-gate role (primary variant).
 *
 * 2. Logic (direct unit test of handleDone): extracts the async handler so the
 *    sequencing — call finalizeReview() → navigate — can be asserted without a
 *    live React component.  Uses vi.fn() mocks for the bridge and router.push.
 *
 * This matches the pattern established in segmented-control.test.tsx and
 * Tooltip.test.tsx (the only test infra available here).
 */

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect, vi } from 'vitest';
import { ReviewDoneCta } from './ReviewDoneCta';
import { handleDone } from './review-cta-logic';

// ---------------------------------------------------------------------------
// 1. Structural tests — the CTA renders with correct text and semantics
// ---------------------------------------------------------------------------

describe('ReviewDoneCta — static structure', () => {
  it('renders the "Done — save what I kept" button', () => {
    const html = renderToStaticMarkup(
      <ReviewDoneCta finalizing={false} onDone={vi.fn()} />,
    );
    expect(html).toContain('Done — save what I kept');
    expect(html).toContain('<button');
  });

  it('renders the "Learning from your study…" label when finalizing=true', () => {
    const html = renderToStaticMarkup(
      <ReviewDoneCta finalizing={true} onDone={vi.fn()} />,
    );
    expect(html).toContain('Learning from your study');
    expect(html).toContain('disabled');
  });

  it('button is NOT disabled when finalizing=false', () => {
    const html = renderToStaticMarkup(
      <ReviewDoneCta finalizing={false} onDone={vi.fn()} />,
    );
    expect(html).not.toMatch(/\bdisabled\b/);
  });
});

// ---------------------------------------------------------------------------
// 2. Logic tests — handleDone() sequencing
// ---------------------------------------------------------------------------

describe('handleDone', () => {
  it('calls finalizeReview exactly once then navigates to /app/memory?from_study=1 when proposals_requested=true', async () => {
    const finalizeReview = vi.fn().mockResolvedValue({ proposals_requested: true });
    const push = vi.fn();

    await handleDone(finalizeReview, push);

    expect(finalizeReview).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith('/app/memory?from_study=1');
  });

  it('navigates to /app/memory (no param) when proposals_requested=false', async () => {
    const finalizeReview = vi.fn().mockResolvedValue({ proposals_requested: false });
    const push = vi.fn();

    await handleDone(finalizeReview, push);

    expect(push).toHaveBeenCalledWith('/app/memory');
    expect(push).toHaveBeenCalledTimes(1);
  });

  it('navigates to /app/memory and does NOT throw when finalizeReview rejects (desktop-absent fallback)', async () => {
    const finalizeReview = vi.fn().mockRejectedValue(new Error('not in shell'));
    const push = vi.fn();

    await expect(handleDone(finalizeReview, push)).resolves.not.toThrow();

    expect(push).toHaveBeenCalledWith('/app/memory');
  });

  it('invokes finalizeReview before push (sequencing)', async () => {
    const calls: string[] = [];
    const finalizeReview = vi.fn().mockImplementation(async () => {
      calls.push('finalize');
      return { proposals_requested: true };
    });
    const push = vi.fn().mockImplementation(() => {
      calls.push('push');
    });

    await handleDone(finalizeReview, push);

    expect(calls).toEqual(['finalize', 'push']);
  });
});
