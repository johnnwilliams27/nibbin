'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { ArrowUpRight, X } from 'lucide-react';
import { ExampleDelivery } from './ExampleDelivery';

/** Keep the focus trap and backdrop until the exit finishes, even if cancelled. */
export async function closeExampleDrawer(element: HTMLDialogElement, reducedMotion: boolean) {
  if (!element.open || element.dataset.closing === 'true') return;
  const current = element.ownerDocument?.defaultView?.getComputedStyle(element);
  const start = { transform: current?.transform ?? 'translateX(0)', opacity: current?.opacity ?? '1' };
  element.dataset.closing = 'true';
  let animation: Animation | undefined;
  try {
    if (!reducedMotion && typeof element.animate === 'function') {
      animation = element.animate([start, { transform: 'translateX(100%)', opacity: '0' }], {
        duration: 250, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards',
      });
      await animation.finished;
    }
  } catch {
    // An interrupted animation must never leave an inaccessible modal behind.
  } finally {
    element.close();
    animation?.cancel();
    delete element.dataset.closing;
  }
}

/** A separate preview: opening or closing it never replaces the live hire form. */
export function TryPageExtras() {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [hasOpened, setHasOpened] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [isOpen]);

  function openPreview() {
    if (!dialog.current || dialog.current.open) return;
    dialog.current.showModal();
    setHasOpened(true);
    setIsOpen(true);
    closeButton.current?.focus();
  }

  function closePreview() {
    if (dialog.current) void closeExampleDrawer(dialog.current, window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  return <>
    <button ref={trigger} type="button" aria-haspopup="dialog" aria-controls={id} aria-expanded={isOpen} onClick={openPreview} className="inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-btn)] border border-[var(--border)] px-3 py-2 text-[13px] font-medium hover:bg-[var(--panel-2)]">
      View an example result <ArrowUpRight size={16} strokeWidth={1.5} aria-hidden />
    </button>
    <dialog ref={dialog} id={id} aria-modal="true" aria-labelledby={`${id}-heading`} aria-describedby={`${id}-description`} onCancel={event => { event.preventDefault(); closePreview(); }} onClose={() => { setIsOpen(false); trigger.current?.focus(); }} className="example-drawer fixed inset-y-0 left-auto right-0 m-0 h-dvh max-h-none w-full max-w-[560px] overflow-y-auto border-0 border-l border-[var(--border)] bg-[var(--panel)] p-0 text-[var(--fg)] backdrop:bg-black/60">
      <div className="flex min-h-full flex-col p-5 sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <h2 id={`${id}-heading`} className="pt-2 text-[22px] font-semibold leading-snug">Example result</h2>
          <button ref={closeButton} type="button" onClick={closePreview} className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-[var(--radius-btn)] border border-[var(--border)] px-3 text-[13px] hover:bg-[var(--panel-2)]">
            Close <X size={16} strokeWidth={1.5} aria-hidden />
          </button>
        </div>
        <p id={`${id}-description`} className="mt-3 text-[14px] leading-relaxed text-[var(--fg-muted)]">Inspect an existing testnet delivery without a wallet. This preview is separate from your hire; closing it keeps your inputs and job in place.</p>
        {hasOpened ? <div className="mt-5 border-t border-[var(--border)] pt-2"><ExampleDelivery /></div> : null}
      </div>
    </dialog>
  </>;
}
