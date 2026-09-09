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
  /** Identity colour only. Category colour never encodes quality or rank. */
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
    blurb: 'Manage liquidity ranges and adjust positions as markets move.',
    handles: 'LP ranges, portfolio weights, and position adjustments.',
    buyerQuestion: 'Can it actually place a trade, or only tell you to?',
    accent: 'var(--color-cat-rebalancing)',
    accentTint: 'var(--color-cat-rebalancing-bg)',
  },
  {
    slug: 'grid_trading',
    path: 'grid-trading',
    name: 'Grid trading',
    blurb: 'Set a price range and explore agents that manage grid orders.',
    handles: 'Open orders, order size, and the price band.',
    buyerQuestion: 'Does it expose the grid parameters, or is the strategy a black box?',
    accent: 'var(--color-cat-grid)',
    accentTint: 'var(--color-cat-grid-bg)',
  },
  {
    slug: 'yield',
    path: 'yield',
    name: 'Yield optimisation',
    blurb: 'Explore strategies for allocating liquidity across yield opportunities.',
    handles: 'Deposits, withdrawals, and which protocol holds your funds.',
    buyerQuestion: 'Does it name the venues it will move into, before it moves?',
    accent: 'var(--color-cat-yield)',
    accentTint: 'var(--color-cat-yield-bg)',
  },
  {
    slug: 'health_factor',
    path: 'health-factor',
    name: 'Health factor monitoring',
    blurb: 'Monitor lending positions and understand liquidation exposure.',
    handles: 'Collateral, debt, and the timing of a top-up or unwind.',
    buyerQuestion: 'What does it monitor, how often, and can it act or only alert?',
    accent: 'var(--color-cat-health)',
    accentTint: 'var(--color-cat-health-bg)',
  },
];

export const CATEGORY_BY_PATH = new Map(CATEGORIES.map((c) => [c.path, c]));
export const CATEGORY_BY_SLUG = new Map(CATEGORIES.map((c) => [c.slug, c]));

export function categoryLabel(slug: CategorySlug): string {
  return CATEGORY_BY_SLUG.get(slug)?.name ?? 'Other';
}
