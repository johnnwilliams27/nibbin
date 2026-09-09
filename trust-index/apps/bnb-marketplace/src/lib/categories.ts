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

// Twelve categories, one shape, equal depth. If one of these ever gets a longer
// entry than the others, that is a bug in the product, not a nicety.
export const CATEGORIES: CategoryMeta[] = [
  {
    slug: 'rebalancing',
    path: 'rebalancing',
    name: 'Rebalancing',
    blurb: 'Holds a target allocation and trades back to it when the market drifts.',
    handles: 'Portfolio weights and swap execution.',
    buyerQuestion: 'Can it actually place a trade, or only tell you to?',
    accent: 'var(--color-cat-rebalancing)',
    accentTint: 'var(--color-cat-rebalancing-bg)',
  },
  {
    slug: 'grid_trading',
    path: 'grid-trading',
    name: 'Grid trading',
    blurb: 'Places laddered buy and sell orders across a price range and works the spread.',
    handles: 'Open orders, order size, and the price band.',
    buyerQuestion: 'Does it expose the grid parameters, or is the strategy a black box?',
    accent: 'var(--color-cat-grid)',
    accentTint: 'var(--color-cat-grid-bg)',
  },
  {
    slug: 'yield',
    path: 'yield',
    name: 'Yield',
    blurb: 'Finds and moves capital into lending or LP positions that pay a return.',
    handles: 'Deposits, withdrawals, and which protocol holds your funds.',
    buyerQuestion: 'Does it name the venues it will move into, before it moves?',
    accent: 'var(--color-cat-yield)',
    accentTint: 'var(--color-cat-yield-bg)',
  },
  {
    slug: 'health_factor',
    path: 'health-factor',
    name: 'Health factor',
    blurb: 'Watches a leveraged position and acts before it gets liquidated.',
    handles: 'Collateral, debt, and the timing of a top-up or unwind.',
    buyerQuestion: 'How fast does it answer? A slow monitor is not a monitor.',
    accent: 'var(--color-cat-health)',
    accentTint: 'var(--color-cat-health-bg)',
  },
  {
    slug: 'payments',
    path: 'payments',
    name: 'Payments',
    blurb: 'Moves stablecoins on your behalf, usually without you paying gas.',
    handles: 'Stablecoin balances, transfer authority and settlement.',
    buyerQuestion: 'What stops it sending twice, or sending to the wrong address?',
    accent: 'var(--color-cat-payments)',
    accentTint: 'var(--color-cat-payments-bg)',
  },
  {
    slug: 'security',
    path: 'security',
    name: 'Security',
    blurb: 'Reviews contracts and flags vulnerabilities before you deploy or deposit.',
    handles: 'Source code and audit findings. Usually reads, rarely writes.',
    buyerQuestion: 'Does it show its evidence, or just assert that something is safe?',
    accent: 'var(--color-cat-security)',
    accentTint: 'var(--color-cat-security-bg)',
  },
  {
    slug: 'research',
    path: 'research',
    name: 'Research',
    blurb: 'Reads markets, protocols and on-chain data, and reports what it found.',
    handles: 'Public data and its own conclusions. Touches no funds.',
    buyerQuestion: 'When it does not know, does it say so \u2014 or fabricate a number?',
    accent: 'var(--color-cat-research)',
    accentTint: 'var(--color-cat-research-bg)',
  },
  {
    slug: 'content',
    path: 'content',
    name: 'Content',
    blurb: 'Writes copy, posts and long-form text on a topic you give it.',
    handles: 'Text it produces, and any account you let it post from.',
    buyerQuestion: 'Will it invent a fact to finish a sentence?',
    accent: 'var(--color-cat-content)',
    accentTint: 'var(--color-cat-content-bg)',
  },
  {
    slug: 'development',
    path: 'development',
    name: 'Development',
    blurb: 'Writes and reviews code, including smart contracts.',
    handles: 'Source it generates. What you do with that is on you.',
    buyerQuestion: 'Has anything it wrote been audited, or is it shipping unreviewed?',
    accent: 'var(--color-cat-development)',
    accentTint: 'var(--color-cat-development-bg)',
  },
  {
    slug: 'automation',
    path: 'automation',
    name: 'Automation',
    blurb: 'Runs workflows and operational tasks on a schedule or a trigger.',
    handles: 'Whatever the workflow it runs is allowed to touch.',
    buyerQuestion: 'What happens on a step that fails halfway through?',
    accent: 'var(--color-cat-automation)',
    accentTint: 'var(--color-cat-automation-bg)',
  },
  {
    slug: 'trading',
    path: 'trading',
    name: 'Trading',
    blurb: 'Takes and manages positions autonomously, rather than to a fixed allocation.',
    handles: 'Order flow, position size and exits.',
    buyerQuestion: 'Can you see the strategy, or only the trades after the fact?',
    accent: 'var(--color-cat-trading)',
    accentTint: 'var(--color-cat-trading-bg)',
  },
  {
    slug: 'staking',
    path: 'staking',
    name: 'Staking',
    blurb: 'Stakes and restakes, and picks where the stake goes.',
    handles: 'Staked principal and the validator or protocol chosen.',
    buyerQuestion: 'What is the unbonding period, and who bears a slashing event?',
    accent: 'var(--color-cat-staking)',
    accentTint: 'var(--color-cat-staking-bg)',
  },
];

export const CATEGORY_BY_PATH = new Map(CATEGORIES.map((c) => [c.path, c]));
export const CATEGORY_BY_SLUG = new Map(CATEGORIES.map((c) => [c.slug, c]));

export function categoryLabel(slug: CategorySlug): string {
  return CATEGORY_BY_SLUG.get(slug)?.name ?? 'Other';
}
