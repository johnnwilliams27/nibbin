/**
 * Pure seam for the Keeper-dock red-bubble (Task 5 — §10.3 single source of truth).
 *
 * Keeping the count-format logic here (instead of inlined in JSX) lets vitest
 * unit-test it without a DOM or react renderer — the function is a pure mapping.
 * The DockBadge component (dock-badge.tsx) references this too, so both the
 * component and AppShell derive from the same formatter.
 */

/**
 * Formats an unread count for the dock badge.
 * Returns '9+' when count exceeds 9, otherwise the number as a string.
 * Returns '' for zero (caller renders nothing when count is 0).
 */
export function formatBadgeCount(n: number): string {
  if (n <= 0) return '';
  return n > 9 ? '9+' : String(n);
}
