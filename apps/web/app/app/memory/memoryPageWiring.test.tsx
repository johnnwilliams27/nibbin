/**
 * Task 7 — Neutral copy sweep + page wiring tests.
 *
 * TDD: written BEFORE implementation changes — tests written to FAIL first.
 *
 * Covers:
 *  1. Default registry + FIELD_CONFIG placeholders contain NONE of the
 *     forbidden photographer-specific substrings (deposit, session, shoot, photograph).
 *     Also checks seedSectionsFromAnswers-derived copy doesn't use "facts" as
 *     the primary key (should use "about").
 *  2. When `metaRows` includes a custom row, MemoryClient activates the dynamic
 *     registry and renders the custom section label — proving the dynamic path is
 *     ACTIVE (not the legacy fallback).
 *  3. When `metaRows` includes a renamed/hidden row, those overrides are reflected
 *     in the rendered output.
 *  4. When `metaRows` is empty, the default registry renders with neutral labels.
 *  5. HardRulesBlock + provenance slot still render (coral block present).
 */

import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryClient } from './MemoryClient';
import { DEFAULT_SECTIONS } from '../../../lib/grove/memory-sections';
import { FIELD_CONFIG } from './fields';
import { buildSectionRegistry, type FieldMetaRow } from './registry';

// ---------------------------------------------------------------------------
// Forbidden photographer-specific substrings
// ---------------------------------------------------------------------------

const FORBIDDEN = ['deposit', 'session', 'shoot', 'photograph'];

// ---------------------------------------------------------------------------
// 1. Default copy sweep — no forbidden substrings in defaults
// ---------------------------------------------------------------------------

describe('Task 7: neutral copy sweep — no photographer-specific copy in defaults', () => {
  it('DEFAULT_SECTIONS placeholders contain no forbidden substrings', () => {
    for (const section of DEFAULT_SECTIONS) {
      const combined = `${section.label} ${section.placeholder ?? ''} ${section.hint ?? ''}`.toLowerCase();
      for (const forbidden of FORBIDDEN) {
        expect(
          combined,
          `Section "${section.key}" contains forbidden word "${forbidden}" in: "${combined}"`,
        ).not.toContain(forbidden);
      }
    }
  });

  it('FIELD_CONFIG placeholders contain no forbidden substrings', () => {
    for (const [key, config] of Object.entries(FIELD_CONFIG)) {
      const combined = `${config.label} ${config.placeholder ?? ''} ${config.hint ?? ''}`.toLowerCase();
      for (const forbidden of FORBIDDEN) {
        expect(
          combined,
          `FIELD_CONFIG["${key}"] contains forbidden word "${forbidden}" in: "${combined}"`,
        ).not.toContain(forbidden);
      }
    }
  });

  it('rendered default registry HTML contains no forbidden substrings', () => {
    // Render MemoryClient with empty metaRows (uses defaults)
    const defaultMetaRows: FieldMetaRow[] = [];
    const html = renderToStaticMarkup(
      <MemoryClient
        initialValues={{ about: 'Test business' }}
        initialReference=""
        isEmpty={false}
        metaRows={defaultMetaRows}
      />,
    );
    const lower = html.toLowerCase();
    for (const forbidden of FORBIDDEN) {
      // Exclude user-provided values by checking only default label/placeholder areas
      // We check the full rendered HTML (the defaults should not contain forbidden words)
      // Note: user-supplied values in initialValues can contain these — but our defaults must not
      expect(lower, `Rendered HTML contains forbidden word "${forbidden}"`).not.toContain(forbidden);
    }
  });

  it('buildSectionRegistry with empty metaRows uses neutral default labels', () => {
    const registry = buildSectionRegistry([]);
    const labels = registry.map((s) => s.label.toLowerCase());
    // All labels should be neutral (no photography-specific copy)
    for (const label of labels) {
      for (const forbidden of FORBIDDEN) {
        expect(label, `Default label "${label}" contains forbidden word "${forbidden}"`).not.toContain(forbidden);
      }
    }
    // Verify the neutral default keys are present
    const keys = registry.map((s) => s.key);
    expect(keys).toContain('about');
    expect(keys).toContain('offering');
    expect(keys).toContain('voice');
    expect(keys).not.toContain('facts'); // legacy key must not be a default section
  });
});

// ---------------------------------------------------------------------------
// 2. Dynamic path activation — metaRows drive rendering
// ---------------------------------------------------------------------------

describe('Task 7: dynamic path activation via metaRows', () => {
  it('renders a custom section label when metaRows includes a custom row', () => {
    const metaRows: FieldMetaRow[] = [
      {
        field_key: 'c_brand_guidelines',
        label: 'Brand guidelines',
        sort_order: 500,
        is_custom: true,
        is_hidden: false,
      },
    ];
    // Values include the custom field
    const values: Record<string, string> = {
      about: 'We are a creative studio.',
      c_brand_guidelines: 'Primary colour: teal',
    };
    const html = renderToStaticMarkup(
      <MemoryClient
        initialValues={values}
        initialReference=""
        isEmpty={false}
        metaRows={metaRows}
      />,
    );
    // The custom section label must appear — proving the dynamic path is active
    expect(html).toContain('Brand guidelines');
    // The custom value must also render
    expect(html).toContain('Primary colour: teal');
  });

  it('does NOT render a hidden section when metaRows marks it is_hidden:true', () => {
    const metaRows: FieldMetaRow[] = [
      {
        field_key: 'policies',
        label: null,
        sort_order: 1000,
        is_custom: false,
        is_hidden: true,
      },
    ];
    const values: Record<string, string> = {
      about: 'We are a creative studio.',
      policies: 'Contracts required',
    };
    const html = renderToStaticMarkup(
      <MemoryClient
        initialValues={values}
        initialReference=""
        isEmpty={false}
        metaRows={metaRows}
      />,
    );
    // The policies label should NOT appear when hidden
    // (Note: other text like 'Policies' might appear but the section's label "Policies" should not)
    // We check the section header is not rendered by the dynamic registry
    // The policies VALUE ('Contracts required') should also not appear (field not rendered)
    expect(html).not.toContain('Contracts required');
  });

  it('renders a renamed section with the override label, not the default', () => {
    const metaRows: FieldMetaRow[] = [
      {
        field_key: 'voice',
        label: 'House voice & style',
        sort_order: 600,
        is_custom: false,
        is_hidden: false,
      },
    ];
    const values: Record<string, string> = {
      about: 'We are a creative studio.',
      voice: 'Clear, direct, and human.',
    };
    const html = renderToStaticMarkup(
      <MemoryClient
        initialValues={values}
        initialReference=""
        isEmpty={false}
        metaRows={metaRows}
      />,
    );
    // The renamed label must appear
    expect(html).toContain('House voice');
  });

  it('activates dynamic path: "about" field renders, not "facts"', () => {
    const metaRows: FieldMetaRow[] = [
      {
        field_key: 'about',
        label: null,
        sort_order: 100,
        is_custom: false,
        is_hidden: false,
      },
    ];
    const values: Record<string, string> = {
      about: 'Our business description here.',
    };
    const html = renderToStaticMarkup(
      <MemoryClient
        initialValues={values}
        initialReference=""
        isEmpty={false}
        metaRows={metaRows}
      />,
    );
    // The 'about' value should appear
    expect(html).toContain('Our business description here.');
    // The default label for about is 'About us'
    expect(html).toContain('About us');
  });
});

// ---------------------------------------------------------------------------
// 3. Coral HardRulesBlock + provenance slot still render
// ---------------------------------------------------------------------------

describe('Task 7: coral HardRulesBlock + Reference still render with dynamic path', () => {
  it('HardRulesBlock coral eyebrow still renders with metaRows', () => {
    const metaRows: FieldMetaRow[] = [
      {
        field_key: 'about',
        label: null,
        sort_order: 100,
        is_custom: false,
        is_hidden: false,
      },
    ];
    const values: Record<string, string> = {
      about: 'Creative studio.',
      hard_rules: 'Never promise a timeline without checking',
    };
    const html = renderToStaticMarkup(
      <MemoryClient
        initialValues={values}
        initialReference=""
        isEmpty={false}
        metaRows={metaRows}
      />,
    );
    // Coral HardRulesBlock eyebrow must always render
    expect(html).toContain('HARD RULES');
    // The hard rule value must appear
    expect(html).toContain('Never promise a timeline without checking');
  });

  it('Reference catch-all section renders in Sources tab with dynamic path', () => {
    const metaRows: FieldMetaRow[] = [];
    const html = renderToStaticMarkup(
      <MemoryClient
        initialValues={{ about: 'Test' }}
        initialReference="Catch-all reference text here"
        isEmpty={false}
        metaRows={metaRows}
      />,
    );
    // Sources tab panel renders (even if hidden by default)
    // The reference text is in the Sources panel
    expect(html).toContain('Catch-all reference text here');
  });
});

// ---------------------------------------------------------------------------
// 4. seedSectionsFromAnswers seeds "about" not "facts"
// ---------------------------------------------------------------------------

// We test this via the pure logic. The actual function is in page.tsx (server
// component), so we test the expected behavior: after Task 7 changes,
// seedSectionsFromAnswers should return { about: '...' } not { facts: '...' }.
// We import and test it directly from a unit-test-friendly module or test the
// principle via registry.
//
// Since page.tsx is a server component and not unit-testable directly, we assert
// the forwardMapLegacy behavior: if someone stored `facts`, `about` is populated
// via the legacy forward map (proving that stored legacy facts are handled).

import { forwardMapLegacy } from './registry';
import { seedSectionsFromAnswers } from './seedSections';

// ---------------------------------------------------------------------------
// 4a. seedSectionsFromAnswers seeds "about" not "facts"
// ---------------------------------------------------------------------------

describe('Task 7: seedSectionsFromAnswers seeds about not facts', () => {
  it('returns { about: ... } when seeding from _profile answers', () => {
    const answers = {
      _profile: {
        jobTitle: 'Brand strategist',
        channels: 'Instagram, email',
        businessModel: 'project',
        workShape: 'Strategy & design sprints',
        tools: 'Figma, Notion',
        pains: 'Admin overhead',
      },
    };
    const result = seedSectionsFromAnswers(answers);
    // Must seed into 'about', NOT 'facts'
    expect(result).toHaveProperty('about');
    expect(result['about']).toContain('Brand strategist');
    expect(result).not.toHaveProperty('facts');
  });

  it('returns { about: ... } when seeding from legacy scalars', () => {
    const answers = {
      craft: 'Graphic design',
      timeSinks: 'Invoicing',
      channels: 'Website, referrals',
    };
    const result = seedSectionsFromAnswers(answers);
    expect(result).toHaveProperty('about');
    expect(result['about']).toContain('Graphic design');
    expect(result).not.toHaveProperty('facts');
  });

  it('returns {} when answers has no recognizable fields', () => {
    const result = seedSectionsFromAnswers({});
    expect(result).toEqual({});
  });

  it('skips businessModel when it equals "unknown"', () => {
    const answers = {
      _profile: {
        jobTitle: 'Consultant',
        businessModel: 'unknown',
      },
    };
    const result = seedSectionsFromAnswers(answers);
    expect(result['about']).toContain('Consultant');
    expect(result['about']).not.toContain('unknown');
  });
});

describe('Task 7: forwardMapLegacy for legacy facts→about', () => {
  it('maps stored facts to about field when about is absent', () => {
    // Simulates a user who had data stored under "facts" before the migration
    const storedValues = {
      facts: 'What I do: Brand strategy\nChannels: Instagram, email',
      pricing: 'Starting at $2,000',
    };
    const result = forwardMapLegacy(storedValues);
    // about should be populated from facts
    expect(result['about']).toBe('What I do: Brand strategy\nChannels: Instagram, email');
    // facts key is still retained (non-destructive)
    expect(result['facts']).toBe('What I do: Brand strategy\nChannels: Instagram, email');
  });

  it('does not overwrite existing about content with legacy facts', () => {
    const storedValues = {
      facts: 'Old seeded data',
      about: 'User-curated about section',
    };
    const result = forwardMapLegacy(storedValues);
    expect(result['about']).toBe('User-curated about section');
  });
});
