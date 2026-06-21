'use client';

import styles from './segmented-control.module.css';

export interface SegmentOption {
  value: string;
  label: string;
  description?: string;
}

export interface SegmentedControlProps {
  options: SegmentOption[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  'aria-label'?: string;
}

export function SegmentedControl({
  options,
  value,
  onChange,
  disabled = false,
  'aria-label': ariaLabel,
}: SegmentedControlProps) {
  return (
    <div className={styles.root} role="group" aria-label={ariaLabel}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            className={[styles.seg, active ? styles.segActive : ''].filter(Boolean).join(' ')}
            aria-pressed={active}
            onClick={() => !disabled && onChange(opt.value)}
            disabled={disabled}
            title={opt.description}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
