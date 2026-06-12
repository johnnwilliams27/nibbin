/**
 * Cloud Field Notes (§4.5 day 1, and the scoreboard inside day 7).
 *
 * These are built from CLOUD data only: Nibbin run summaries and connector
 * scan insights via the M4 port. The Observer's on-device Field Notes
 * (apps/desktop/src/core/field-notes.ts) are a separate, local thing — per
 * C1/C7 their numbers never appear here. Where M4 is still in flight the
 * port returns nothing and the copy degrades gracefully instead of lying.
 */
import type { ArcDataPort, BeatCard, BeatContent, NibbinDaySummary } from './types';

function nibbinLine(n: NibbinDaySummary): string {
  const nibbles = n.runs === 1 ? '1 nibble done' : `${n.runs} nibbles done`;
  if (n.draftsWaiting === 0) return `${nibbles}, nothing waiting on you`;
  const drafts = n.draftsWaiting === 1 ? '1 draft waiting on you' : `${n.draftsWaiting} drafts waiting on you`;
  return `${nibbles}, ${drafts}`;
}

export function scoreboardCards(day: NibbinDaySummary[]): BeatCard[] {
  return day.map((n) => ({ title: n.name, body: nibbinLine(n) }));
}

export async function buildFirstFieldNotes(
  accountId: string,
  localDay: string,
  data: ArcDataPort,
): Promise<BeatContent> {
  const [day, insights] = await Promise.all([
    data.nibbinDay(accountId, localDay),
    data.unseenInsights(accountId),
  ]);

  const cards = scoreboardCards(day);
  const insight = insights[0];
  if (insight) cards.push({ title: 'From the scan', body: insight.text });

  const body =
    day.length > 0
      ? 'Evening. Here are your first Field Notes — what your grove got up to today, and one thing the scan noticed that you haven’t seen yet.'
      : 'Evening. Your grove is still settling in, so tonight’s Field Notes are short. I walked the scan again and set aside the first thing worth your time.';

  return {
    key: 'field_notes_1',
    title: 'Your first Field Notes',
    body,
    cards,
    celebration: null,
    ctaPath: '/app',
    ctaLabel: 'Open your grove',
  };
}
