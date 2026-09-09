'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Info } from 'lucide-react';

export function HealthFactorTooltip() {
  const id = useId();
  const wrapper = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const pinned = useRef(false);
  const [position, setPosition] = useState<{ left: number; top: number; width: number } | null>(null);

  function show() {
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(320, window.innerWidth - 32);
    setPosition({
      left: Math.max(16, Math.min(rect.left, window.innerWidth - width - 16)),
      top: rect.bottom,
      width,
    });
  }

  useEffect(() => {
    if (!position) return;
    function dismiss() { pinned.current = false; setPosition(null); }
    function outside(event: PointerEvent) {
      if (!wrapper.current?.contains(event.target as Node)) dismiss();
    }
    function escape(event: KeyboardEvent) { if (event.key === 'Escape') dismiss(); }
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    window.addEventListener('resize', dismiss);
    window.addEventListener('scroll', dismiss, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('scroll', dismiss, true);
    };
  }, [position]);

  return <span ref={wrapper} className="inline-block"
    onPointerEnter={event => { if (event.pointerType === 'mouse') show(); }}
    onPointerLeave={() => {
      if (!pinned.current && document.activeElement !== trigger.current) setPosition(null);
    }}
    onBlur={event => {
      if (!pinned.current && !event.currentTarget.contains(event.relatedTarget)) setPosition(null);
    }}>
    <button ref={trigger} type="button" aria-label="What is a health factor?"
      aria-describedby={position ? id : undefined}
      onFocus={show}
      onClick={() => {
        pinned.current = !pinned.current;
        if (pinned.current) show(); else setPosition(null);
      }}
      className="inline-flex min-h-11 cursor-help items-center gap-1 rounded px-1 text-[var(--fg)] underline decoration-dotted underline-offset-4 transition-colors hover:text-[var(--coverage)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--coverage)]">
      health-factor <Info size={14} aria-hidden="true" />
    </button>
    {position && <span style={position} className="fixed z-50 block pt-2">
      <span id={id} role="tooltip" className="block rounded-xl border border-[var(--border)] bg-[var(--panel-2)] p-4 text-left text-[13px] leading-relaxed text-[var(--fg)] shadow-xl">
        <strong className="mb-2 block">How close is a loan to liquidation?</strong>
        Health factor compares collateral, adjusted by its liquidation threshold, with debt.
        <span className="mt-2 block">Above 1 means a buffer. At 1, the loan reaches the threshold; below 1, it may be liquidated, depending on the protocol.</span>
        <span className="mt-2 block">A result of 1.66 means adjusted collateral is 1.66× the debt. It is a snapshot—not a safety guarantee.</span>
      </span>
    </span>}
  </span>;
}
