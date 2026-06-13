import type { ReactNode } from 'react';
import styles from './ui.module.css';

/**
 * Inline success / error message — the over-toast pattern. Success uses
 * role="status" (polite), error uses role="alert" (assertive).
 */
export function InlineFeedback({
  tone,
  children,
}: {
  tone: 'success' | 'error';
  children: ReactNode;
}) {
  const cls = tone === 'success' ? styles.feedbackSuccess : styles.feedbackError;
  return (
    <p className={[styles.feedback, cls].join(' ')} role={tone === 'success' ? 'status' : 'alert'}>
      {children}
    </p>
  );
}
