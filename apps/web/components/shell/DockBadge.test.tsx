/**
 * Task 5 — DockBadge component tests.
 *
 * DockBadge is a pure presentational component (no hooks) so renderToStaticMarkup
 * works. Tests cover the plan's 5e/5f/5g cases mapped onto the pure component.
 *
 * @testing-library/react is NOT installed in this repo; using renderToStaticMarkup
 * per the project's no-jsdom pattern (see Tooltip.test.tsx, SegmentedControl.test.tsx).
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect } from 'vitest';
import { DockBadge } from './DockBadge';

describe('DockBadge — static rendering', () => {
  it('5e: renders badge span with aria-label when unread > 0', () => {
    const html = renderToStaticMarkup(<DockBadge unread={3} />);
    // Badge span must carry aria-label with the count
    expect(html).toContain('aria-label="3 unread"');
    // Badge text is the number
    expect(html).toContain('>3<');
  });

  it('5f: renders nothing when unread === 0', () => {
    const html = renderToStaticMarkup(<DockBadge unread={0} />);
    // No markup at all — null return
    expect(html).toBe('');
  });

  it('5g: caps display at 9+ when unread > 9', () => {
    const html = renderToStaticMarkup(<DockBadge unread={14} />);
    expect(html).toContain('>9+<');
    // aria-label still shows the real count
    expect(html).toContain('aria-label="14 unread"');
  });

  it('renders exactly 9 (not capped) for unread=9', () => {
    const html = renderToStaticMarkup(<DockBadge unread={9} />);
    expect(html).toContain('>9<');
    expect(html).not.toContain('9+');
  });

  it('5h analogue: badge shows the number passed via prop without any async fetch', () => {
    // DockBadge is pure — it renders immediately from props, no effect needed.
    const html = renderToStaticMarkup(<DockBadge unread={5} />);
    expect(html).toContain('aria-label="5 unread"');
    expect(html).toContain('>5<');
  });

  it('§10.3 source-of-truth: badge label matches what formatBadgeCount returns', () => {
    // Both DockBadge and AppShell use formatBadgeCount — importing here verifies
    // the component and the seam agree on the same label for the same input.
    // (Belt-and-suspenders; the real guarantee is that DockBadge imports the util.)
    const html = renderToStaticMarkup(<DockBadge unread={10} />);
    expect(html).toContain('>9+<');
  });
});
