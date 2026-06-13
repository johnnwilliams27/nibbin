import type { HTMLAttributes } from 'react';
import styles from './ui.module.css';

type Tone = 'neutral' | 'moss' | 'honey' | 'coral' | 'sky';

const toneClass: Record<Tone, string> = {
  neutral: styles.badgeNeutral,
  moss: styles.badgeMoss,
  honey: styles.badgeHoney,
  coral: styles.badgeCoral,
  sky: styles.badgeSky,
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
}

/** Semantic tinted badge — the tray pattern borrowed from Vantor, reskinned. */
export function Badge({ tone = 'neutral', className, ...props }: BadgeProps) {
  return (
    <span
      {...props}
      className={[styles.badge, toneClass[tone], className].filter(Boolean).join(' ')}
    />
  );
}
