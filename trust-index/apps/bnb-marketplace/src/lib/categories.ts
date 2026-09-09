import type { CategorySlug } from './types';

export interface CategoryMeta {
  slug: CategorySlug;
  /** URL segment. Underscores are ugly in a path. */
  path: string;
  name: string;
  /** One line, plain language, no jargon. Shown on the landing cards. */
  blurb: string;
  /** What this kind of agent is actually allowed to touch. Sets the risk frame. */
  handles: string;
  /** The question a buyer should ask before hiring one of these. */
  buyerQuestion: string;
  /** Token names from the Nibbin palette. Text-safe deeps only. */
  accent: string;
  accentTint: string;
}

// Four categories, one shape, equal depth. If one of these ever gets a longer
// entry than the others, that is a bug in the product, not a nicety.
export const CATEGORIES: CategoryMeta[] = [
  {
    slug: 'rebalancing',
    path: 'rebalancing',
    name: 'Rebalancing',
    blurb: 'Holds a target allocation and trades back to it when the market drifts.',
    handles: 'Portfolio weights and swap execution.',
    buyerQuestion: 'Can it actually place a trade, or only tell you to?',
    accent: 'var(--color-teal-deep)',
    accentTint: 'var(--color-teal-tint)',
  },
  {
    slug: 'grid_trading',
    path: 'grid-trading',
    name: 'Grid trading',
    blurb: 'Places laddered buy and sell orders across a price range and works the spread.',
    handles: 'Open orders, order size, and the price band.',
    buyerQuestion: 'Does it expose the grid parameters, or is the strategy a black box?',
    accent: 'var(--color-plum-deep)',
    accentTint: 'var(--color-plum-tint)',
  },
  {
    slug: 'yield',
    path: 'yield',
    name: 'Yield',
    blurb: 'Finds and moves capital into lending or LP positions that pay a return.',
    handles: 'Deposits, withdrawals, and which protocol holds your funds.',
    buyerQuestion: 'Does it name the venues it will move into, before it moves?',
    accent: 'var(--color-moss-deep)',
    accentTint: 'var(--color-moss-tint)',
  },
  {
    slug: 'health_factor',
    path: 'health-factor',
    name: 'Health factor',
    blurb: 'Watches a leveraged position and acts before it gets liquidated.',
    handles: 'Collateral, debt, and the timing of a top-up or unwind.',
    buyerQuestion: 'How fast does it answer? A slow monitor is not a monitor.',
    accent: 'var(--color-coral-deep)',
    accentTint: 'var(--color-coral-tint)',
  },
];

export const CATEGORY_BY_PATH = new Map(CATEGORIES.map((c) => [c.path, c]));
export const CATEGORY_BY_SLUG = new Map(CATEGORIES.map((c) => [c.slug, c]));

export function categoryLabel(slug: CategorySlug): string {
  return CATEGORY_BY_SLUG.get(slug)?.name ?? 'Other';
}
