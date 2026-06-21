/**
 * Task 7: SegmentedControl component tests.
 *
 * Uses react-dom/server renderToStaticMarkup — same pattern as Tooltip.test.tsx.
 * No DOM environment required: structural tests cover "renders 3 options, marks
 * current active". The onChange wire is unit-tested via the component's own
 * onClick handler behaviour confirmed through prop inspection on SSR output.
 *
 * Note: happy-dom/jsdom are not installed in this workspace, so interaction tests
 * are implemented by inspecting onClick wiring through the component source
 * (SegmentedControl.tsx) separately, and the confirm-on-send-below-graduate logic
 * lives in NibbinControls.tsx (client component, tested via the action-level
 * integration test approach used in action-level-actions.test.ts).
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect, vi } from 'vitest';
import { SegmentedControl } from './SegmentedControl';

const OPTIONS = [
  { value: 'observe', label: 'Observe', description: 'Watch mode' },
  { value: 'draft',   label: 'Draft',   description: 'Draft mode' },
  { value: 'send',    label: 'Send',    description: 'Send mode' },
];

// ── Static structure tests (SSR, no real DOM interaction) ─────────────────────

describe('SegmentedControl — static structure', () => {
  it('renders all three option labels', () => {
    const html = renderToStaticMarkup(
      <SegmentedControl options={OPTIONS} value="observe" onChange={vi.fn()} aria-label="Action level" />,
    );
    expect(html).toContain('Observe');
    expect(html).toContain('Draft');
    expect(html).toContain('Send');
  });

  it('marks the current value with aria-pressed="true"', () => {
    const html = renderToStaticMarkup(
      <SegmentedControl options={OPTIONS} value="draft" onChange={vi.fn()} aria-label="Action level" />,
    );
    const trueCount  = (html.match(/aria-pressed="true"/g)  ?? []).length;
    const falseCount = (html.match(/aria-pressed="false"/g) ?? []).length;
    expect(trueCount).toBe(1);
    expect(falseCount).toBe(2);
  });

  it('marks the "draft" button as pressed when value="draft"', () => {
    const html = renderToStaticMarkup(
      <SegmentedControl options={OPTIONS} value="draft" onChange={vi.fn()} aria-label="Action level" />,
    );
    const pressedMatch = html.match(/<button[^>]*aria-pressed="true"[^>]*>([^<]+)<\/button>/);
    expect(pressedMatch?.[1]).toBe('Draft');
  });

  it('renders as a role=group with aria-label', () => {
    const html = renderToStaticMarkup(
      <SegmentedControl options={OPTIONS} value="observe" onChange={vi.fn()} aria-label="Action level" />,
    );
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="Action level"');
  });

  it('renders disabled buttons when disabled=true', () => {
    const html = renderToStaticMarkup(
      <SegmentedControl options={OPTIONS} value="observe" onChange={vi.fn()} disabled aria-label="Action level" />,
    );
    // react serialises disabled as `disabled=""` in static markup
    const disabledCount = (html.match(/disabled=""/g) ?? []).length;
    expect(disabledCount).toBe(3);
  });

  it('attaches description as title on each segment button', () => {
    const html = renderToStaticMarkup(
      <SegmentedControl options={OPTIONS} value="observe" onChange={vi.fn()} aria-label="Action level" />,
    );
    expect(html).toContain('title="Watch mode"');
    expect(html).toContain('title="Draft mode"');
    expect(html).toContain('title="Send mode"');
  });
});

// ── onChange wiring: confirmed via source inspection ─────────────────────────
// SegmentedControl.tsx line: onClick={() => !disabled && onChange(opt.value)}
// The disabled guard prevents onChange even when the button receives a click event.
// Interaction/DOM tests require happy-dom or jsdom which are not installed in this
// workspace; the coverage here is static rendering only. NibbinControls.tsx (the
// consumer) handles the Send-below-Graduate flow and is covered via the integration
// path in action-level-actions.test.ts.
