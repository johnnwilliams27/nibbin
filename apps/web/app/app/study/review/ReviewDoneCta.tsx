/**
 * "Done — save what I kept" CTA for the Field Study review surface (P3 Task 7).
 *
 * Prop-driven (no hooks) so it is server-component-safe and testable via
 * renderToStaticMarkup without jsdom.  The client page wires in the async
 * handleDone() via the onDone prop.
 *
 * Design: primary Button, disabled + "Learning…" label while finalizing.
 * No blocking spinner — the button triggers the fire-and-forget finalize and
 * navigates immediately (the Memory page shows the banner when proposals land).
 */

import { Button } from '../../../../components/ui';
import styles from '../../../../components/study/study.module.css';

export interface ReviewDoneCtaProps {
  /** True while finalizeReview() is in flight (button disabled + alt label). */
  finalizing: boolean;
  /** Called when the button is clicked. The page provides handleDone(). */
  onDone: () => void;
}

export function ReviewDoneCta({ finalizing, onDone }: ReviewDoneCtaProps) {
  return (
    <div className={styles.startActions} style={{ marginTop: 28 }}>
      <Button
        variant="primary"
        onClick={onDone}
        disabled={finalizing}
      >
        {finalizing ? 'Learning from your study…' : 'Done — save what I kept'}
      </Button>
    </div>
  );
}
