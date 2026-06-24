/**
 * DockBadge — pure presentational component for the Keeper-dock red-bubble.
 *
 * No hooks. Renders nothing when unread is 0. Testable via renderToStaticMarkup.
 * Used by AppShell on both panelExpand (desktop tab) and panelToggle (mobile FAB).
 *
 * §10.3 — the unread count always comes from AppShell's shared state, which is
 * seeded by a single listLeaves() fetch on mount. The same value is passed to
 * NotificationBell as initialUnread. Bell and dock always show the same number.
 */
import styles from './shell.module.css';
import { formatBadgeCount } from './dock-badge';

export interface DockBadgeProps {
  unread: number;
}

export function DockBadge({ unread }: DockBadgeProps) {
  const label = formatBadgeCount(unread);
  if (!label) return null;
  return (
    <span className={styles.dockBadge} aria-label={`${unread} unread`}>
      {label}
    </span>
  );
}
