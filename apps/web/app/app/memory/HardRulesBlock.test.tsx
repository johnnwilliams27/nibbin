/**
 * Task 9 — HardRulesBlock component tests.
 *
 * Uses renderToStaticMarkup (no jsdom, no testing-library) per repo convention.
 *
 * What we assert via static markup:
 *  View mode:
 *  - The "HARD RULES" mono eyebrow carries the coral-deep class (authority signal)
 *  - Sub-label "Your Nibbins never break these" is present
 *  - Each rule is rendered as <li> with the coral-square bullet class (ruleBullet)
 *  - The container carries the coral left-border class (hardRules)
 *  - Empty state: "No hard rules yet" faint placeholder + Edit button
 *
 *  Edit mode:
 *  - Single <textarea> (one rule per line) is rendered
 *  - Coral accent class is preserved in edit mode
 *  - Hint copy ("Your Nibbins never break these. One rule per line.") is present
 *  - Save / Cancel buttons are present
 *
 *  Round-trip:
 *  - Reducer logic: entering edit from "Rule A\nRule B" yields draft "Rule A\nRule B"
 *  - toRulesString / fromRulesArray pure helpers are round-trip stable
 *
 * What we do NOT assert (no jsdom):
 *  - Click → state transitions (tested via reducer logic below)
 */

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { HardRulesBlock } from './HardRulesBlock';
import { rulesArrayToString, rulesStringToArray } from './HardRulesBlock';
import { initialState, editReducer } from './fieldEditor.reducer';

// ---------------------------------------------------------------------------
// No-op save
// ---------------------------------------------------------------------------

const noopSave = async (_field: string, _value: string): Promise<void> => {};

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe('HardRulesBlock — pure helpers', () => {
  it('rulesArrayToString joins with newlines', () => {
    expect(rulesArrayToString(['Rule A', 'Rule B', 'Rule C'])).toBe('Rule A\nRule B\nRule C');
  });

  it('rulesArrayToString handles empty array', () => {
    expect(rulesArrayToString([])).toBe('');
  });

  it('rulesStringToArray splits on newlines and trims', () => {
    expect(rulesStringToArray('Rule A\nRule B\nRule C')).toEqual(['Rule A', 'Rule B', 'Rule C']);
  });

  it('rulesStringToArray filters blank lines', () => {
    expect(rulesStringToArray('Rule A\n\nRule B\n  \nRule C')).toEqual([
      'Rule A',
      'Rule B',
      'Rule C',
    ]);
  });

  it('rulesStringToArray returns empty array for blank string', () => {
    expect(rulesStringToArray('')).toEqual([]);
    expect(rulesStringToArray('   ')).toEqual([]);
  });

  it('round-trip: array → string → array is stable', () => {
    const rules = ['Never offer a discount without asking me', 'No alcohol-related shoots'];
    expect(rulesStringToArray(rulesArrayToString(rules))).toEqual(rules);
  });
});

// ---------------------------------------------------------------------------
// View mode — coral authority treatment
// ---------------------------------------------------------------------------

describe('HardRulesBlock — view mode (coral authority)', () => {
  it('container carries the hardRules coral left-border class', () => {
    const html = renderToStaticMarkup(
      <HardRulesBlock
        rules={['Never offer a discount without checking with me first']}
        onSave={noopSave}
        testMode="view"
      />,
    );
    expect(html).toContain('hardRules');
  });

  it('renders the "HARD RULES" mono eyebrow', () => {
    const html = renderToStaticMarkup(
      <HardRulesBlock
        rules={['No alcohol-related shoots']}
        onSave={noopSave}
        testMode="view"
      />,
    );
    expect(html).toContain('HARD RULES');
  });

  it('eyebrow carries the hardRulesEyebrow coral-deep class', () => {
    const html = renderToStaticMarkup(
      <HardRulesBlock
        rules={['No alcohol-related shoots']}
        onSave={noopSave}
        testMode="view"
      />,
    );
    expect(html).toContain('hardRulesEyebrow');
  });

  it('renders the "Your Nibbins never break these" sub-label', () => {
    const html = renderToStaticMarkup(
      <HardRulesBlock
        rules={['Never offer discounts']}
        onSave={noopSave}
        testMode="view"
      />,
    );
    expect(html).toContain('Your Nibbins never break these');
  });

  it('renders each rule as <li> with ruleBullet class', () => {
    const html = renderToStaticMarkup(
      <HardRulesBlock
        rules={['Rule one', 'Rule two', 'Rule three']}
        onSave={noopSave}
        testMode="view"
      />,
    );
    expect(html).toContain('<li');
    expect(html).toContain('ruleBullet');
    expect(html).toContain('Rule one');
    expect(html).toContain('Rule two');
    expect(html).toContain('Rule three');
  });

  it('renders all three rules as separate <li> elements', () => {
    const html = renderToStaticMarkup(
      <HardRulesBlock
        rules={['Rule one', 'Rule two', 'Rule three']}
        onSave={noopSave}
        testMode="view"
      />,
    );
    // Count <li occurrences (at least 3 for 3 rules)
    const liCount = (html.match(/<li/g) ?? []).length;
    expect(liCount).toBeGreaterThanOrEqual(3);
  });

  it('renders an Edit button in view mode', () => {
    const html = renderToStaticMarkup(
      <HardRulesBlock
        rules={['Rule one']}
        onSave={noopSave}
        testMode="view"
      />,
    );
    expect(html).toContain('Edit');
    expect(html).toContain('aria-label="Edit Hard rules"');
  });

  it('does NOT render a <textarea> in view mode', () => {
    const html = renderToStaticMarkup(
      <HardRulesBlock
        rules={['Rule one']}
        onSave={noopSave}
        testMode="view"
      />,
    );
    expect(html).not.toContain('<textarea');
  });
});

// ---------------------------------------------------------------------------
// View mode — empty state
// ---------------------------------------------------------------------------

describe('HardRulesBlock — empty state', () => {
  it('renders "No hard rules yet" faint text when rules is empty', () => {
    const html = renderToStaticMarkup(
      <HardRulesBlock
        rules={[]}
        onSave={noopSave}
        testMode="view"
      />,
    );
    expect(html).toContain('No hard rules yet');
  });

  it('empty state still carries the coral container class', () => {
    const html = renderToStaticMarkup(
      <HardRulesBlock
        rules={[]}
        onSave={noopSave}
        testMode="view"
      />,
    );
    expect(html).toContain('hardRules');
  });

  it('empty state renders an Edit button', () => {
    const html = renderToStaticMarkup(
      <HardRulesBlock
        rules={[]}
        onSave={noopSave}
        testMode="view"
      />,
    );
    expect(html).toContain('Edit');
  });

  it('empty state does not render a <ul> (no rules, no list)', () => {
    const html = renderToStaticMarkup(
      <HardRulesBlock
        rules={[]}
        onSave={noopSave}
        testMode="view"
      />,
    );
    expect(html).not.toContain('<ul');
  });
});

// ---------------------------------------------------------------------------
// Edit mode — one-per-line textarea + coral accent preserved
// ---------------------------------------------------------------------------

describe('HardRulesBlock — edit mode', () => {
  it('renders a <textarea> in edit mode', () => {
    const html = renderToStaticMarkup(
      <HardRulesBlock
        rules={['Rule one', 'Rule two']}
        onSave={noopSave}
        testMode="edit"
      />,
    );
    expect(html).toContain('<textarea');
  });

  it('textarea contains rules joined one-per-line', () => {
    const html = renderToStaticMarkup(
      <HardRulesBlock
        rules={['Rule one', 'Rule two']}
        onSave={noopSave}
        testMode="edit"
      />,
    );
    // The textarea value should contain both rules separated by newline
    expect(html).toContain('Rule one');
    expect(html).toContain('Rule two');
  });

  it('coral accent class is preserved in edit mode container', () => {
    const html = renderToStaticMarkup(
      <HardRulesBlock
        rules={['Rule one']}
        onSave={noopSave}
        testMode="edit"
      />,
    );
    expect(html).toContain('hardRules');
  });

  it('renders the hint copy above the textarea in edit mode', () => {
    const html = renderToStaticMarkup(
      <HardRulesBlock
        rules={['Rule one']}
        onSave={noopSave}
        testMode="edit"
      />,
    );
    expect(html).toContain('One rule per line');
  });

  it('renders Save and Cancel buttons in edit mode', () => {
    const html = renderToStaticMarkup(
      <HardRulesBlock
        rules={['Rule one']}
        onSave={noopSave}
        testMode="edit"
      />,
    );
    expect(html).toContain('Save');
    expect(html).toContain('Cancel');
  });

  it('does NOT render an Edit button in edit mode', () => {
    const html = renderToStaticMarkup(
      <HardRulesBlock
        rules={['Rule one']}
        onSave={noopSave}
        testMode="edit"
      />,
    );
    expect(html).not.toContain('aria-label="Edit Hard rules"');
  });

  it('does not render rule <li> elements in edit mode', () => {
    const html = renderToStaticMarkup(
      <HardRulesBlock
        rules={['Rule one', 'Rule two']}
        onSave={noopSave}
        testMode="edit"
      />,
    );
    expect(html).not.toContain('ruleBullet');
  });
});

// ---------------------------------------------------------------------------
// Edit round-trip via reducer (pure logic, no DOM)
// ---------------------------------------------------------------------------

describe('HardRulesBlock — edit round-trip (reducer logic)', () => {
  it('entering edit mode seeds the draft from the rules string', () => {
    const rules = ['Rule A', 'Rule B'];
    const initialValue = rulesArrayToString(rules);
    const state0 = initialState(initialValue);

    // Enter edit mode
    const state1 = editReducer(state0, { type: 'enter' });
    expect(state1.mode).toBe('editing');
    expect(state1.draft).toBe('Rule A\nRule B');
  });

  it('changing the draft updates it correctly', () => {
    const initialValue = 'Rule A\nRule B';
    const state0 = initialState(initialValue);
    const state1 = editReducer(state0, { type: 'enter' });
    const state2 = editReducer(state1, { type: 'change', value: 'Rule A\nRule B\nRule C' });
    expect(state2.draft).toBe('Rule A\nRule B\nRule C');
    expect(state2.dirty).toBe(true);
  });

  it('cancelling after clean edit returns to viewing without confirm', () => {
    const state0 = initialState('Rule A');
    const state1 = editReducer(state0, { type: 'enter' });
    // No change made — draft === original
    const state2 = editReducer(state1, { type: 'requestCancel' });
    // Clean cancel exits immediately (no dirty → no confirm)
    expect(state2.mode).toBe('viewing');
    expect(state2.confirming).toBeNull();
  });

  it('saveSuccess promotes draft to original and sets mode=viewing', () => {
    const state0 = initialState('Rule A');
    const state1 = editReducer(state0, { type: 'enter' });
    const state2 = editReducer(state1, { type: 'change', value: 'Rule A\nRule B' });
    const state3 = editReducer(state2, { type: 'save' });
    expect(state3.mode).toBe('saving');
    const state4 = editReducer(state3, { type: 'saveSuccess' });
    expect(state4.mode).toBe('viewing');
    expect(state4.original).toBe('Rule A\nRule B');
    expect(state4.dirty).toBe(false);
  });

  it('rulesStringToArray(saveSuccess draft) produces the saved rules', () => {
    const initial = 'Rule A\nRule B';
    const state0 = initialState(initial);
    const state1 = editReducer(state0, { type: 'enter' });
    const state2 = editReducer(state1, { type: 'change', value: 'Rule A\nRule B\nRule C' });
    const state3 = editReducer(state2, { type: 'saveSuccess' });
    // After save, the original reflects the new rules
    const savedRules = rulesStringToArray(state3.original);
    expect(savedRules).toEqual(['Rule A', 'Rule B', 'Rule C']);
  });
});
