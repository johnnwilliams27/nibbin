'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Check, ChevronDown } from 'lucide-react';

interface Option { value: string; label: string }
interface Props {
  label: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  className?: string;
  inline?: boolean;
}

/** A single-selection listbox; focus returns to its trigger on selection or Escape. */
export function FilterSelect({ label, value, options, onChange, className = '', inline = false }: Props) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLDivElement | null>>([]);
  const typeahead = useRef({ text: '', at: 0 });
  const [open, setOpen] = useState(false);
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const [placement, setPlacement] = useState({ above: false, maxHeight: 320 });

  function openMenu(index = selectedIndex) {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      const below = window.innerHeight - rect.bottom;
      const above = below < 260 && rect.top > below;
      setPlacement({ above, maxHeight: Math.min(320, Math.max(80, (above ? rect.top : below) - 16)) });
    }
    typeahead.current = { text: '', at: 0 };
    setActiveIndex(index);
    setOpen(true);
  }

  function closeMenu(restoreFocus = false) {
    if (restoreFocus) triggerRef.current?.focus({ preventScroll: true });
    setOpen(false);
  }

  function choose(index: number) {
    const option = options[index];
    if (!option) return;
    closeMenu(true);
    onChange(option.value);
  }

  useLayoutEffect(() => {
    if (open) menuRef.current?.focus({ preventScroll: true });
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const option = optionRefs.current[activeIndex];
    const menu = menuRef.current;
    if (option && menu) {
      const top = option.offsetTop;
      if (top < menu.scrollTop) menu.scrollTop = top;
      else if (top + option.offsetHeight > menu.scrollTop + menu.clientHeight) menu.scrollTop = top + option.offsetHeight - menu.clientHeight;
    }
  }, [activeIndex, open]);

  useEffect(() => {
    if (!open) return;
    function closeOutside(event: PointerEvent | FocusEvent) {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('focusin', closeOutside);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('focusin', closeOutside);
    };
  }, [open]);

  function handleKey(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Tab') {
      // Restore the trigger's position in the tab order, then let the browser move normally.
      if (open) closeMenu(true);
      return;
    }
    if (event.key === 'Escape') {
      if (open) { event.preventDefault(); event.stopPropagation(); closeMenu(true); }
      return;
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1
        : !open ? selectedIndex : Math.max(0, Math.min(options.length - 1, activeIndex + (event.key === 'ArrowDown' ? 1 : -1)));
      if (open) setActiveIndex(next);
      else openMenu(next);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (open) choose(activeIndex);
      else openMenu();
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault();
      const now = Date.now();
      const previous = now - typeahead.current.at < 700 ? typeahead.current.text : '';
      const text = previous + event.key.toLocaleLowerCase();
      const repeated = [...text].every((letter) => letter === text[0]);
      const prefix = repeated ? text[0] : text;
      const start = repeated ? (open ? activeIndex : selectedIndex) + 1 : (open ? activeIndex : selectedIndex);
      const match = options.map((_, offset) => (start + offset) % options.length)
        .find((index) => options[index].label.toLocaleLowerCase().startsWith(prefix));
      if (!open) openMenu(match ?? selectedIndex);
      else if (match !== undefined) setActiveIndex(match);
      typeahead.current = { text, at: now };
    }
  }

  return (
    <div ref={rootRef} className={`${inline ? 'flex items-center gap-2' : ''} min-w-0 ${className}`}>
      <span id={`${id}-label`} className={inline ? 'text-[14px] text-[var(--fg-muted)]' : 'mb-2 block text-[14px] font-medium'}>{label}</span>
      <div className={`relative min-w-0 ${inline ? 'flex-1' : ''}`}>
        <button ref={triggerRef} type="button" aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? `${id}-listbox` : undefined} aria-labelledby={`${id}-label ${id}-value`} onClick={() => open ? closeMenu() : openMenu()} onKeyDown={handleKey}
          className="filter-select-trigger flex min-h-11 w-full items-center justify-between gap-3 rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-left text-[14px] text-[var(--fg)]">
          <span id={`${id}-value`} className="min-w-0 break-words">{options[selectedIndex]?.label ?? 'Choose an option'}</span>
          <ChevronDown size={16} strokeWidth={1.5} aria-hidden data-open={open} className="filter-select-chevron shrink-0 text-[var(--fg-muted)]" />
        </button>
        {open ? <div ref={menuRef} id={`${id}-listbox`} role="listbox" tabIndex={-1} aria-labelledby={`${id}-label`} aria-activedescendant={`${id}-option-${activeIndex}`} onKeyDown={handleKey}
          className={`filter-select-menu filter-menu-enter absolute inset-x-0 z-50 overflow-y-auto overscroll-contain rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--panel)] p-1.5 shadow-lg ${placement.above ? 'bottom-full mb-2' : 'top-full mt-2'}`}
          style={{ maxHeight: placement.maxHeight }}>
          {options.map((option, index) => <div key={option.value} ref={(node) => { optionRefs.current[index] = node; }} id={`${id}-option-${index}`} role="option" aria-selected={option.value === value} data-active={index === activeIndex}
            onPointerMove={() => setActiveIndex(index)} onPointerDown={(event) => event.preventDefault()} onClick={() => choose(index)}
            className="filter-select-option flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-[var(--radius-btn)] px-3 py-2 text-[14px] leading-snug"
            style={index === activeIndex ? { background: 'var(--measured-bg)', color: 'var(--measured)' } : undefined}>
            <span className="min-w-0 break-words">{option.label}</span>{option.value === value ? <Check size={16} strokeWidth={1.5} aria-hidden className="shrink-0" /> : null}
          </div>)}
        </div> : null}
      </div>
    </div>
  );
}
