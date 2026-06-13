import styles from './ui.module.css';

/** Minimal token-only spinner for pending states. */
export function Spinner({ label = 'Loading' }: { label?: string }) {
  return <span className={styles.spinner} role="status" aria-label={label} />;
}
