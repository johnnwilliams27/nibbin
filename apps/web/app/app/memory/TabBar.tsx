'use client';
/**
 * Task 11 — TabBar.tsx
 *
 * A two-tab bar for the Memory page: "Grove Memory" | "Sources".
 *
 * Follows the WAI-ARIA tablist pattern (§14):
 *   - Container: role="tablist" + aria-label
 *   - Each tab: role="tab" + aria-selected + aria-controls + tabIndex (roving)
 *   - Active panel: role="tabpanel" + aria-labelledby
 *
 * Keyboard navigation:
 *   - Arrow keys cycle through tabs (nextTabIndex from tabBar.logic.ts)
 *   - Tab/Shift-Tab moves focus in and out of the tablist
 *
 * CSS: `.tabBar`, `.tab`, `.tabActive` — token-only classes in memory.module.css.
 */

import React, { useRef } from 'react';
import type { TabKey } from './tabBar.logic';
import { tabProps, nextTabIndex } from './tabBar.logic';
import styles from './memory.module.css';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TABS: readonly TabKey[] = ['memory', 'sources'];

const TAB_LABELS: Record<TabKey, string> = {
  memory: 'Grove Memory',
  sources: 'Sources',
};

// These IDs connect each tab button to its panel via aria-controls / aria-labelledby.
const TAB_IDS: Record<TabKey, string> = {
  memory: 'tab-memory',
  sources: 'tab-sources',
};

const PANEL_IDS: Record<TabKey, string> = {
  memory: 'tabpanel-memory',
  sources: 'tabpanel-sources',
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface TabBarProps {
  /** The currently active tab key. */
  activeTab: TabKey;
  /**
   * Called when the user selects a different tab.
   * Parent (MemoryClient) updates its state.
   */
  onTabChange: (key: TabKey) => void;
}

// ---------------------------------------------------------------------------
// TabBar — main export
// ---------------------------------------------------------------------------

export function TabBar({ activeTab, onTabChange }: TabBarProps): React.ReactElement {
  // Track button refs for keyboard roving-focus management.
  const btnRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function handleKeyDown(e: React.KeyboardEvent, idx: number) {
    const next = nextTabIndex(idx, TABS.length, e.key);
    if (next !== idx) {
      e.preventDefault();
      onTabChange(TABS[next]);
      // Move focus to the new tab button.
      btnRefs.current[next]?.focus();
    }
  }

  return (
    <div className={styles.tabBar} role="tablist" aria-label="Memory page tabs">
      {TABS.map((key, idx) => {
        const props = tabProps(TABS, activeTab, idx);
        const isActive = key === activeTab;
        return (
          <button
            key={key}
            ref={(el) => { btnRefs.current[idx] = el; }}
            id={TAB_IDS[key]}
            type="button"
            className={`${styles.tab}${isActive ? ` ${styles.tabActive}` : ''}`}
            aria-controls={PANEL_IDS[key]}
            onClick={() => onTabChange(key)}
            onKeyDown={(e) => handleKeyDown(e, idx)}
            {...props}
          >
            {TAB_LABELS[key]}
          </button>
        );
      })}
    </div>
  );
}

// Re-export panel IDs for MemoryClient to use on the panel elements.
export { PANEL_IDS, TAB_IDS };
