'use client';

/**
 * KeeperDock — layout-mounted persistent Keeper companion.
 *
 * Wraps <KeeperPanel> in a fixed-position collapsible dock so the Keeper
 * persists across ALL /app/* pages without being remounted on navigation.
 * Mounted once in apps/web/app/app/layout.tsx (async server component) so
 * React client state inside KeeperChat (the message log) survives route
 * changes automatically.
 *
 * UX mirrors AppShell's panel/panelExpand/panelToggle mechanics:
 *   Desktop  — right-edge expand tab with <Grovekeeper> icon when collapsed;
 *              fixed right rail (~380px, full height under the topbar) when open.
 *   Mobile   — bottom-right FAB that slides a bottom sheet up from the edge.
 *
 * Collapse state is persisted in localStorage so the dock remembers its
 * position across page loads; defaults to COLLAPSED on first visit so the
 * dock never blocks freshly-loaded content.
 */

import { useEffect, useState } from 'react';
import { Grovekeeper } from '../../../components/grovekeeper/Grovekeeper';
import { KeeperPanel, type KeeperPanelProps } from './KeeperPanel';
import styles from './keeper-dock.module.css';

const DOCK_OPEN_KEY = 'nibbin:keeperDockOpen';

export function KeeperDock(props: KeeperPanelProps) {
  // Collapsed/expanded for desktop rail; open/closed for mobile sheet.
  // Both default false (collapsed/closed) to avoid blocking content on first
  // load. We hydrate from localStorage in useEffect to prevent SSR mismatch.
  const [expanded, setExpanded] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    try {
      setExpanded(localStorage.getItem(DOCK_OPEN_KEY) === 'true');
    } catch {
      // localStorage unavailable — stay collapsed.
    }
  }, []);

  function toggleExpanded() {
    setExpanded((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(DOCK_OPEN_KEY, String(next));
      } catch {
        // ignore
      }
      return next;
    });
  }

  return (
    <>
      {/* ── Desktop: fixed right rail ─────────────────────────────────────── */}
      <aside
        className={`${styles.rail} ${expanded ? styles.railOpen : styles.railCollapsed}`}
        aria-label="Keeper panel"
        aria-hidden={!expanded}
      >
        <button
          className={styles.collapseBtn}
          type="button"
          aria-label="Collapse Keeper panel"
          onClick={toggleExpanded}
        >
          ›
        </button>
        <KeeperPanel {...props} />
      </aside>

      {/* Desktop expand tab — right edge, visible when collapsed */}
      <button
        className={`${styles.expandTab} ${expanded ? styles.expandTabHidden : ''}`}
        type="button"
        aria-label="Open Keeper panel"
        onClick={toggleExpanded}
      >
        <span className={styles.keeperGlyph} aria-hidden="true">
          <Grovekeeper size={26} />
        </span>
      </button>

      {/* ── Mobile: backdrop + bottom sheet ──────────────────────────────── */}
      {sheetOpen && (
        <div
          className={styles.backdrop}
          aria-hidden="true"
          onClick={() => setSheetOpen(false)}
        />
      )}

      <aside
        className={`${styles.sheet} ${sheetOpen ? styles.sheetOpen : ''}`}
        aria-label="Keeper panel"
        aria-hidden={!sheetOpen}
      >
        <KeeperPanel {...props} />
      </aside>

      {/* Mobile FAB */}
      <button
        className={styles.fab}
        type="button"
        aria-label={sheetOpen ? 'Close Keeper' : 'Open Keeper'}
        aria-expanded={sheetOpen}
        onClick={() => setSheetOpen((v) => !v)}
      >
        {sheetOpen ? (
          '✕'
        ) : (
          <span className={styles.keeperGlyph} aria-hidden="true">
            <Grovekeeper size={32} />
          </span>
        )}
      </button>
    </>
  );
}
