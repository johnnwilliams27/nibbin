/**
 * Task 3 — Field formatters: structural plain-text rendering core.
 *
 * Pure, deterministic functions — no React, no DOM, no side effects.
 * Turns raw `grove_memory` field text into a descriptor that rendering
 * components can consume without needing to parse text themselves.
 *
 * Design decisions (spec §6.2 / plan Task 3):
 * - No markdown parser. Derives structure from common patterns only:
 *   - `\n` line splits
 *   - `Label: value` → definition-list rows
 *   - list lines → bullet items (blank lines become separators)
 *   - voice → blockquote passthrough
 *   - paragraphs → split on `\n\n`
 * - Stored blob stays LLM-clean (no HTML injected into `grove_memory`).
 * - Round-trip safe: rendering must not mutate the stored value.
 */

// ---------------------------------------------------------------------------
// Descriptor types
// ---------------------------------------------------------------------------

export type ListDescriptor = {
  kind: 'list';
  /** Each string is a bullet item; empty string = blank-line separator. */
  items: string[];
};

export type DlDescriptor = {
  kind: 'dl';
  /** Each row is a definition-list entry. dt empty = no label (freeform). */
  rows: Array<{ dt: string; dd: string }>;
};

export type QuoteDescriptor = {
  kind: 'quote';
  text: string;
};

export type ParagraphsDescriptor = {
  kind: 'paragraphs';
  /** Each string is a paragraph block; single `\n` inside a block is preserved. */
  blocks: string[];
};

export type EmptyDescriptor = {
  kind: 'empty';
};

export type FieldDescriptor =
  | ListDescriptor
  | DlDescriptor
  | QuoteDescriptor
  | ParagraphsDescriptor
  | EmptyDescriptor;

/** The supported field kinds that drive formatting. */
export type FieldKind = 'list' | 'dl' | 'quote' | 'paragraphs';

// ---------------------------------------------------------------------------
// detectPrice
// ---------------------------------------------------------------------------

export interface PriceSplit {
  /** Text before the first price token. */
  prefix: string;
  /** The `$N[,N]*[.NN]` token, e.g. "$1,200" or "$75.00". */
  number: string;
  /** Text after the price token. */
  suffix: string;
}

/**
 * Detect the first `$` price pattern in `line` and split around it.
 * Returns `null` if no price is found.
 *
 * Matches: `$digits[,digits]*[.digits]`
 * Examples: `$500`, `$1,200`, `$75.00`, `$3,500.00`
 */
export function detectPrice(line: string): PriceSplit | null {
  const PRICE_RE = /\$[\d,]+(?:\.\d+)?/;
  const match = PRICE_RE.exec(line);
  if (!match) return null;
  const start = match.index;
  const end = start + match[0].length;
  return {
    prefix: line.slice(0, start),
    number: line.slice(start, end),
    suffix: line.slice(end),
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isEmpty(raw: string): boolean {
  return raw.trim() === '';
}

function splitLines(raw: string): string[] {
  return raw.split('\n');
}

// ---------------------------------------------------------------------------
// Per-kind formatters
// ---------------------------------------------------------------------------

function formatList(raw: string): FieldDescriptor {
  const lines = splitLines(raw);
  // Trim each line (blank lines become empty strings = separators)
  const items = lines.map((l) => l.trim());

  // Check if there are any non-empty items
  const nonEmpty = items.filter((i) => i !== '');
  if (nonEmpty.length === 0) return { kind: 'empty' };

  // Single non-empty item with no blank separators → feels incomplete as a list
  // Render as paragraphs instead (spec §6.2)
  if (nonEmpty.length === 1 && !items.includes('')) {
    return { kind: 'paragraphs', blocks: [nonEmpty[0]] };
  }

  return { kind: 'list', items };
}

function formatDl(raw: string): FieldDescriptor {
  const lines = splitLines(raw);
  const rows: Array<{ dt: string; dd: string }> = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') {
      // Blank line → separator row
      rows.push({ dt: '', dd: '' });
      continue;
    }

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) {
      // No colon → freeform paragraph row
      rows.push({ dt: '', dd: trimmed });
    } else {
      // Split on first colon only
      const dt = trimmed.slice(0, colonIdx).trim();
      const dd = trimmed.slice(colonIdx + 1).trim();
      rows.push({ dt, dd });
    }
  }

  if (rows.length === 0 || rows.every((r) => r.dt === '' && r.dd === '')) {
    return { kind: 'empty' };
  }

  return { kind: 'dl', rows };
}

function formatQuote(raw: string): FieldDescriptor {
  const text = raw.trim();
  if (!text) return { kind: 'empty' };
  return { kind: 'quote', text };
}

function formatParagraphs(raw: string): FieldDescriptor {
  // Split on one or more consecutive blank lines
  const blocks = raw
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter((b) => b !== '');

  if (blocks.length === 0) return { kind: 'empty' };
  return { kind: 'paragraphs', blocks };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Format a raw grove memory field value into a structured descriptor.
 *
 * @param kind  - The field's display kind, driving which parser to use.
 * @param raw   - The raw stored string (never mutated).
 * @returns     A `FieldDescriptor` the rendering component can consume directly.
 */
export function formatField(kind: FieldKind | string, raw: string): FieldDescriptor {
  if (isEmpty(raw)) return { kind: 'empty' };

  switch (kind) {
    case 'list':
      return formatList(raw);
    case 'dl':
      return formatDl(raw);
    case 'quote':
      return formatQuote(raw);
    case 'paragraphs':
      return formatParagraphs(raw);
    default:
      // Unknown kind: fall back to paragraphs (safe passthrough)
      return formatParagraphs(raw);
  }
}
