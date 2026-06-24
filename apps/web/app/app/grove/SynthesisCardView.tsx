'use client';

/**
 * SynthesisCardView — the chat bubble renderer for a SynthesisCard (P5 §8b).
 *
 * Extracted as a dedicated component so that `useState` (open/closed) is held
 * inside a proper React component function and NOT inside a switch case of the
 * parent `CardView`. This satisfies the React hooks rule: hooks must only be
 * called at the top level of a function component.
 *
 * Rendered by: `CardView` (cards.tsx) — the `case 'synthesis'` branch delegates
 * here immediately, keeping CardView itself stateless.
 *
 * Behaviour:
 *   - Default state: modal closed. Only the summary bubble + "View details"
 *     button are visible.
 *   - On "View details": modal opens (SynthesisModal portal).
 *   - On close: modal closes and focus returns to the "View details" button.
 *
 * Accessibility:
 *   - The trigger button is labelled "View details" (visible + aria-label).
 *   - Focus restores to the trigger on modal close via triggerRef.
 */

import { useRef, useState } from 'react';
import type { SynthesisCard } from '@nibbin/keeper';
import { SynthesisModal } from './SynthesisModal';
import styles from './grove.module.css';

export interface SynthesisCardViewProps {
  card: SynthesisCard;
}

export function SynthesisCardView({ card }: SynthesisCardViewProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  function handleOpen() {
    setModalOpen(true);
  }

  function handleClose() {
    setModalOpen(false);
    // Restore focus to the trigger element after the modal closes.
    triggerRef.current?.focus();
  }

  return (
    <div className={styles.synthesisCard}>
      <p className={styles.cardText}>{card.summary}</p>
      <button
        ref={triggerRef}
        type="button"
        className={styles.synthesisDetailBtn}
        aria-label="View details"
        onClick={handleOpen}
      >
        View details
      </button>
      {modalOpen && <SynthesisModal card={card} onClose={handleClose} />}
    </div>
  );
}
