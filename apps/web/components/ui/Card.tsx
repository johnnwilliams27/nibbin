import type { HTMLAttributes } from 'react';
import styles from './ui.module.css';

/** Standard canopy card surface (border + soft shadow), token-only. */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={[styles.card, className].filter(Boolean).join(' ')} />;
}
