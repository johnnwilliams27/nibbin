/**
 * Task 10 — EmptyState component tests.
 *
 * Uses renderToStaticMarkup (no jsdom, no testing-library) per repo convention.
 *
 * What we assert:
 *  - Renders an egg-stage creature SVG (via buildCreature from @nibbin/creatures)
 *  - Renders the two-line first-run message (spec §9)
 *  - Renders two ghost affordance chips with the correct field keys:
 *      "Start with business facts" → fieldKey="facts"
 *      "Set your voice"           → fieldKey="voice"
 *
 * What we do NOT assert:
 *  - Click → field-open transitions (no jsdom; the fieldKey data attr is the seam)
 */

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { EmptyState } from './EmptyState';

// ---------------------------------------------------------------------------
// No-op onChipClick (chips pass fieldKey up to MemoryClient)
// ---------------------------------------------------------------------------

const noop = (_fieldKey: string) => {};

// ---------------------------------------------------------------------------
// EmptyState — creature illustration
// ---------------------------------------------------------------------------

describe('EmptyState — egg-stage creature', () => {
  it('renders an SVG element (creature illustration)', () => {
    const html = renderToStaticMarkup(<EmptyState onChipClick={noop} />);
    // buildCreature returns an SVG string rendered via dangerouslySetInnerHTML
    expect(html).toContain('<svg');
  });

  it('creature wrapper has an accessible label mentioning egg', () => {
    const html = renderToStaticMarkup(<EmptyState onChipClick={noop} />);
    // aria-label on the creature container
    expect(html.toLowerCase()).toContain('egg');
  });
});

// ---------------------------------------------------------------------------
// EmptyState — first-run message (§9 copy)
// ---------------------------------------------------------------------------

describe('EmptyState — first-run message', () => {
  it('renders the headline "Your grove doesn\'t know much yet"', () => {
    const html = renderToStaticMarkup(<EmptyState onChipClick={noop} />);
    expect(html).toContain("Your grove doesn");
    expect(html).toContain("know much yet");
  });

  it('renders the body copy about making a difference', () => {
    const html = renderToStaticMarkup(<EmptyState onChipClick={noop} />);
    expect(html).toContain("Fill in a few sections");
    // Key phrase: "makes a real difference" or similar
    expect(html).toContain("difference");
  });
});

// ---------------------------------------------------------------------------
// EmptyState — affordance chips (§9)
// ---------------------------------------------------------------------------

describe('EmptyState — affordance chips', () => {
  it('renders a "Start with business facts" chip', () => {
    const html = renderToStaticMarkup(<EmptyState onChipClick={noop} />);
    expect(html).toContain('Start with business facts');
  });

  it('renders a "Set your voice" chip', () => {
    const html = renderToStaticMarkup(<EmptyState onChipClick={noop} />);
    expect(html).toContain('Set your voice');
  });

  it('facts chip carries data-field-key="facts"', () => {
    const html = renderToStaticMarkup(<EmptyState onChipClick={noop} />);
    expect(html).toContain('data-field-key="facts"');
  });

  it('voice chip carries data-field-key="voice"', () => {
    const html = renderToStaticMarkup(<EmptyState onChipClick={noop} />);
    expect(html).toContain('data-field-key="voice"');
  });

  it('chips are rendered as buttons (ghost affordance)', () => {
    const html = renderToStaticMarkup(<EmptyState onChipClick={noop} />);
    // At least two <button> elements for the affordance chips
    const buttonCount = (html.match(/<button/g) ?? []).length;
    expect(buttonCount).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// EmptyState — structural CSS classes
// ---------------------------------------------------------------------------

describe('EmptyState — structural classes', () => {
  it('carries the emptyState root class', () => {
    const html = renderToStaticMarkup(<EmptyState onChipClick={noop} />);
    expect(html).toContain('emptyState');
  });

  it('chip elements carry the chip class', () => {
    const html = renderToStaticMarkup(<EmptyState onChipClick={noop} />);
    expect(html).toContain('chip');
  });
});
