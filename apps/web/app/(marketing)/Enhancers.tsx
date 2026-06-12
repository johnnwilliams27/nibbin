'use client';

import { useEffect } from 'react';

/**
 * Progressive enhancement only — the page is fully readable without it.
 * Adds the nav scroll shadow and the reveal-on-scroll for sections below the
 * fold. Both no-op under prefers-reduced-motion (the reveal targets are
 * already visible via the CSS media query, so skipping the observer leaves
 * them shown).
 */
export function Enhancers() {
  useEffect(() => {
    const nav = document.querySelector('.landing nav');
    const onScroll = () => nav?.classList.toggle('scrolled', window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let observer: IntersectionObserver | undefined;
    if (!reduce && 'IntersectionObserver' in window) {
      const targets = document.querySelectorAll('.landing .reveal');
      observer = new IntersectionObserver(
        (entries, obs) => {
          for (const e of entries) {
            if (e.isIntersecting) {
              e.target.classList.add('in');
              obs.unobserve(e.target);
            }
          }
        },
        { rootMargin: '0px 0px -10% 0px', threshold: 0.05 },
      );
      targets.forEach((t) => observer!.observe(t));
    }

    return () => {
      window.removeEventListener('scroll', onScroll);
      observer?.disconnect();
    };
  }, []);

  return null;
}
