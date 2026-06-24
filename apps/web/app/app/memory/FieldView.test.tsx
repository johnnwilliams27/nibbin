/**
 * Task 6 — FieldView component tests.
 *
 * Uses renderToStaticMarkup (no jsdom, no testing-library) per repo convention.
 * Tests cover every descriptor shape from format.ts:
 *  - list → <ul><li> items; single-item list rendered as <p>
 *  - dl   → <dl><dt><dd>
 *  - quote → blockquote element with the text
 *  - paragraphs → <p> per block
 *  - price → tabular-nums span around the number
 *  - empty → faint placeholder text, no <textarea>
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FieldView } from './FieldView';
import type {
  ListDescriptor,
  DlDescriptor,
  QuoteDescriptor,
  ParagraphsDescriptor,
  EmptyDescriptor,
} from './format';

// ---------------------------------------------------------------------------
// list kind
// ---------------------------------------------------------------------------

describe('FieldView — list kind', () => {
  it('renders multiple items as <ul><li>', () => {
    const descriptor: ListDescriptor = {
      kind: 'list',
      items: ['Standard session: $400', 'Mini session: $150'],
    };
    const html = renderToStaticMarkup(
      <FieldView descriptor={descriptor} placeholder="Add your pricing…" />,
    );
    expect(html).toContain('<ul');
    expect(html).toContain('<li');
    expect(html).toContain('Standard session:');
    expect(html).toContain('Mini session:');
  });

  it('renders a single-item list (separator present) as a list', () => {
    // A list with a blank-line separator has 2+ items (one real, one empty)
    const descriptor: ListDescriptor = {
      kind: 'list',
      items: ['Only item', ''],
    };
    const html = renderToStaticMarkup(
      <FieldView descriptor={descriptor} placeholder="Add items…" />,
    );
    expect(html).toContain('<ul');
    expect(html).toContain('Only item');
  });

  it('blank/empty items in list are rendered as visual separators, not <li> text', () => {
    const descriptor: ListDescriptor = {
      kind: 'list',
      items: ['Item A', '', 'Item B'],
    };
    const html = renderToStaticMarkup(
      <FieldView descriptor={descriptor} placeholder="…" />,
    );
    expect(html).toContain('Item A');
    expect(html).toContain('Item B');
    // No <textarea> in view mode
    expect(html).not.toContain('<textarea');
  });
});

// ---------------------------------------------------------------------------
// dl kind
// ---------------------------------------------------------------------------

describe('FieldView — dl kind', () => {
  it('renders label:value pairs as <dl><dt><dd>', () => {
    const descriptor: DlDescriptor = {
      kind: 'dl',
      rows: [
        { dt: 'Location', dd: 'Portland, OR' },
        { dt: 'Founded', dd: '2018' },
      ],
    };
    const html = renderToStaticMarkup(
      <FieldView descriptor={descriptor} placeholder="Add business facts…" />,
    );
    expect(html).toContain('<dl');
    expect(html).toContain('<dt');
    expect(html).toContain('<dd');
    expect(html).toContain('Location');
    expect(html).toContain('Portland, OR');
    expect(html).toContain('Founded');
    expect(html).toContain('2018');
  });

  it('rows with empty dt render only <dd> (freeform lines)', () => {
    const descriptor: DlDescriptor = {
      kind: 'dl',
      rows: [{ dt: '', dd: 'Freeform text here' }],
    };
    const html = renderToStaticMarkup(
      <FieldView descriptor={descriptor} placeholder="…" />,
    );
    expect(html).toContain('Freeform text here');
    expect(html).toContain('<dl');
  });

  it('does not render a <textarea>', () => {
    const descriptor: DlDescriptor = {
      kind: 'dl',
      rows: [{ dt: 'Key', dd: 'Value' }],
    };
    const html = renderToStaticMarkup(
      <FieldView descriptor={descriptor} placeholder="…" />,
    );
    expect(html).not.toContain('<textarea');
  });
});

// ---------------------------------------------------------------------------
// quote kind
// ---------------------------------------------------------------------------

describe('FieldView — quote kind', () => {
  it('renders quote text inside a blockquote element', () => {
    const descriptor: QuoteDescriptor = {
      kind: 'quote',
      text: 'Warm, direct, and never jargon-heavy.',
    };
    const html = renderToStaticMarkup(
      <FieldView descriptor={descriptor} placeholder="Describe your voice…" />,
    );
    expect(html).toContain('<blockquote');
    expect(html).toContain('Warm, direct, and never jargon-heavy.');
  });

  it('carries the quote CSS class on the blockquote', () => {
    const descriptor: QuoteDescriptor = {
      kind: 'quote',
      text: 'Voice sample.',
    };
    const html = renderToStaticMarkup(
      <FieldView descriptor={descriptor} placeholder="…" />,
    );
    // The blockquote must have a class (the .quote CSS module class)
    expect(html).toMatch(/<blockquote[^>]+class/);
  });

  it('does not render a <textarea>', () => {
    const descriptor: QuoteDescriptor = { kind: 'quote', text: 'Some voice.' };
    const html = renderToStaticMarkup(
      <FieldView descriptor={descriptor} placeholder="…" />,
    );
    expect(html).not.toContain('<textarea');
  });
});

// ---------------------------------------------------------------------------
// paragraphs kind
// ---------------------------------------------------------------------------

describe('FieldView — paragraphs kind', () => {
  it('renders each paragraph block as a <p>', () => {
    const descriptor: ParagraphsDescriptor = {
      kind: 'paragraphs',
      blocks: ['First paragraph text.', 'Second paragraph text.'],
    };
    const html = renderToStaticMarkup(
      <FieldView descriptor={descriptor} placeholder="Add notes…" />,
    );
    expect(html).toContain('First paragraph text.');
    expect(html).toContain('Second paragraph text.');
    // Both are <p> elements
    const pCount = (html.match(/<p/g) ?? []).length;
    expect(pCount).toBeGreaterThanOrEqual(2);
  });

  it('preserves single newlines within a block (line break handling)', () => {
    const descriptor: ParagraphsDescriptor = {
      kind: 'paragraphs',
      blocks: ['Line one.\nLine two.'],
    };
    const html = renderToStaticMarkup(
      <FieldView descriptor={descriptor} placeholder="…" />,
    );
    expect(html).toContain('Line one.');
    expect(html).toContain('Line two.');
  });

  it('does not render a <textarea>', () => {
    const descriptor: ParagraphsDescriptor = {
      kind: 'paragraphs',
      blocks: ['Some note.'],
    };
    const html = renderToStaticMarkup(
      <FieldView descriptor={descriptor} placeholder="…" />,
    );
    expect(html).not.toContain('<textarea');
  });
});

// ---------------------------------------------------------------------------
// price detection (tabular-nums span)
// ---------------------------------------------------------------------------

describe('FieldView — price rendering', () => {
  it('wraps a price token in a tabular-nums span inside a list item', () => {
    const descriptor: ListDescriptor = {
      kind: 'list',
      items: ['Standard session: $400', 'Mini: $150'],
    };
    const html = renderToStaticMarkup(
      <FieldView descriptor={descriptor} placeholder="…" />,
    );
    // The $400 number should be in a span carrying the num class (tabular-nums)
    expect(html).toContain('$400');
    expect(html).toContain('$150');
    // A <span> wrapping the price must be present
    expect(html).toContain('<span');
  });

  it('wraps a price in a dl dd value', () => {
    const descriptor: DlDescriptor = {
      kind: 'dl',
      rows: [{ dt: 'Session fee', dd: '$500 per hour' }],
    };
    const html = renderToStaticMarkup(
      <FieldView descriptor={descriptor} placeholder="…" />,
    );
    expect(html).toContain('$500');
    expect(html).toContain('<span');
  });

  it('does not add extra spans when no price present', () => {
    const descriptor: ListDescriptor = {
      kind: 'list',
      items: ['No price here', 'Nor here'],
    };
    const html = renderToStaticMarkup(
      <FieldView descriptor={descriptor} placeholder="…" />,
    );
    // No spurious price spans
    expect(html).not.toContain('<span');
  });
});

// ---------------------------------------------------------------------------
// empty kind
// ---------------------------------------------------------------------------

describe('FieldView — empty kind', () => {
  it('renders faint placeholder text when descriptor is empty', () => {
    const descriptor: EmptyDescriptor = { kind: 'empty' };
    const html = renderToStaticMarkup(
      <FieldView descriptor={descriptor} placeholder="Add your pricing…" />,
    );
    expect(html).toContain('Add your pricing…');
  });

  it('does NOT render a <textarea> in empty/view mode', () => {
    const descriptor: EmptyDescriptor = { kind: 'empty' };
    const html = renderToStaticMarkup(
      <FieldView descriptor={descriptor} placeholder="…" />,
    );
    expect(html).not.toContain('<textarea');
  });

  it('carries a faint/placeholder CSS class on the empty element', () => {
    const descriptor: EmptyDescriptor = { kind: 'empty' };
    const html = renderToStaticMarkup(
      <FieldView descriptor={descriptor} placeholder="Add notes…" />,
    );
    // Must have an element with a class (the .placeholder CSS module class)
    expect(html).toMatch(/class/);
    expect(html).toContain('Add notes…');
  });

  it('renders no <ul>, <dl>, or <blockquote> when empty', () => {
    const descriptor: EmptyDescriptor = { kind: 'empty' };
    const html = renderToStaticMarkup(
      <FieldView descriptor={descriptor} placeholder="…" />,
    );
    expect(html).not.toContain('<ul');
    expect(html).not.toContain('<dl');
    expect(html).not.toContain('<blockquote');
  });
});

// ---------------------------------------------------------------------------
// No inputs in any view mode (locked / read-only contract)
// ---------------------------------------------------------------------------

describe('FieldView — locked read-only contract', () => {
  const cases: Array<{ name: string; descriptor: ListDescriptor | DlDescriptor | QuoteDescriptor | ParagraphsDescriptor | EmptyDescriptor }> = [
    { name: 'list', descriptor: { kind: 'list', items: ['Item'] } },
    { name: 'dl', descriptor: { kind: 'dl', rows: [{ dt: 'K', dd: 'V' }] } },
    { name: 'quote', descriptor: { kind: 'quote', text: 'Voice.' } },
    { name: 'paragraphs', descriptor: { kind: 'paragraphs', blocks: ['Text.'] } },
    { name: 'empty', descriptor: { kind: 'empty' } },
  ];

  for (const { name, descriptor } of cases) {
    it(`${name} kind — no <input>, <textarea>, or <button>`, () => {
      const html = renderToStaticMarkup(
        <FieldView descriptor={descriptor} placeholder="Placeholder." />,
      );
      expect(html).not.toContain('<input');
      expect(html).not.toContain('<textarea');
      expect(html).not.toContain('<button');
    });
  }
});
