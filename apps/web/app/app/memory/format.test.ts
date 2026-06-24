/**
 * Task 3 — Field formatter unit tests (pure functions, no DOM).
 *
 * TDD: write all failing cases first, then implement format.ts green.
 */
import { describe, it, expect } from 'vitest';
import {
  formatField,
  detectPrice,
  type FieldDescriptor,
  type FieldKind,
} from './format';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function listDescriptor(items: string[]): FieldDescriptor {
  return { kind: 'list', items };
}

function dlDescriptor(rows: Array<{ dt: string; dd: string }>): FieldDescriptor {
  return { kind: 'dl', rows };
}

function quoteDescriptor(text: string): FieldDescriptor {
  return { kind: 'quote', text };
}

function paragraphsDescriptor(blocks: string[]): FieldDescriptor {
  return { kind: 'paragraphs', blocks };
}

function emptyDescriptor(): FieldDescriptor {
  return { kind: 'empty' };
}

// ---------------------------------------------------------------------------
// detectPrice
// ---------------------------------------------------------------------------

describe('detectPrice', () => {
  it('returns null when no $ price found', () => {
    expect(detectPrice('No price here')).toBeNull();
  });

  it('splits a simple $N price into prefix, number, suffix', () => {
    const result = detectPrice('Costs $500 per session');
    expect(result).not.toBeNull();
    expect(result!.prefix).toBe('Costs ');
    expect(result!.number).toBe('$500');
    expect(result!.suffix).toBe(' per session');
  });

  it('handles $N,NNN comma-formatted numbers', () => {
    const result = detectPrice('Package: $1,200 total');
    expect(result).not.toBeNull();
    expect(result!.number).toBe('$1,200');
  });

  it('handles $N.NN decimal prices', () => {
    const result = detectPrice('Base rate $75.00/hr');
    expect(result).not.toBeNull();
    expect(result!.number).toBe('$75.00');
  });

  it('handles $N,NNN.NN combined', () => {
    const result = detectPrice('Wedding package $3,500.00 all-in');
    expect(result).not.toBeNull();
    expect(result!.number).toBe('$3,500.00');
  });

  it('matches first price when multiple present', () => {
    const result = detectPrice('$100 or $200 option');
    expect(result).not.toBeNull();
    expect(result!.number).toBe('$100');
    expect(result!.prefix).toBe('');
    expect(result!.suffix).toBe(' or $200 option');
  });

  it('returns null for empty string', () => {
    expect(detectPrice('')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// formatField — empty / whitespace
// ---------------------------------------------------------------------------

describe('formatField — empty input', () => {
  it('blank string → empty descriptor', () => {
    expect(formatField('list', '')).toEqual(emptyDescriptor());
  });

  it('whitespace-only string → empty descriptor', () => {
    expect(formatField('dl', '   \n  \t  ')).toEqual(emptyDescriptor());
  });

  it('empty with kind quote → empty descriptor', () => {
    expect(formatField('quote', '')).toEqual(emptyDescriptor());
  });

  it('empty with kind paragraphs → empty descriptor', () => {
    expect(formatField('paragraphs', '')).toEqual(emptyDescriptor());
  });
});

// ---------------------------------------------------------------------------
// formatField — kind: 'list'   (pricing / policies / faq)
// ---------------------------------------------------------------------------

describe('formatField — list kind', () => {
  it('multiple lines → list descriptor with each line as item', () => {
    const raw = 'Standard session: $400\nMini session: $150\nFull day: $1,200';
    const result = formatField('list', raw);
    expect(result).toEqual(listDescriptor([
      'Standard session: $400',
      'Mini session: $150',
      'Full day: $1,200',
    ]));
  });

  it('single non-empty line → paragraphs descriptor (one item feels incomplete §6.2)', () => {
    const result = formatField('list', 'Only one line here');
    expect(result).toEqual(paragraphsDescriptor(['Only one line here']));
  });

  it('blank lines between items become separator markers (empty string items)', () => {
    const raw = 'Item A\n\nItem B';
    const result = formatField('list', raw) as Extract<FieldDescriptor, { kind: 'list' }>;
    expect(result.kind).toBe('list');
    // blank line produces empty string separator
    expect(result.items).toContain('');
    expect(result.items).toContain('Item A');
    expect(result.items).toContain('Item B');
  });

  it('trims leading/trailing whitespace from each item', () => {
    const raw = '  First item  \n  Second item  ';
    const result = formatField('list', raw) as Extract<FieldDescriptor, { kind: 'list' }>;
    expect(result.kind).toBe('list');
    expect(result.items[0]).toBe('First item');
    expect(result.items[1]).toBe('Second item');
  });

  it('blank-only lines that form all items → empty descriptor', () => {
    expect(formatField('list', '\n\n\n')).toEqual(emptyDescriptor());
  });

  it('three items including blank separator → list kind preserved', () => {
    const raw = 'A\n\nB';
    const result = formatField('list', raw);
    expect(result.kind).toBe('list');
  });
});

// ---------------------------------------------------------------------------
// formatField — kind: 'dl'   (facts)
// ---------------------------------------------------------------------------

describe('formatField — dl kind', () => {
  it('"Label: value" lines → dl descriptor with dt/dd pairs', () => {
    const raw = 'Business model: Photography\nLocation: Portland, OR';
    const result = formatField('dl', raw);
    expect(result).toEqual(dlDescriptor([
      { dt: 'Business model', dd: 'Photography' },
      { dt: 'Location', dd: 'Portland, OR' },
    ]));
  });

  it('lines without a colon → treated as paragraph rows with dt empty, dd = full line', () => {
    const raw = 'Some free text without colon';
    const result = formatField('dl', raw) as Extract<FieldDescriptor, { kind: 'dl' }>;
    expect(result.kind).toBe('dl');
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].dt).toBe('');
    expect(result.rows[0].dd).toBe('Some free text without colon');
  });

  it('mixed lines: some with colon, some without', () => {
    const raw = 'Name: Nibbin\nJust a note\nType: SaaS';
    const result = formatField('dl', raw) as Extract<FieldDescriptor, { kind: 'dl' }>;
    expect(result.kind).toBe('dl');
    expect(result.rows).toHaveLength(3);
    expect(result.rows[0]).toEqual({ dt: 'Name', dd: 'Nibbin' });
    expect(result.rows[1]).toEqual({ dt: '', dd: 'Just a note' });
    expect(result.rows[2]).toEqual({ dt: 'Type', dd: 'SaaS' });
  });

  it('colon with empty value → dt populated, dd empty string', () => {
    const raw = 'Website:';
    const result = formatField('dl', raw) as Extract<FieldDescriptor, { kind: 'dl' }>;
    expect(result.kind).toBe('dl');
    expect(result.rows[0]).toEqual({ dt: 'Website', dd: '' });
  });

  it('multiple colons in a line: splits on first colon only', () => {
    const raw = 'Hours: Mon–Fri: 9am–5pm';
    const result = formatField('dl', raw) as Extract<FieldDescriptor, { kind: 'dl' }>;
    expect(result.kind).toBe('dl');
    expect(result.rows[0]).toEqual({ dt: 'Hours', dd: 'Mon–Fri: 9am–5pm' });
  });

  it('blank line in dl input → empty separator row (dt:"", dd:"")', () => {
    const raw = 'Name: Nibbin\n\nType: SaaS';
    const result = formatField('dl', raw) as Extract<FieldDescriptor, { kind: 'dl' }>;
    expect(result.kind).toBe('dl');
    expect(result.rows).toHaveLength(3);
    expect(result.rows[1]).toEqual({ dt: '', dd: '' });
  });

  it('trims label and value whitespace', () => {
    const raw = '  Key  :  Value  ';
    const result = formatField('dl', raw) as Extract<FieldDescriptor, { kind: 'dl' }>;
    expect(result.rows[0]).toEqual({ dt: 'Key', dd: 'Value' });
  });
});

// ---------------------------------------------------------------------------
// formatField — kind: 'quote'  (voice)
// ---------------------------------------------------------------------------

describe('formatField — quote kind', () => {
  it('any non-empty text → quote descriptor wrapping the text', () => {
    const raw = "We're warm, direct, and never use jargon. Every client is a person, not a project.";
    expect(formatField('quote', raw)).toEqual(quoteDescriptor(raw));
  });

  it('multi-line voice text → quote preserves the full string', () => {
    const raw = 'Line one of voice.\nLine two continues.';
    expect(formatField('quote', raw)).toEqual(quoteDescriptor(raw));
  });

  it('whitespace-padded → trimmed in the quote text', () => {
    const raw = '  warm and direct  ';
    const result = formatField('quote', raw) as Extract<FieldDescriptor, { kind: 'quote' }>;
    expect(result.kind).toBe('quote');
    expect(result.text).toBe('warm and direct');
  });
});

// ---------------------------------------------------------------------------
// formatField — kind: 'paragraphs'  (notes)
// ---------------------------------------------------------------------------

describe('formatField — paragraphs kind', () => {
  it('plain text → single-block paragraphs descriptor', () => {
    const raw = 'Just a note about the business.';
    expect(formatField('paragraphs', raw)).toEqual(paragraphsDescriptor(['Just a note about the business.']));
  });

  it('double newline splits into multiple paragraph blocks', () => {
    const raw = 'First paragraph text.\n\nSecond paragraph text.';
    expect(formatField('paragraphs', raw)).toEqual(
      paragraphsDescriptor(['First paragraph text.', 'Second paragraph text.'])
    );
  });

  it('single newline is preserved within a paragraph block', () => {
    const raw = 'Line one.\nLine two.';
    const result = formatField('paragraphs', raw) as Extract<FieldDescriptor, { kind: 'paragraphs' }>;
    expect(result.kind).toBe('paragraphs');
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0]).toBe('Line one.\nLine two.');
  });

  it('triple newline collapses to a single paragraph break', () => {
    const raw = 'Para one.\n\n\nPara two.';
    const result = formatField('paragraphs', raw) as Extract<FieldDescriptor, { kind: 'paragraphs' }>;
    expect(result.blocks.length).toBe(2);
    expect(result.blocks[0]).toBe('Para one.');
    expect(result.blocks[1]).toBe('Para two.');
  });

  it('trims leading/trailing whitespace from each block', () => {
    const raw = '  First block.  \n\n  Second block.  ';
    const result = formatField('paragraphs', raw) as Extract<FieldDescriptor, { kind: 'paragraphs' }>;
    expect(result.blocks[0]).toBe('First block.');
    expect(result.blocks[1]).toBe('Second block.');
  });

  it('multiple blank lines between paragraphs → still two blocks', () => {
    const raw = 'A\n\n\n\nB';
    const result = formatField('paragraphs', raw) as Extract<FieldDescriptor, { kind: 'paragraphs' }>;
    expect(result.blocks).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// formatField — unknown / pass-through kind
// ---------------------------------------------------------------------------

describe('formatField — unknown kind fallback', () => {
  it('unknown kind with content → paragraphs fallback', () => {
    const result = formatField('unknown_kind' as FieldKind, 'Some text');
    expect(result.kind).toBe('paragraphs');
  });
});

// ---------------------------------------------------------------------------
// Round-trip safety: formatField must not mutate the stored value
// ---------------------------------------------------------------------------

describe('round-trip safety', () => {
  it('the raw string is never mutated by formatField (reference identity preserved)', () => {
    const raw = 'Price: $400\nDeposit: $100';
    const before = raw;
    formatField('dl', raw);
    expect(raw).toBe(before);
  });
});
