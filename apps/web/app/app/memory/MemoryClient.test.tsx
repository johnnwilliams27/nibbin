/**
 * Task 11 — MemoryClient component tests.
 *
 * Uses renderToStaticMarkup (no jsdom, no testing-library) per repo convention.
 * Default rendered tab is 'memory' (the Grove Memory / truth tab).
 *
 * What we assert:
 *  1. Two tabs rendered with correct labels ("Grove Memory" / "Sources")
 *  2. Tabs carry role="tab" and aria-selected semantics
 *  3. Tab container carries role="tablist"
 *  4. The framing strip is present when isEmpty=false and no field is editing
 *  5. Both MemorySections are rendered in spec order:
 *       "About your business" → "Voice & rules"
 *  6. HardRulesBlock is rendered (coral eyebrow "HARD RULES")
 *  7. isEmpty=true → EmptyState rendered instead of sections
 *  8. The active tab panel carries role="tabpanel"
 *
 * What we do NOT assert (no jsdom):
 *  - Click-to-switch-tab transitions
 *  - Per-field save dispatch
 *  - Active edit mode suppressing the framing strip
 */

import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryClient } from './MemoryClient';

// ---------------------------------------------------------------------------
// Default test props — a filled memory state
// ---------------------------------------------------------------------------

const filledValues: Record<string, string> = {
  facts: 'Business type: Photography\nLocation: Portland',
  pricing: 'Standard session: $400',
  policies: '48-hour cancellation policy',
  faq: 'Do you travel? Yes.',
  voice: 'Warm and direct.',
  hard_rules: 'Never promise a date without checking',
  notes: 'Some general notes.',
};

const emptyValues: Record<string, string> = {
  facts: '',
  pricing: '',
  policies: '',
  faq: '',
  voice: '',
  hard_rules: '',
  notes: '',
};

// No-op helpers available for future test use; currently all tests use the
// default MemoryClient which wires its own internal handlers.

// ---------------------------------------------------------------------------
// Tab bar
// ---------------------------------------------------------------------------

describe('MemoryClient — tab bar', () => {
  it('renders a "Grove Memory" tab label', () => {
    const html = renderToStaticMarkup(
      <MemoryClient
        initialValues={filledValues}
        initialReference=""
        isEmpty={false}
      />,
    );
    expect(html).toContain('Grove Memory');
  });

  it('renders a "Sources" tab label', () => {
    const html = renderToStaticMarkup(
      <MemoryClient
        initialValues={filledValues}
        initialReference=""
        isEmpty={false}
      />,
    );
    expect(html).toContain('Sources');
  });

  it('tab container carries role="tablist"', () => {
    const html = renderToStaticMarkup(
      <MemoryClient
        initialValues={filledValues}
        initialReference=""
        isEmpty={false}
      />,
    );
    expect(html).toContain('role="tablist"');
  });

  it('tab buttons carry role="tab"', () => {
    const html = renderToStaticMarkup(
      <MemoryClient
        initialValues={filledValues}
        initialReference=""
        isEmpty={false}
      />,
    );
    expect(html).toContain('role="tab"');
  });

  it('Grove Memory tab is aria-selected="true" by default', () => {
    const html = renderToStaticMarkup(
      <MemoryClient
        initialValues={filledValues}
        initialReference=""
        isEmpty={false}
      />,
    );
    // Memory tab is active by default
    expect(html).toContain('aria-selected="true"');
  });
});

// ---------------------------------------------------------------------------
// Framing strip
// ---------------------------------------------------------------------------

describe('MemoryClient — framing strip', () => {
  it('renders the framing strip when isEmpty=false', () => {
    const html = renderToStaticMarkup(
      <MemoryClient
        initialValues={filledValues}
        initialReference=""
        isEmpty={false}
      />,
    );
    expect(html).toContain('framingStrip');
  });

  it('does NOT render the framing strip when isEmpty=true', () => {
    const html = renderToStaticMarkup(
      <MemoryClient
        initialValues={emptyValues}
        initialReference=""
        isEmpty={true}
      />,
    );
    expect(html).not.toContain('framingStrip');
  });

  it('framing strip contains the truth copy', () => {
    const html = renderToStaticMarkup(
      <MemoryClient
        initialValues={filledValues}
        initialReference=""
        isEmpty={false}
      />,
    );
    expect(html).toContain('truth');
  });
});

// ---------------------------------------------------------------------------
// MemorySections on the truth tab
// ---------------------------------------------------------------------------

describe('MemoryClient — MemorySections (truth tab)', () => {
  it('renders "About your business" section', () => {
    const html = renderToStaticMarkup(
      <MemoryClient
        initialValues={filledValues}
        initialReference=""
        isEmpty={false}
      />,
    );
    expect(html).toContain('About your business');
  });

  it('renders "Voice &amp; rules" section', () => {
    const html = renderToStaticMarkup(
      <MemoryClient
        initialValues={filledValues}
        initialReference=""
        isEmpty={false}
      />,
    );
    // Either "Voice & rules" or the HTML entity variant
    expect(html).toMatch(/Voice\s*(?:&amp;|&amp;|&)\s*rules/i);
  });

  it('"About your business" appears before "Voice & rules" (spec order)', () => {
    const html = renderToStaticMarkup(
      <MemoryClient
        initialValues={filledValues}
        initialReference=""
        isEmpty={false}
      />,
    );
    const aboutIdx = html.indexOf('About your business');
    const voiceIdx = html.search(/Voice\s*(?:&amp;|&)\s*rules/i);
    expect(aboutIdx).toBeGreaterThan(-1);
    expect(voiceIdx).toBeGreaterThan(-1);
    expect(aboutIdx).toBeLessThan(voiceIdx);
  });

  it('renders pricing field content in the first section', () => {
    const html = renderToStaticMarkup(
      <MemoryClient
        initialValues={filledValues}
        initialReference=""
        isEmpty={false}
      />,
    );
    // The pricing value should appear in the truth tab
    expect(html).toContain('Standard session');
  });
});

// ---------------------------------------------------------------------------
// HardRulesBlock
// ---------------------------------------------------------------------------

describe('MemoryClient — HardRulesBlock', () => {
  it('renders the HARD RULES eyebrow', () => {
    const html = renderToStaticMarkup(
      <MemoryClient
        initialValues={filledValues}
        initialReference=""
        isEmpty={false}
      />,
    );
    expect(html).toContain('HARD RULES');
  });

  it('renders hard rules content', () => {
    const html = renderToStaticMarkup(
      <MemoryClient
        initialValues={filledValues}
        initialReference=""
        isEmpty={false}
      />,
    );
    expect(html).toContain('Never promise a date without checking');
  });
});

// ---------------------------------------------------------------------------
// EmptyState — shown when isEmpty=true
// ---------------------------------------------------------------------------

describe('MemoryClient — EmptyState', () => {
  it('renders EmptyState when isEmpty=true', () => {
    const html = renderToStaticMarkup(
      <MemoryClient
        initialValues={emptyValues}
        initialReference=""
        isEmpty={true}
      />,
    );
    // EmptyState renders the egg creature and first-run headline
    expect(html).toContain("Your grove doesn");
    expect(html).toContain("know much yet");
  });

  it('does NOT render MemorySections when isEmpty=true', () => {
    const html = renderToStaticMarkup(
      <MemoryClient
        initialValues={emptyValues}
        initialReference=""
        isEmpty={true}
      />,
    );
    // "About your business" heading should not appear when empty state is showing
    expect(html).not.toContain('About your business');
  });

  it('renders affordance chips in EmptyState', () => {
    const html = renderToStaticMarkup(
      <MemoryClient
        initialValues={emptyValues}
        initialReference=""
        isEmpty={true}
      />,
    );
    expect(html).toContain('Start with business facts');
    expect(html).toContain('Set your voice');
  });
});

// ---------------------------------------------------------------------------
// Tab panel accessibility
// ---------------------------------------------------------------------------

describe('MemoryClient — tab panel a11y', () => {
  it('active tab panel carries role="tabpanel"', () => {
    const html = renderToStaticMarkup(
      <MemoryClient
        initialValues={filledValues}
        initialReference=""
        isEmpty={false}
      />,
    );
    expect(html).toContain('role="tabpanel"');
  });
});

// ---------------------------------------------------------------------------
// Sources tab stub (Task 13 builds the full content)
// ---------------------------------------------------------------------------

describe('MemoryClient — Sources tab stub', () => {
  it('renders Sources tab label (for future tab navigation)', () => {
    const html = renderToStaticMarkup(
      <MemoryClient
        initialValues={filledValues}
        initialReference=""
        isEmpty={false}
      />,
    );
    expect(html).toContain('Sources');
  });
});
