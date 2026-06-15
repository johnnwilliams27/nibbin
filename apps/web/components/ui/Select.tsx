'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import styles from './select.module.css';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps {
  /** Form field name — submitted via a hidden input so server actions read it. */
  name: string;
  options: SelectOption[];
  defaultValue?: string;
  /** id for the trigger, so an external <label htmlFor> focuses it. */
  id?: string;
  /** Used when no external <label> is associated. */
  'aria-label'?: string;
  placeholder?: string;
}

/**
 * Animated, keyboard-accessible single-select (listbox pattern). Mirrors a
 * native <select> for form submission via a hidden input, but the open/close is
 * a token-timed transform+opacity glide (Plate 06 — never animate width/height)
 * and the surface matches the app's light cards. Closed state is
 * `visibility:hidden`, which keeps the options out of the tab + AT order while
 * still allowing the fade-out to play.
 */
export function Select({
  name,
  options,
  defaultValue = '',
  id,
  placeholder = 'Select…',
  ...rest
}: SelectProps) {
  const ariaLabel = rest['aria-label'];
  const autoId = useId();
  const triggerId = id ?? `${autoId}-trigger`;
  const listId = `${autoId}-list`;

  const [value, setValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(() => {
    const i = options.findIndex((o) => o.value === defaultValue);
    return i >= 0 ? i : 0;
  });

  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<(HTMLLIElement | null)[]>([]);
  const typeahead = useRef<{ buf: string; at: number }>({ buf: '', at: 0 });

  const selected = options.find((o) => o.value === value);

  const close = useCallback((focusTrigger = true) => {
    setOpen(false);
    if (focusTrigger) triggerRef.current?.focus();
  }, []);

  const openList = useCallback(() => {
    const i = options.findIndex((o) => o.value === value);
    setActive(i >= 0 ? i : 0);
    setOpen(true);
  }, [options, value]);

  const choose = useCallback(
    (index: number) => {
      const opt = options[index];
      if (!opt) return;
      setValue(opt.value);
      close();
    },
    [options, close],
  );

  // Close on outside pointer.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  // Keep the active option scrolled into view while navigating.
  useEffect(() => {
    if (open) optionRefs.current[active]?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const move = useCallback(
    (delta: number) => {
      setActive((cur) => {
        const next = cur + delta;
        if (next < 0) return 0;
        if (next > options.length - 1) return options.length - 1;
        return next;
      });
    },
    [options.length],
  );

  const onTypeahead = useCallback(
    (key: string) => {
      const now = Date.now();
      const t = typeahead.current;
      t.buf = now - t.at > 600 ? key : t.buf + key;
      t.at = now;
      const needle = t.buf.toLowerCase();
      const found = options.findIndex((o) => o.label.toLowerCase().startsWith(needle));
      if (found >= 0) setActive(found);
    },
    [options],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (!open) openList();
        else move(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (!open) openList();
        else move(-1);
        break;
      case 'Home':
        if (open) {
          e.preventDefault();
          setActive(0);
        }
        break;
      case 'End':
        if (open) {
          e.preventDefault();
          setActive(options.length - 1);
        }
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (open) choose(active);
        else openList();
        break;
      case 'Escape':
        if (open) {
          e.preventDefault();
          close();
        }
        break;
      case 'Tab':
        if (open) setOpen(false);
        break;
      default:
        if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
          if (!open) openList();
          onTypeahead(e.key);
        }
    }
  };

  return (
    <div className={styles.root} ref={rootRef}>
      <input type="hidden" name={name} value={value} />
      <button
        type="button"
        id={triggerId}
        ref={triggerRef}
        className={styles.trigger}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={ariaLabel}
        aria-activedescendant={open ? `${listId}-opt-${active}` : undefined}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
      >
        <span className={selected ? styles.valueText : styles.placeholder}>
          {selected ? selected.label : placeholder}
        </span>
        <span className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`} aria-hidden="true">
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
            <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>

      <ul
        id={listId}
        role="listbox"
        aria-label={ariaLabel}
        className={`${styles.list} ${open ? styles.listOpen : ''}`}
      >
        {options.map((opt, i) => (
          <li
            key={opt.value || `__opt-${i}`}
            id={`${listId}-opt-${i}`}
            ref={(el) => {
              optionRefs.current[i] = el;
            }}
            role="option"
            aria-selected={opt.value === value}
            className={`${styles.option} ${i === active ? styles.optionActive : ''} ${
              opt.value === value ? styles.optionSelected : ''
            }`}
            onPointerEnter={() => setActive(i)}
            onClick={() => choose(i)}
          >
            <span className={styles.optionLabel}>{opt.label}</span>
            {opt.value === value && (
              <span className={styles.check} aria-hidden="true">
                <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
                  <path d="M3.5 8.5l3 3 6-6.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
