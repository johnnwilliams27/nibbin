/**
 * Task 6 — FieldView: formatted, locked (read-only) display of a curated field.
 *
 * Consumes a FieldDescriptor from format.ts and renders the appropriate
 * structural HTML. This component is intentionally read-only — no inputs,
 * no edit affordances (those live in Task 7's FieldEditor).
 *
 * Rendering rules (spec §6.2 / plan Task 6):
 *  - list     → <ul><li> per item; blank items render as a visual separator gap
 *  - dl       → <dl><dt><dd> per row; rows with empty dt render only <dd>
 *  - quote    → <blockquote> with the full voice text
 *  - paragraphs → <p> per block; single \n within a block is preserved as <br>
 *  - empty    → faint placeholder <p> carrying the placeholder CSS class
 *
 * Price detection: any item or dd value containing a $N price gets the number
 * wrapped in a <span> carrying tabular-nums styling for visual emphasis (§6.2).
 *
 * Server-renderable: no 'use client' — this is a pure presentational component
 * with no browser APIs and no interactivity.
 */

import React from 'react';
import type { FieldDescriptor, PriceSplit } from './format';
import { detectPrice } from './format';
import styles from './memory.module.css';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface FieldViewProps {
  /** Structured descriptor produced by formatField() from format.ts. */
  descriptor: FieldDescriptor;
  /**
   * Placeholder text shown (faintly) when the descriptor is empty.
   * Sourced from FIELD_CONFIG[key].placeholder.
   */
  placeholder: string;
}

// ---------------------------------------------------------------------------
// Price-split rendering helper
// ---------------------------------------------------------------------------

/**
 * Renders a text string, wrapping the first detected price in a
 * tabular-nums <span> for visual emphasis. Returns a single React node.
 */
function PriceText({ text }: { text: string }): React.ReactElement {
  const split: PriceSplit | null = detectPrice(text);
  if (!split) {
    return <>{text}</>;
  }
  return (
    <>
      {split.prefix}
      <span className={styles.num}>{split.number}</span>
      {split.suffix}
    </>
  );
}

// ---------------------------------------------------------------------------
// Paragraph lines helper (single \n → <br>)
// ---------------------------------------------------------------------------

/**
 * Renders a paragraph block, converting single `\n` characters to `<br />`.
 * Double newlines should already have been split into separate blocks by
 * formatField — this only handles intra-block line breaks.
 */
function ParagraphBlock({ text }: { text: string }): React.ReactElement {
  const lines = text.split('\n');
  return (
    <p className={styles.para}>
      {lines.map((line, i) => (
        <React.Fragment key={i}>
          {i > 0 && <br />}
          {line}
        </React.Fragment>
      ))}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Per-kind renderers
// ---------------------------------------------------------------------------

function ListView({
  items,
}: {
  items: string[];
}): React.ReactElement {
  return (
    <ul className={styles.list}>
      {items.map((item, i) => {
        if (item === '') {
          // Blank item = visual separator gap (rendered as an empty li with separator class)
          return <li key={i} className={styles.listSep} aria-hidden="true" />;
        }
        return (
          <li key={i} className={styles.listItem}>
            <PriceText text={item} />
          </li>
        );
      })}
    </ul>
  );
}

function DlView({ rows }: { rows: Array<{ dt: string; dd: string }> }): React.ReactElement {
  return (
    <dl className={styles.dl}>
      {rows.map((row, i) => {
        // Blank separator row (both dt and dd empty)
        if (row.dt === '' && row.dd === '') {
          return <div key={i} className={styles.dlSep} aria-hidden="true" />;
        }
        // Freeform row (no label)
        if (row.dt === '') {
          return (
            <div key={i} className={styles.dlRow}>
              <dd className={styles.dd}>
                <PriceText text={row.dd} />
              </dd>
            </div>
          );
        }
        // Normal label: value row
        return (
          <div key={i} className={styles.dlRow}>
            <dt className={styles.dt}>{row.dt}</dt>
            <dd className={styles.dd}>
              <PriceText text={row.dd} />
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function QuoteView({ text }: { text: string }): React.ReactElement {
  return (
    <blockquote className={styles.quote}>
      <p>{text}</p>
    </blockquote>
  );
}

function ParagraphsView({ blocks }: { blocks: string[] }): React.ReactElement {
  return (
    <div className={styles.paragraphs}>
      {blocks.map((block, i) => (
        <ParagraphBlock key={i} text={block} />
      ))}
    </div>
  );
}

function EmptyView({ placeholder }: { placeholder: string }): React.ReactElement {
  return (
    <p className={styles.placeholder}>{placeholder}</p>
  );
}

// ---------------------------------------------------------------------------
// FieldView — main export
// ---------------------------------------------------------------------------

/**
 * Formatted, locked (read-only) display of a curated grove memory field.
 *
 * This component renders the structured content derived by formatField()
 * and is intentionally free of any input elements or edit affordances.
 * The view/edit toggle lives in Task 8's FieldBlock.
 */
export function FieldView({ descriptor, placeholder }: FieldViewProps): React.ReactElement {
  switch (descriptor.kind) {
    case 'list':
      return <ListView items={descriptor.items} />;
    case 'dl':
      return <DlView rows={descriptor.rows} />;
    case 'quote':
      return <QuoteView text={descriptor.text} />;
    case 'paragraphs':
      return <ParagraphsView blocks={descriptor.blocks} />;
    case 'empty':
      return <EmptyView placeholder={placeholder} />;
  }
}
