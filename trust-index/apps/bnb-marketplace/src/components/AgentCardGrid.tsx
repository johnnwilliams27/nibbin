'use client';

import { useLayoutEffect, useRef } from 'react';
import type { Agent } from '@/lib/types';
import { AgentCard } from './AgentCard';
import { rowBaseHeights } from './card-row-heights';

/** Equalize the collapsed portion only, without making disclosures stretch peers. */
export function AgentCardGrid({ agents }: { agents: Agent[] }) {
  const gridRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid || typeof ResizeObserver === 'undefined') return;
    let frame = 0;
    const cards = Array.from(grid.querySelectorAll<HTMLElement>('[data-card-base]'));
    const natural = cards.map((card) => card.querySelector<HTMLElement>('[data-card-natural]')!);
    const measure = () => {
      frame = 0;
      const heights = rowBaseHeights(cards.map((card, index) => ({
        top: card.closest('article')!.offsetTop,
        height: natural[index].getBoundingClientRect().height,
      })));
      cards.forEach((card, index) => {
        const height = `${heights[index]}px`;
        if (card.style.minHeight !== height) card.style.minHeight = height;
      });
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    const observer = new ResizeObserver(schedule);
    observer.observe(grid);
    natural.forEach((content) => observer.observe(content));
    measure();
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [agents]);
  return <div ref={gridRef} className="relative grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{agents.map((agent) => <AgentCard key={agent.agent_id} agent={agent} />)}</div>;
}
