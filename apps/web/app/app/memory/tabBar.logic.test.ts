/**
 * Task 11 — TabBar logic tests.
 *
 * Pure function tests for tab-bar interaction helpers.
 * No DOM, no jsdom — all logic tested as pure functions per the plan's
 * "extract interaction logic into pure helpers" mandate.
 *
 * Covers:
 *  - nextTab(current, key): navigate to a named tab
 *  - tabProps(tabs, current, idx): produces the correct role/aria-selected/tabIndex
 */

import { describe, it, expect } from 'vitest';
import { nextTab, tabProps } from './tabBar.logic';

// ---------------------------------------------------------------------------
// nextTab — simple key-based navigation
// ---------------------------------------------------------------------------

describe('nextTab', () => {
  it('returns the provided key (switching to memory tab)', () => {
    expect(nextTab('sources', 'memory')).toBe('memory');
  });

  it('returns the provided key (switching to sources tab)', () => {
    expect(nextTab('memory', 'sources')).toBe('sources');
  });

  it('returns same key when already on that tab (idempotent)', () => {
    expect(nextTab('memory', 'memory')).toBe('memory');
  });

  it('handles any string key', () => {
    expect(nextTab('memory', 'sources')).toBe('sources');
    expect(nextTab('sources', 'memory')).toBe('memory');
  });
});

// ---------------------------------------------------------------------------
// tabProps — ARIA attributes builder
// ---------------------------------------------------------------------------

const TABS = ['memory', 'sources'] as const;
type TabKey = typeof TABS[number];

describe('tabProps — ARIA attribute builder', () => {
  it('returns role="tab" for every tab', () => {
    TABS.forEach((tab, idx) => {
      const props = tabProps(TABS as unknown as TabKey[], 'memory', idx);
      expect(props.role).toBe('tab');
    });
  });

  it('aria-selected is true for the current tab', () => {
    const props = tabProps(TABS as unknown as TabKey[], 'memory', 0);
    expect(props['aria-selected']).toBe(true);
  });

  it('aria-selected is false for a non-current tab', () => {
    const props = tabProps(TABS as unknown as TabKey[], 'memory', 1);
    expect(props['aria-selected']).toBe(false);
  });

  it('tabIndex is 0 for the selected tab (keyboard focus)', () => {
    const props = tabProps(TABS as unknown as TabKey[], 'sources', 1);
    expect(props.tabIndex).toBe(0);
  });

  it('tabIndex is -1 for non-selected tabs (keyboard roving)', () => {
    const props = tabProps(TABS as unknown as TabKey[], 'sources', 0);
    expect(props.tabIndex).toBe(-1);
  });

  it('aria-selected and tabIndex are consistent (selected=true ↔ tabIndex=0)', () => {
    TABS.forEach((key, idx) => {
      const props = tabProps(TABS as unknown as TabKey[], key, idx);
      expect(props['aria-selected']).toBe(true);
      expect(props.tabIndex).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Arrow-key index math helper — nextTabIndex
// ---------------------------------------------------------------------------

import { nextTabIndex } from './tabBar.logic';

describe('nextTabIndex — arrow-key navigation math', () => {
  it('ArrowRight from index 0 → 1', () => {
    expect(nextTabIndex(0, 2, 'ArrowRight')).toBe(1);
  });

  it('ArrowRight from last index wraps to 0', () => {
    expect(nextTabIndex(1, 2, 'ArrowRight')).toBe(0);
  });

  it('ArrowLeft from index 1 → 0', () => {
    expect(nextTabIndex(1, 2, 'ArrowLeft')).toBe(0);
  });

  it('ArrowLeft from index 0 wraps to last', () => {
    expect(nextTabIndex(0, 2, 'ArrowLeft')).toBe(1);
  });

  it('other keys return current index unchanged', () => {
    expect(nextTabIndex(0, 2, 'Enter')).toBe(0);
    expect(nextTabIndex(1, 2, 'Space')).toBe(1);
  });
});
