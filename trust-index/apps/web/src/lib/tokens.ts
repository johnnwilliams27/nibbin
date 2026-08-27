/**
 * Design tokens (SPEC 14.1, 14A). The only source of color and type values in
 * the app; docs/design-plan.md is the rationale. test/contrast.test.ts
 * verifies the text pairs computationally against WCAG AA.
 */

export const PALETTE = {
  /** Primary text. */
  ink: "#1B2228",
  /** Page ground. */
  paper: "#F2F3F0",
  /** Secondary text: labels, captions, table headers. */
  slate: "#4A5560",
  /** Interval band fill. Identical for every tier; geometry carries meaning. */
  band: "#2E5E79",
  /** Point-estimate marker, links, focus ring. */
  marker: "#143C57",
  /** Rules and table borders only. Never text. */
  hairline: "#D7DAD3",
} as const;

export type TokenName = keyof typeof PALETTE;

/** Text/background pairs that must meet WCAG AA (4.5:1). */
export const AA_TEXT_PAIRS: ReadonlyArray<[fg: TokenName, bg: TokenName]> = [
  ["ink", "paper"],
  ["slate", "paper"],
  ["marker", "paper"],
];

/** Graphic pairs that must meet WCAG 1.4.11 (3:1). */
export const AA_GRAPHIC_PAIRS: ReadonlyArray<[fg: TokenName, bg: TokenName]> = [
  ["band", "paper"],
  ["marker", "paper"],
];

/** Fallback stacks; the primary faces load via next/font/local in app/fonts.ts. */
export const FONT_FALLBACKS = {
  mono: `ui-monospace, "Cascadia Mono", "Roboto Mono", monospace`,
  sans: `system-ui, "Segoe UI", Helvetica, Arial, sans-serif`,
} as const;

/** CSS custom-property block rendered once in the root layout. */
export function tokenCss(): string {
  const vars = Object.entries(PALETTE)
    .map(([name, hex]) => `--color-${name}: ${hex};`)
    .join("\n  ");
  return `:root {\n  ${vars}\n}`;
}
