/**
 * Task 8 tests — capture-origin tag + post-study suggestions banner.
 *
 * NO jsdom: markup assertions run via renderToStaticMarkup (server-side).
 * This avoids a DOM runtime dependency and matches the plan constraint.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CaptureOriginTag, originLabel } from './CaptureOriginTag';
import { StudySuggestionsBanner } from './StudySuggestionsBanner';

// ── originLabel helper ────────────────────────────────────────────────────────

describe('originLabel', () => {
  it('maps capture to "From your Field Study"', () => {
    expect(originLabel('capture')).toBe('From your Field Study');
  });

  it('maps doc_extract to a document label', () => {
    expect(originLabel('doc_extract')).toBe('From a document');
  });

  it('maps unknown/other origins to a generic label without throwing', () => {
    expect(typeof originLabel('manual')).toBe('string');
    expect(typeof originLabel('collate')).toBe('string');
  });
});

// ── CaptureOriginTag ──────────────────────────────────────────────────────────

describe('CaptureOriginTag', () => {
  it('renders "From your Field Study" for a capture-origin proposal', () => {
    const html = renderToStaticMarkup(
      <CaptureOriginTag origin="capture" studyId="study-abc" />,
    );
    expect(html).toContain('From your Field Study');
    // must include a deep-link to the study
    expect(html).toContain('/app/study');
  });

  it('renders a non-capture origin label without a study link', () => {
    const html = renderToStaticMarkup(
      <CaptureOriginTag origin="doc_extract" />,
    );
    expect(html).toContain('From a document');
    expect(html).not.toContain('/app/study');
  });

  it('renders nothing (null) when origin is absent/falsy', () => {
    // TypeScript type is `string` but runtime callers may pass undefined
    // (e.g. older proposal rows without an origin). Guard gracefully.
    const html = renderToStaticMarkup(
      <CaptureOriginTag origin={undefined as unknown as string} />,
    );
    expect(html).toBe('');
  });
});

// ── StudySuggestionsBanner ────────────────────────────────────────────────────

describe('StudySuggestionsBanner', () => {
  it('renders nothing when count is 0', () => {
    const html = renderToStaticMarkup(<StudySuggestionsBanner count={0} />);
    expect(html).toBe('');
  });

  it('uses "1 thing" for count=1 (singular)', () => {
    const html = renderToStaticMarkup(<StudySuggestionsBanner count={1} />);
    expect(html).toContain('1 thing');
    expect(html).not.toContain('things');
  });

  it('uses "N things" for count>1 (plural)', () => {
    const html = renderToStaticMarkup(<StudySuggestionsBanner count={3} />);
    expect(html).toContain('3 things');
  });

  it('renders the "ready when you are" message', () => {
    const html = renderToStaticMarkup(<StudySuggestionsBanner count={2} />);
    expect(html).toContain('ready when you are');
  });

  it('includes a dismiss affordance', () => {
    const html = renderToStaticMarkup(<StudySuggestionsBanner count={2} />);
    // A dismiss button or link must be present (client component handles the click)
    expect(html).toMatch(/dismiss|Dismiss/);
  });
});
