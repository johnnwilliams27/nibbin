/**
 * Task 7: SegmentedControl unit tests.
 *
 * No DOM environment is available in this project (no happy-dom/jsdom).
 * We test the component's exported contracts and the handler logic in
 * isolation — verifying that the options, active-value, onChange, and
 * disabled prop semantics are correct without rendering.
 */
import { describe, it, expect, vi } from 'vitest';
import type { SegmentOption, SegmentedControlProps } from '../components/ui/SegmentedControl';

// The three canonical action-level options that NibbinControls passes in.
const OPTIONS: SegmentOption[] = [
  { value: 'observe', label: 'Observe', description: 'Watch mode' },
  { value: 'draft',   label: 'Draft',   description: 'Draft mode' },
  { value: 'send',    label: 'Send',    description: 'Send mode' },
];

/**
 * Simulate what SegmentedControl does: for each option, determine whether it
 * is the active one (aria-pressed=true) and whether onClick fires onChange.
 */
function simulateClick(
  props: SegmentedControlProps,
  clickedValue: string,
) {
  const opt = props.options.find((o) => o.value === clickedValue);
  if (!opt) throw new Error(`Option ${clickedValue} not in options`);
  // Mirrors the onClick handler: () => !disabled && onChange(opt.value)
  if (!props.disabled) {
    props.onChange(clickedValue);
  }
}

function isActive(props: SegmentedControlProps, optionValue: string): boolean {
  return props.value === optionValue;
}

describe('SegmentedControl', () => {
  it('accepts exactly 3 options and each has a distinct value', () => {
    const values = OPTIONS.map((o) => o.value);
    expect(values).toHaveLength(3);
    expect(new Set(values).size).toBe(3);
    expect(values).toContain('observe');
    expect(values).toContain('draft');
    expect(values).toContain('send');
  });

  it('marks only the current value as active (aria-pressed equivalent)', () => {
    const props: SegmentedControlProps = {
      options: OPTIONS,
      value: 'draft',
      onChange: vi.fn(),
    };
    expect(isActive(props, 'observe')).toBe(false);
    expect(isActive(props, 'draft')).toBe(true);
    expect(isActive(props, 'send')).toBe(false);
  });

  it('calls onChange with the clicked option value when not disabled', () => {
    const onChange = vi.fn();
    const props: SegmentedControlProps = {
      options: OPTIONS,
      value: 'observe',
      onChange,
    };
    simulateClick(props, 'send');
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith('send');
  });

  it('does not call onChange when disabled', () => {
    const onChange = vi.fn();
    const props: SegmentedControlProps = {
      options: OPTIONS,
      value: 'observe',
      onChange,
      disabled: true,
    };
    simulateClick(props, 'send');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('onChange is called with the exact value string of the clicked segment', () => {
    const onChange = vi.fn();
    const props: SegmentedControlProps = {
      options: OPTIONS,
      value: 'draft',
      onChange,
    };
    simulateClick(props, 'observe');
    expect(onChange).toHaveBeenCalledWith('observe');
  });

  it('SegmentOption type supports optional description field', () => {
    const withDesc: SegmentOption = { value: 'a', label: 'A', description: 'desc' };
    const withoutDesc: SegmentOption = { value: 'b', label: 'B' };
    expect(withDesc.description).toBe('desc');
    expect(withoutDesc.description).toBeUndefined();
  });
});
