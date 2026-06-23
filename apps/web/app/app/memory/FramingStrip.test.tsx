/**
 * Task 10 — FramingStrip component tests.
 *
 * Uses renderToStaticMarkup (no jsdom, no testing-library) per repo convention.
 *
 * What we assert:
 *  - Renders the leaf glyph (aria-hidden SVG or text character)
 *  - Renders the "Your Nibbins read this as truth" framing copy (spec §10)
 *  - Renders the full sentence including "every draft" tail
 *  - When `hidden` prop is true: renders nothing (null / empty string)
 *
 * Spec §10 copy:
 *   "Your Nibbins read this as truth. They'll quote it, paraphrase it,
 *    and follow it — every draft."
 *
 * The strip disappears on first-run (isEmpty) and in active edit mode.
 * Those suppression conditions are controlled by the `hidden` prop, which the
 * parent (GroveMemoryTab / MemoryClient) derives from its own state.
 */

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FramingStrip } from './FramingStrip';

// ---------------------------------------------------------------------------
// Visible state (default)
// ---------------------------------------------------------------------------

describe('FramingStrip — visible (default)', () => {
  it('renders the framing copy "Your Nibbins read this as truth"', () => {
    const html = renderToStaticMarkup(<FramingStrip />);
    expect(html).toContain('Your Nibbins read this as truth');
  });

  it('renders the full sentence including "every draft"', () => {
    const html = renderToStaticMarkup(<FramingStrip />);
    expect(html).toContain('every draft');
  });

  it('renders the tail "quote it, paraphrase it"', () => {
    const html = renderToStaticMarkup(<FramingStrip />);
    expect(html).toContain('paraphrase it');
  });

  it('renders a leaf glyph element (aria-hidden)', () => {
    const html = renderToStaticMarkup(<FramingStrip />);
    // The glyph may be an SVG or a span — it must be aria-hidden
    expect(html).toContain('aria-hidden');
  });

  it('carries the framingStrip root class', () => {
    const html = renderToStaticMarkup(<FramingStrip />);
    expect(html).toContain('framingStrip');
  });
});

// ---------------------------------------------------------------------------
// Hidden state (first-run + active-edit suppression, spec §10)
// ---------------------------------------------------------------------------

describe('FramingStrip — hidden prop', () => {
  it('renders nothing when hidden=true', () => {
    const html = renderToStaticMarkup(<FramingStrip hidden />);
    expect(html).toBe('');
  });

  it('renders content when hidden is absent (default visible)', () => {
    const html = renderToStaticMarkup(<FramingStrip />);
    expect(html.length).toBeGreaterThan(0);
  });

  it('renders content when hidden=false (explicit)', () => {
    const html = renderToStaticMarkup(<FramingStrip hidden={false} />);
    expect(html).toContain('Your Nibbins read this as truth');
  });
});
