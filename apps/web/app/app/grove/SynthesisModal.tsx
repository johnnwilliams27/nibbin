'use client';

/**
 * SynthesisModal — portal modal for the full synthesis result (P5 §5.4).
 *
 * Renders the full cited prose answer, the citation list (with kind badges),
 * the gap note (when present), and the corpus-count footer.
 *
 * Props: { card: SynthesisCard; onClose: () => void }
 *
 * Accessibility:
 *   - role="dialog", aria-modal="true", aria-label="What I found"
 *   - Focus trap: first focusable element (close button) receives focus on open
 *   - Escape key closes
 *   - Focus is restored to the trigger on close (handled by the parent
 *     SynthesisCardView via a ref passed through context — the onClose callback
 *     manages this at the callsite)
 *
 * Rendering:
 *   - Client-only portal (createPortal → document.body); mounted guard prevents
 *     hydration mismatch. On the server (SSR / renderToStaticMarkup for tests)
 *     the content renders inline — this is the correct React 18 behaviour.
 *   - No server actions, no writes. Read-only.
 *   - Motion: transform/opacity only; reduced-motion query collapses animation.
 *   - Design tokens: CSS module — no raw hex; all colour from shared tokens.
 */

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { SynthesisCard } from '@nibbin/keeper';
import styles from './synthesis-modal.module.css';

export interface SynthesisModalProps {
  card: SynthesisCard;
  onClose: () => void;
}

export function SynthesisModal({ card, onClose }: SynthesisModalProps) {
  const closeRef = useRef<HTMLButtonElement>(null);

  // Focus the close button on mount; restore on unmount is caller's responsibility.
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  // Escape key closes the modal.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const content = (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label="What I found"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles.panel}>
        {/* Header */}
        <div className={styles.header}>
          <h2 className={styles.heading}>What I found</h2>
          <button
            ref={closeRef}
            type="button"
            className={styles.closeBtn}
            aria-label="Close"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        {/* Full cited prose answer */}
        <div className={styles.answerBlock}>
          <p className={styles.answerText}>{card.fullAnswer}</p>
        </div>

        {/* Citations list */}
        {card.citations.length > 0 && (
          <div className={styles.citationsBlock}>
            <h3 className={styles.citationsHeading}>Sources</h3>
            <ul className={styles.citationList}>
              {card.citations.map((c, i) => (
                <li key={`${c.label}-${i}`} className={styles.citationRow}>
                  <span className={styles.citationLabel}>{c.label}</span>
                  <span
                    className={
                      c.kind === 'memory'
                        ? styles.kindBadgeMemory
                        : styles.kindBadgeDoc
                    }
                  >
                    {c.kind === 'memory' ? 'memory' : 'doc'}
                  </span>
                  <span className={styles.citationExcerpt}>&ldquo;{c.excerpt}&rdquo;</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Gap note — omitted when null */}
        {card.gapNote !== null && (
          <div className={styles.gapBlock}>
            <span className={styles.gapLabel}>What I couldn&apos;t find:</span>{' '}
            <span className={styles.gapNote}>{card.gapNote}</span>
          </div>
        )}

        {/* Footer: corpus counts */}
        <div className={styles.footer}>
          From{' '}
          <strong>{card.corpusCounts.memory}</strong>{' '}
          {card.corpusCounts.memory === 1 ? 'memory entry' : 'memory entries'}{' '}
          and{' '}
          <strong>{card.corpusCounts.sources}</strong>{' '}
          {card.corpusCounts.sources === 1 ? 'source' : 'sources'}
        </div>
      </div>
    </div>
  );

  // In a browser, portal to body. On the server (SSR / tests), render inline.
  if (typeof document === 'undefined') {
    return content;
  }
  return createPortal(content, document.body);
}
