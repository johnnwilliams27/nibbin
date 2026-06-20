import type { ReactNode } from "react";
import styles from "./empty-state.module.css";

export interface EmptyStateProps {
  /** Bold heading — tell the user what's not here yet. */
  title: string;
  /** Soft supporting copy — Nibbin voice, one or two sentences max. */
  body: string;
  /** Optional CTA rendered below the body (a Button, link, or any node). */
  action?: ReactNode;
}

/**
 * Designed empty state — centered block with the Nibbin sprout mark,
 * a bold title, a soft body line, and an optional action node.
 *
 * Token-only styling; max-width constrained so it never sprawls.
 * Server-component safe — no client state.
 *
 * @example
 * <EmptyState
 *   title="Nothing here yet"
 *   body="Your nibbin will surface things worth noticing. Give it a moment."
 *   action={<Button variant="secondary" onClick={onConnect}>Connect a source</Button>}
 * />
 */
export function EmptyState({ title, body, action }: EmptyStateProps) {
  return (
    <div className={styles.root}>
      {/* Nibbin sprout mark — inlined from packages/shared/brand/nibbin-mark.svg */}
      <svg
        className={styles.mark}
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 72 72"
        role="img"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <linearGradient id="esStem" x1="0" y1="0.1" x2="1" y2="0.2">
            <stop offset="0%" stopColor="#6E9136" />
            <stop offset="52%" stopColor="#4C6E24" />
            <stop offset="100%" stopColor="#34471A" />
          </linearGradient>
          <linearGradient id="esLeafL" x1="0.05" y1="0.05" x2="0.7" y2="1">
            <stop offset="0%" stopColor="#7CA23E" />
            <stop offset="100%" stopColor="#46651F" />
          </linearGradient>
          <linearGradient id="esLeafR" x1="0.1" y1="0" x2="0.7" y2="1">
            <stop offset="0%" stopColor="#A6D45F" />
            <stop offset="100%" stopColor="#5E8A2C" />
          </linearGradient>
          <filter id="esShadow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="1.3" />
          </filter>
        </defs>
        <ellipse cx="38.5" cy="66.5" rx="11" ry="2.6" fill="#23291A" opacity=".18" filter="url(#esShadow)" />
        <path d="M32 66 C33 52 35 40 36 30 L40 30 C41.4 40 43.4 52 44.6 66 Z" fill="url(#esStem)" stroke="#3C541C" strokeWidth="2.2" strokeLinejoin="round" />
        <path d="M34.4 64 C35 52 36.2 41 37 31" fill="none" stroke="#CFE79C" strokeWidth="1.6" strokeLinecap="round" opacity=".5" />
        <path d="M42.6 64 C42 52 40.9 41 39.7 31.5" fill="none" stroke="#26380F" strokeWidth="1.8" strokeLinecap="round" opacity=".32" />
        <path d="M37.4 31 C26 32 14 27 11 16.5 C22 14 33 20.5 37.4 31 Z" fill="url(#esLeafL)" stroke="#3C541C" strokeWidth="2.2" strokeLinejoin="round" />
        <path d="M35 29.5 C27 28 18 24 12.5 17.5" fill="none" stroke="#3C541C" strokeWidth="1.1" opacity=".38" />
        <path d="M34 27 C26.5 25.5 19 22 14 18" fill="none" stroke="#CFE79C" strokeWidth="1" opacity=".5" />
        <path d="M39 31 C49.5 28.5 57.5 20 59.5 10 C48.5 8.5 41 18 39 31 Z" fill="url(#esLeafR)" stroke="#3C541C" strokeWidth="2.2" strokeLinejoin="round" />
        <path d="M41 29.5 C48 26.5 54 21.5 58 12" fill="none" stroke="#46651F" strokeWidth="1.1" opacity=".38" />
        <path d="M41.5 27 C47.5 24 52.5 20 56 13" fill="none" stroke="#DCEEB4" strokeWidth="1" opacity=".55" />
      </svg>

      <p className={styles.title}>{title}</p>
      <p className={styles.body}>{body}</p>

      {action && <div className={styles.action}>{action}</div>}
    </div>
  );
}
