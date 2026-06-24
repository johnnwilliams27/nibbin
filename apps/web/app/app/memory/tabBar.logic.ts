/**
 * Task 11 — TabBar logic helpers (pure functions).
 *
 * All tab-bar interaction logic lives here as pure, testable functions.
 * No React, no DOM — the tests drive these directly.
 *
 * Exports:
 *  - nextTab(current, key): returns the key to navigate to
 *  - tabProps(tabs, current, idx): produces ARIA attributes for a single tab button
 *  - nextTabIndex(current, total, key): arrow-key navigation math (wraps around)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The two tab keys for the Memory page. */
export type TabKey = 'memory' | 'sources';

/** ARIA attribute object returned by tabProps. */
export interface TabButtonProps {
  role: 'tab';
  'aria-selected': boolean;
  tabIndex: 0 | -1;
}

// ---------------------------------------------------------------------------
// nextTab — navigate to a named tab
// ---------------------------------------------------------------------------

/**
 * Returns the tab key to navigate to.
 * In this two-tab design the next tab is always the requested key.
 * Kept as a pure function so the logic can be unit-tested and extended
 * (e.g. disabled tabs, gated tabs) without touching component state.
 *
 * @param _current - The currently active tab key (not used for simple navigation).
 * @param key      - The tab key the user requested.
 */
export function nextTab(_current: TabKey, key: TabKey): TabKey {
  return key;
}

// ---------------------------------------------------------------------------
// tabProps — ARIA attribute builder
// ---------------------------------------------------------------------------

/**
 * Returns the ARIA props for a single tab button.
 *
 * @param _tabs   - The ordered list of tab keys (used for length / future extensions).
 * @param current - The currently active tab key.
 * @param idx     - The index of the tab button being rendered.
 *
 * Follows the WAI-ARIA tablist pattern (§14):
 *  - role="tab"
 *  - aria-selected: true only for the active tab
 *  - tabIndex: 0 for the active tab (roving tabindex pattern), -1 for others
 */
export function tabProps(
  _tabs: readonly TabKey[],
  current: TabKey,
  idx: number,
): TabButtonProps {
  const isSelected = _tabs[idx] === current;
  return {
    role: 'tab',
    'aria-selected': isSelected,
    tabIndex: isSelected ? 0 : -1,
  };
}

// ---------------------------------------------------------------------------
// nextTabIndex — arrow-key navigation math
// ---------------------------------------------------------------------------

/**
 * Returns the next tab index for keyboard navigation.
 *
 * - ArrowRight: advance by 1, wrapping at the end
 * - ArrowLeft: retreat by 1, wrapping at the start
 * - Other keys: return the current index unchanged
 *
 * @param current - The index of the currently focused tab button.
 * @param total   - The total number of tabs.
 * @param key     - The keyboard key name (e.g. 'ArrowRight', 'ArrowLeft').
 */
export function nextTabIndex(current: number, total: number, key: string): number {
  if (key === 'ArrowRight') {
    return (current + 1) % total;
  }
  if (key === 'ArrowLeft') {
    return (current - 1 + total) % total;
  }
  return current;
}
