/**
 * Agent Builder chooser — mode-routing + surface tests.
 *
 * The merge's core contract: the user describes the task ONCE, then the mode
 * choice routes them into the correct PRESERVED flow —
 *   • "Run a one-off task"  → Planner one-off flow (/app/planner)
 *   • "Build a Nibbin …"    → Hatch persistent flow (/app/hatch)
 * with the described intent carried through as ?intent=.
 *
 * buildModeHref is the pure routing seam (tested directly). The static render
 * confirms both modes are presented with unambiguous, non-jargon-colliding copy.
 * renderToStaticMarkup per the repo's no-jsdom pattern.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect, vi } from 'vitest';
import { BuildChooser, buildModeHref } from './BuildChooser';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('./build.module.css', () => ({
  default: new Proxy({}, { get: (_t, k) => String(k) }),
}));

describe('buildModeHref — mode → preserved flow routing', () => {
  it('"once" routes to the existing Planner one-off flow', () => {
    expect(buildModeHref('once', '')).toBe('/app/planner');
  });

  it('"save" routes to the existing Hatch persistent-Nibbin flow', () => {
    expect(buildModeHref('save', '')).toBe('/app/hatch');
  });

  it('carries a non-empty intent through as a URL-encoded ?intent= param (one-off)', () => {
    expect(buildModeHref('once', 'chase unpaid invoices')).toBe(
      '/app/planner?intent=chase%20unpaid%20invoices',
    );
  });

  it('carries a non-empty intent through as a URL-encoded ?intent= param (persistent)', () => {
    expect(buildModeHref('save', 'remind clients to pay')).toBe(
      '/app/hatch?intent=remind%20clients%20to%20pay',
    );
  });

  it('trims whitespace and omits the query when intent is blank', () => {
    expect(buildModeHref('once', '   ')).toBe('/app/planner');
    expect(buildModeHref('save', '\n\t')).toBe('/app/hatch');
  });

  it('encodes special characters safely', () => {
    expect(buildModeHref('once', 'a&b=c?d')).toBe('/app/planner?intent=a%26b%3Dc%3Fd');
  });
});

describe('BuildChooser — unified entry surface', () => {
  const html = renderToStaticMarkup(<BuildChooser />);

  it('presents a single shared intent input', () => {
    expect(html).toContain('What do you want done?');
    expect(html).toContain('<textarea');
  });

  it('offers both modes with unmistakable, non-colliding copy', () => {
    expect(html).toContain('Run a one-off task');
    expect(html).toContain('Build a Nibbin that does this regularly');
  });
});
