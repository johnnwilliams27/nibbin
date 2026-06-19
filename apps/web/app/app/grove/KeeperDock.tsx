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
 *
 * Single-instance invariant: exactly ONE <KeeperPanel> (and therefore ONE
 * <KeeperChat>) is ever mounted. The same DOM node is repositioned via CSS
 * media queries — desktop rail layout on >880px, bottom-sheet layout on ≤880px.
 * Do NOT split this back into separate desktop/mobile <aside> elements, even if
 * one were hidden with display:none — that keeps two React trees live with
 * diverged message state and doubled side-effects.
 *
 * @param initialMessages  Baked at layout render; intentionally NOT refreshed on
 *   SPA navigation. KeeperChat owns its own message log after mount. Do NOT add
 *   a reset-on-unmount or key= that would re-seed the conversation on each route
 *   change — the Keeper is a persistent companion, not a per-page widget.
 * @param initialExpression  Same bake-once semantics as initialMessages.
 */

import { useEffect, useState } from 'react';
import { Grovekeeper } from '../../../components/grovekeeper/Grovekeeper';
import { KeeperPanel, type KeeperPanelProps } from './KeeperPanel';
import styles from './keeper-dock.module.css';

const DOCK_OPEN_KEY = 'nibbin:keeperDockOpen';

export function KeeperDock(props: KeeperPanelProps) {
  // Single open/closed boolean drives BOTH desktop rail and mobile sheet.
  // Defaults false (collapsed/closed) to avoid blocking content on first load.
  // Hydrated from localStorage in useEffect to prevent SSR mismatch.
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      setOpen(localStorage.getItem(DOCK_OPEN_KEY) === 'true');
    } catch {
      // localStorage unavailable — stay collapsed.
    }
  }, []);

  function toggle() {
    setOpen((prev) => {
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
      {/*
       * Single panel container — ONE <KeeperPanel> / ONE <KeeperChat>.
       * CSS positions it as a right rail on desktop (>880px) and as a
       * bottom sheet on mobile (≤880px) via media queries on .panel /
       * .panelOpen in keeper-dock.module.css.
       */}
      <aside
        className={`${styles.panel} ${open ? styles.panelOpen : styles.panelClosed}`}
        aria-label="Keeper panel"
        aria-hidden={!open}
      >
        <button
          className={styles.collapseBtn}
          type="button"
          aria-label="Collapse Keeper panel"
          onClick={toggle}
        >
          ›
        </button>
        <KeeperPanel {...props} />
      </aside>

      {/* Mobile backdrop — rendered only when open; CSS hides it on desktop. */}
      {open && (
        <div
          className={styles.backdrop}
          aria-hidden="true"
          onClick={toggle}
        />
      )}

      {/* Desktop expand tab — right edge, visible when panel is closed.
          Uses visibility/opacity (not display:none) so the dockTabIn animation
          does not re-fire every time the panel is toggled. */}
      <button
        className={`${styles.expandTab} ${open ? styles.expandTabHidden : ''}`}
        type="button"
        aria-label="Open Keeper panel"
        onClick={toggle}
      >
        <span className={styles.keeperGlyph} aria-hidden="true">
          <Grovekeeper size={26} />
        </span>
      </button>

      {/* Mobile FAB — CSS hides on desktop. */}
      <button
        className={styles.fab}
        type="button"
        aria-label={open ? 'Close Keeper' : 'Open Keeper'}
        aria-expanded={open}
        onClick={toggle}
      >
        {open ? (
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
