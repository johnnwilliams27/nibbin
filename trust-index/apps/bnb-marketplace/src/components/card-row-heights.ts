/** Only natural collapsed content is measured; disclosure height is excluded. */
export function rowBaseHeights(cards: ReadonlyArray<{ top: number; height: number }>): number[] {
  const rows = new Map<number, number>();
  for (const card of cards) rows.set(card.top, Math.max(rows.get(card.top) ?? 0, Math.ceil(card.height)));
  return cards.map((card) => rows.get(card.top)!);
}
