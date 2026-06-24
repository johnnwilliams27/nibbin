/**
 * Task 8 (C2) — Conflict wiring tests.
 *
 * Verifies that:
 *  1. A FieldBlock with a matching conflict entry renders the ConflictFlag
 *  2. A FieldBlock without a conflict entry renders normally (no flag)
 *  3. The coral HardRulesBlock, Reference, and existing MemoryClient structure
 *     still render correctly alongside conflict flags
 *  4. MemoryClient with a conflicts map threads conflicts down to the right field
 *
 * Uses renderToStaticMarkup (no jsdom) per repo convention.
 */

import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryClient } from './MemoryClient';
import type { ConflictView } from './ConflictFlag';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const filledValues: Record<string, string> = {
  about: 'Creative studio in Portland',
  pricing: 'Standard session: $400',
  policies: '48-hour cancellation',
  hard_rules: 'Never promise without checking',
  notes: 'Extra context.',
};

const pricingConflict: ConflictView = {
  flagId: 'flag-uuid-1',
  fieldKey: 'pricing',
  detail: 'Gmail sees $300/hr; your rate sheet says $400/hr',
  sources: [
    {
      id: 'src-uuid-1',
      label: 'Gmail connector',
      value: '$300/hr',
      suggested: false,
    },
    {
      id: 'src-uuid-2',
      label: 'Rate sheet PDF',
      value: '$400/hr',
      suggested: true,
    },
  ],
};

// ---------------------------------------------------------------------------
// MemoryClient with conflicts
// ---------------------------------------------------------------------------

describe('MemoryClient — conflict wiring (Task 8)', () => {
  it('renders "Needs your review" for a field WITH a conflict', () => {
    const conflicts: Record<string, ConflictView> = {
      pricing: pricingConflict,
    };
    const html = renderToStaticMarkup(
      <MemoryClient
        initialValues={filledValues}
        initialReference=""
        isEmpty={false}
        conflicts={conflicts}
      />,
    );
    expect(html).toContain('Needs your review');
  });

  it('shows the competing values in the conflict banner', () => {
    const conflicts: Record<string, ConflictView> = {
      pricing: pricingConflict,
    };
    const html = renderToStaticMarkup(
      <MemoryClient
        initialValues={filledValues}
        initialReference=""
        isEmpty={false}
        conflicts={conflicts}
      />,
    );
    expect(html).toContain('$300/hr');
    expect(html).toContain('$400/hr');
    expect(html).toContain('Gmail connector');
    expect(html).toContain('Rate sheet PDF');
  });

  it('marks the suggested source in the conflict banner', () => {
    const conflicts: Record<string, ConflictView> = {
      pricing: pricingConflict,
    };
    const html = renderToStaticMarkup(
      <MemoryClient
        initialValues={filledValues}
        initialReference=""
        isEmpty={false}
        conflicts={conflicts}
      />,
    );
    expect(html).toContain('suggested');
  });

  it('does NOT render a conflict banner when conflicts is empty', () => {
    const html = renderToStaticMarkup(
      <MemoryClient
        initialValues={filledValues}
        initialReference=""
        isEmpty={false}
        conflicts={{}}
      />,
    );
    expect(html).not.toContain('Needs your review');
  });

  it('does NOT render a conflict banner when conflicts prop is absent', () => {
    const html = renderToStaticMarkup(
      <MemoryClient
        initialValues={filledValues}
        initialReference=""
        isEmpty={false}
      />,
    );
    expect(html).not.toContain('Needs your review');
  });

  it('only the conflicting field renders the flag (other fields are unchanged)', () => {
    const conflicts: Record<string, ConflictView> = {
      pricing: pricingConflict,
    };
    const html = renderToStaticMarkup(
      <MemoryClient
        initialValues={filledValues}
        initialReference=""
        isEmpty={false}
        conflicts={conflicts}
      />,
    );
    // The conflict flag appears once (for pricing only)
    const flagCount = (html.match(/Needs your review/g) ?? []).length;
    expect(flagCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Coral HardRulesBlock, Reference, and existing structure still render
// ---------------------------------------------------------------------------

describe('MemoryClient with conflicts — coral HardRulesBlock + Reference still render', () => {
  it('coral HARD RULES eyebrow still renders alongside conflict flags', () => {
    const conflicts: Record<string, ConflictView> = {
      pricing: pricingConflict,
    };
    const html = renderToStaticMarkup(
      <MemoryClient
        initialValues={filledValues}
        initialReference=""
        isEmpty={false}
        conflicts={conflicts}
      />,
    );
    expect(html).toContain('HARD RULES');
    expect(html).toContain('Never promise without checking');
  });

  it('Reference catch-all renders in Sources tab when conflicts present', () => {
    const conflicts: Record<string, ConflictView> = {
      pricing: pricingConflict,
    };
    const html = renderToStaticMarkup(
      <MemoryClient
        initialValues={filledValues}
        initialReference="Reference material text"
        isEmpty={false}
        conflicts={conflicts}
      />,
    );
    expect(html).toContain('Reference material text');
  });

  it('tab bar still renders with conflicts present', () => {
    const conflicts: Record<string, ConflictView> = {
      pricing: pricingConflict,
    };
    const html = renderToStaticMarkup(
      <MemoryClient
        initialValues={filledValues}
        initialReference=""
        isEmpty={false}
        conflicts={conflicts}
      />,
    );
    expect(html).toContain('Grove Memory');
    expect(html).toContain('Sources');
  });
});
