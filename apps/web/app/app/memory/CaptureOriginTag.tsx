/**
 * CaptureOriginTag — drop-in origin label for the F2 proposal review queue.
 *
 * P3 Task 8 (capture-origin tag). Self-contained; depends only on design tokens.
 * Mount point for P1: render one <CaptureOriginTag origin={p.origin} studyId={studyId} />
 * per proposal card in the F2 review queue.
 *
 * Keys off proposal.origin. When origin='capture' it renders "From your Field Study"
 * with a deep-link back to /app/study. All other origins get a short human label
 * with no study link. Renders nothing when origin is absent/falsy (graceful for
 * older proposal rows).
 *
 * §5.2 framing: "learns by watching" — the label connects the suggestion back to
 * the passive observation source without surfacing any raw captured content.
 */

import styles from './capture-tag.module.css';

/** Human-readable label for each proposal origin value. */
export function originLabel(origin: string): string {
  switch (origin) {
    case 'capture':
      return 'From your Field Study';
    case 'doc_extract':
      return 'From a document';
    case 'collate':
      return 'From your activity';
    case 'connector':
      return 'From a connected app';
    case 'conflict':
      return 'Conflict resolution';
    case 'manual':
      return 'Added manually';
    default:
      return 'Suggested';
  }
}

export interface CaptureOriginTagProps {
  /** The proposal's origin field (e.g. 'capture', 'doc_extract'). */
  origin: string;
  /**
   * For capture-origin proposals: the study_id from sources.origin.study_id,
   * used to construct the deep-link back to the Field Study page.
   */
  studyId?: string;
}

/**
 * Renders a small origin label badge for a proposal.
 * Returns null when origin is absent so it is safe to unconditionally render.
 */
export function CaptureOriginTag({ origin, studyId }: CaptureOriginTagProps) {
  if (!origin) return null;

  const label = originLabel(origin);
  const isCapture = origin === 'capture';

  if (isCapture) {
    // Deep-link: /app/study (with optional studyId anchor if available)
    const href = studyId ? `/app/study?study_id=${encodeURIComponent(studyId)}` : '/app/study';
    return (
      <span className={styles.tag} data-origin="capture">
        <a
          href={href}
          className={styles.tagLink}
          title="View your Field Study"
          aria-label="From your Field Study — view the study"
        >
          {label}
        </a>
      </span>
    );
  }

  return (
    <span className={styles.tag} data-origin={origin}>
      {label}
    </span>
  );
}
