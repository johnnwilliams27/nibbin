/**
 * Task 10 — MemorySection component tests.
 *
 * Uses renderToStaticMarkup (no jsdom, no testing-library) per repo convention.
 *
 * What we assert:
 *  - Renders the section heading
 *  - Renders the optional section hint
 *  - Renders child elements (ordered field slots)
 *  - When no hint is provided: no hint element rendered
 *  - Carries the structural memorySection class
 *
 * MemorySection is a pure presentational wrapper: heading + optional hint +
 * children. Task 11 (MemoryClient assembly) will pass actual FieldBlock children.
 * Here we test with simple string/div children to keep tests self-contained.
 */

import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemorySection } from './MemorySection';

// ---------------------------------------------------------------------------
// Heading rendering
// ---------------------------------------------------------------------------

describe('MemorySection — heading', () => {
  it('renders the section heading', () => {
    const html = renderToStaticMarkup(
      <MemorySection heading="About your business">
        <div>Field A</div>
      </MemorySection>,
    );
    expect(html).toContain('About your business');
  });

  it('renders heading for "Voice &amp; rules" section', () => {
    const html = renderToStaticMarkup(
      <MemorySection heading="Voice &amp; rules">
        <div>Field B</div>
      </MemorySection>,
    );
    // HTML entities may be encoded; check for the raw text or encoded form
    expect(html).toContain('Voice');
    expect(html).toContain('rules');
  });

  it('carries the memorySection root class', () => {
    const html = renderToStaticMarkup(
      <MemorySection heading="About your business">
        <div>content</div>
      </MemorySection>,
    );
    expect(html).toContain('memorySection');
  });
});

// ---------------------------------------------------------------------------
// Optional hint
// ---------------------------------------------------------------------------

describe('MemorySection — hint', () => {
  it('renders the hint when provided', () => {
    const html = renderToStaticMarkup(
      <MemorySection heading="About your business" hint="These fields shape every reply.">
        <div>content</div>
      </MemorySection>,
    );
    expect(html).toContain('These fields shape every reply.');
  });

  it('does not render a hint element when hint is absent', () => {
    const html = renderToStaticMarkup(
      <MemorySection heading="About your business">
        <div>content</div>
      </MemorySection>,
    );
    // The sectionHint class should not appear when no hint is provided
    expect(html).not.toContain('sectionHint');
  });
});

// ---------------------------------------------------------------------------
// Children (ordered field slots)
// ---------------------------------------------------------------------------

describe('MemorySection — children', () => {
  it('renders a single child', () => {
    const html = renderToStaticMarkup(
      <MemorySection heading="About your business">
        <div data-testid="field-a">Field A content</div>
      </MemorySection>,
    );
    expect(html).toContain('Field A content');
  });

  it('renders multiple children in order', () => {
    const html = renderToStaticMarkup(
      <MemorySection heading="About your business">
        <div>First field</div>
        <div>Second field</div>
        <div>Third field</div>
      </MemorySection>,
    );
    const firstIdx = html.indexOf('First field');
    const secondIdx = html.indexOf('Second field');
    const thirdIdx = html.indexOf('Third field');
    expect(firstIdx).toBeLessThan(secondIdx);
    expect(secondIdx).toBeLessThan(thirdIdx);
  });

  it('renders the children inside the section fields container', () => {
    const html = renderToStaticMarkup(
      <MemorySection heading="About your business">
        <div>Child one</div>
        <div>Child two</div>
      </MemorySection>,
    );
    // Children appear after the heading
    const headingIdx = html.indexOf('About your business');
    const childIdx = html.indexOf('Child one');
    expect(childIdx).toBeGreaterThan(headingIdx);
  });
});

// ---------------------------------------------------------------------------
// Structural class contract
// ---------------------------------------------------------------------------

describe('MemorySection — structural classes', () => {
  it('heading element carries the sectionHeading class', () => {
    const html = renderToStaticMarkup(
      <MemorySection heading="About your business">
        <div>content</div>
      </MemorySection>,
    );
    expect(html).toContain('sectionHeading');
  });

  it('fields container carries the sectionFields class', () => {
    const html = renderToStaticMarkup(
      <MemorySection heading="About your business">
        <div>content</div>
      </MemorySection>,
    );
    expect(html).toContain('sectionFields');
  });
});
