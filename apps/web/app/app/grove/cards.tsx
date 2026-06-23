'use client';

/**
 * Card renderers for the dialogue stream (§4.2: rich cards over text, plain
 * prose the fallback, transcript parity for every card). Everything renders
 * as real text through React — no raw HTML path exists here.
 *
 * scan_finding / recommendation / draft_approval / field_notes / chart are
 * typed in @nibbin/keeper now and start appearing at M4; until then they get
 * a generic field-card rendering so nothing ever falls off the stream.
 *
 * synthesis (P5 §8b): delegates to SynthesisCardView (a dedicated component
 * that holds useState for the modal open/close). Hooks must NOT be placed
 * inside a switch case — the extracted component satisfies the React hooks rule.
 */
import type { KeeperCard } from '@nibbin/keeper';
import { SynthesisCardView } from './SynthesisCardView';
import styles from './grove.module.css';

export function CardView({ card }: { card: KeeperCard }) {
  switch (card.kind) {
    case 'prose':
      return <p className={styles.cardText}>{card.text}</p>;

    case 'question':
      return <p className={styles.cardText}>{card.prompt}</p>;

    case 'celebration':
      return (
        <div className={styles.celebrationInner}>
          <strong className={styles.celebrationTitle}>{card.title}</strong>
          {card.detail !== '' && <p className={styles.cardText}>{card.detail}</p>}
        </div>
      );

    case 'scan_finding':
      return (
        <div>
          <strong className={styles.fieldTitle}>{card.title}</strong>
          {card.stat && (
            <p className={styles.fieldStat}>
              <span className={styles.fieldStatValue}>{card.stat.value}</span> {card.stat.label}
            </p>
          )}
          <p className={styles.cardText}>{card.detail}</p>
        </div>
      );

    case 'recommendation':
      return (
        <div>
          <strong className={styles.fieldTitle}>{card.title}</strong>
          <p className={styles.fieldStat}>{card.math}</p>
          <p className={styles.cardText}>{card.detail}</p>
        </div>
      );

    case 'draft_approval':
      return (
        <div>
          <strong className={styles.fieldTitle}>
            {card.specialistName} — {card.title}
          </strong>
          <p className={styles.cardText}>{card.draft}</p>
        </div>
      );

    case 'field_notes':
      return (
        <div>
          <strong className={styles.fieldTitle}>{card.title}</strong>
          <p className={styles.cardText}>{card.detail}</p>
        </div>
      );

    case 'chart': {
      const max = Math.max(1, ...card.points.map((p) => p.value));
      return (
        <div>
          <strong className={styles.fieldTitle}>{card.label}</strong>
          <ul className={styles.chartList}>
            {card.points.map((p) => (
              <li key={p.label} className={styles.chartRow}>
                <span className={styles.chartLabel}>{p.label}</span>
                <span className={styles.chartBarTrack} aria-hidden="true">
                  <span className={styles.chartBar} style={{ width: `${(p.value / max) * 100}%` }} />
                </span>
                <span className={styles.chartValue}>{p.value}</span>
              </li>
            ))}
          </ul>
        </div>
      );
    }

    case 'synthesis':
      // Delegates to a dedicated component — useState (modal open/close) must
      // live inside a component function, not inside a switch case.
      return <SynthesisCardView card={card} />;

    default:
      // Exhaustive today; transcript is the contract if a new kind outpaces a renderer.
      return <p className={styles.cardText}>{(card as KeeperCard).transcript}</p>;
  }
}
