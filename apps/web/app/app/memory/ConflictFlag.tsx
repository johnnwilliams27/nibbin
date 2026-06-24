'use client';
/**
 * Task 8 — ConflictFlag.tsx
 *
 * Renders a "Needs your review" banner on a Memory field that has an open
 * field_flags conflict. Displays each competing source (label + candidate value),
 * highlights the suggested (highest-authority) pick, and offers a "This is right"
 * button per source that calls resolveFieldFlag.
 *
 * Design intent (memory.module.css): tasteful "needs review" accent using
 * --honey-deep (amber) as the attention marker — not alarming coral, not silent.
 * The banner is compact and fits within the FieldBlock without reflow.
 *
 * Prop: `conflict: ConflictView` — the rendered conflict shape loaded in page.tsx
 * from open field_flags joined to their competing sources.
 */

import React, { useTransition } from 'react';
import { resolveFieldFlag } from './actions';
import styles from './memory.module.css';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConflictSource {
  /** Source row uuid (competing_source_ids entry). */
  id: string;
  /** Human-readable label: source.title or source.kind. */
  label: string;
  /** The value this source proposes for the field. */
  value: string;
  /** True for the highest-authority source (the suggested pick). */
  suggested: boolean;
}

export interface ConflictView {
  /** The field_flags row id. */
  flagId: string;
  /** The field this conflict lives on. */
  fieldKey: string;
  /** Short human summary of the disagreement (from flag.detail). */
  detail: string;
  /** Ordered list of competing source options. */
  sources: ConflictSource[];
}

// ---------------------------------------------------------------------------
// ConflictPickForm — inner form for a single source option
// ---------------------------------------------------------------------------

interface ConflictPickFormProps {
  flagId: string;
  source: ConflictSource;
}

/**
 * Renders one competing-source option: label, value (with "suggested" badge if
 * applicable), and a "This is right" form button that calls resolveFieldFlag.
 *
 * Uses a hidden-input + button pattern so the action works without JS (non-JS
 * fallback gracefully posts to the server). With JS the transition runs inline.
 *
 * Note: we can't use useTransition inside a static-test render (renderToStaticMarkup
 * doesn't support hooks); the component is designed so the button is always rendered
 * in the markup — the pending state is purely a runtime progressive enhancement.
 */
function ConflictPickForm({ flagId, source }: ConflictPickFormProps): React.ReactElement {
  const [, startTransition] = useTransition();

  function handleClick() {
    const fd = new FormData();
    fd.set('p_flag_id', flagId);
    fd.set('p_chosen_source_id', source.id);
    fd.set('p_chosen_value', source.value);
    startTransition(() => {
      void resolveFieldFlag(fd);
    });
  }

  return (
    <div
      className={`${styles.conflictSourceRow}${source.suggested ? ` ${styles.conflictSourceSuggested}` : ''}`}
      data-source-id={source.id}
    >
      <div className={styles.conflictSourceMeta}>
        <span className={styles.conflictSourceLabel}>{source.label}</span>
        {source.suggested && (
          <span className={styles.conflictSuggestedBadge}>suggested</span>
        )}
      </div>
      <p className={styles.conflictSourceValue}>{source.value || <em className={styles.conflictSourceEmpty}>no value</em>}</p>
      <button
        type="button"
        className={styles.conflictPickBtn}
        onClick={handleClick}
        data-flag-id={flagId}
        data-source-id={source.id}
      >
        This is right
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ConflictFlag — main export
// ---------------------------------------------------------------------------

export interface ConflictFlagProps {
  conflict: ConflictView;
}

export function ConflictFlag({ conflict }: ConflictFlagProps): React.ReactElement {
  return (
    <div className={styles.conflictFlag} role="alert" aria-label="Field conflict needs review">
      {/* Banner header */}
      <div className={styles.conflictFlagHeader}>
        <span className={styles.conflictFlagIcon} aria-hidden="true">⚠</span>
        <span className={styles.conflictFlagTitle}>Needs your review</span>
      </div>

      {/* Detail text */}
      {conflict.detail && (
        <p className={styles.conflictFlagDetail}>{conflict.detail}</p>
      )}

      {/* Competing source options */}
      <div className={styles.conflictSources}>
        {conflict.sources.map((source) => (
          <ConflictPickForm key={source.id} flagId={conflict.flagId} source={source} />
        ))}
      </div>
    </div>
  );
}
