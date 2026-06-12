/**
 * The ceremony beats: day 7 Half-time Report, day 10 map preview, day 14
 * Diagnosis Reveal. Each consumes M4 data where it exists and degrades to
 * honest, shorter copy where it doesn't (stub port → empty arrays/nulls).
 *
 * Claims note (C1/C7): study-derived numbers live on the device. The cloud
 * ceremony is the frame — "your week-one sketch is waiting in your grove" —
 * never the carrier of per-app hours.
 */
import { ARC_LENGTH_DAYS } from './beats';
import { localDay } from './localtime';
import { scoreboardCards } from './field-notes';
import type { ArcDataPort, ArcFlags, BeatCard, BeatContent, Celebration } from './types';

function diagnosisDate(startedAt: Date, tz: string): string {
  const due = new Date(startedAt.getTime() + ARC_LENGTH_DAYS * 86_400_000);
  return localDay(due, tz);
}

export async function buildHalfTime(
  accountId: string,
  today: string,
  startedAt: Date,
  tz: string,
  flags: ArcFlags,
  data: ArcDataPort,
): Promise<BeatContent> {
  const [day, events] = await Promise.all([
    data.nibbinDay(accountId, today),
    data.earnedEvents(accountId),
  ]);

  const cards: BeatCard[] = scoreboardCards(day);
  cards.push({
    title: 'Diagnosis day',
    body: `Your diagnosis is on track for ${diagnosisDate(startedAt, tz)}.`,
  });
  if (flags.studyActive) {
    cards.push({
      title: 'Week one, sketched',
      body: 'Your time-by-app sketch lives on your desk — the Observer drew it without sending me a thing. Open your grove on that machine to see it.',
    });
  }

  // One evolution if earned (§4.5) — the single celebration of this email.
  const evolution = events.find((e) => e.kind === 'evolution');
  const celebration: Celebration | null = evolution
    ? { heading: `${evolution.nibbin} evolved`, body: evolution.detail }
    : null;

  return {
    key: 'half_time',
    title: 'Half-time Report',
    body: 'We’re a week in — halfway to your diagnosis. Here’s the shape of week one.',
    cards,
    celebration,
    ctaPath: '/app',
    ctaLabel: 'See the full report',
  };
}

export async function buildMapPreview(accountId: string, data: ArcDataPort): Promise<BeatContent> {
  const clusters = (await data.clusters(accountId)).slice(0, 3);
  const cards: BeatCard[] = clusters.map((c) => ({
    title: c.name,
    body:
      c.confidence >= 0.5
        ? 'Taking shape — I can see the edges of this one.'
        : 'A faint sprout so far. I’m not sure yet, and I’d rather say so.',
  }));

  const body =
    clusters.length > 0
      ? 'Your workflow map has started sprouting. Here’s the low-confidence sketch — two more workflows are still germinating.'
      : 'Your workflow map is still germinating. Nothing has broken ground that I’d show you yet — a few more days of watching and the first sprouts will be ready.';

  return {
    key: 'map_preview',
    title: 'A first look at your map',
    body,
    cards,
    celebration: null,
    ctaPath: '/app',
    ctaLabel: 'Watch it grow',
  };
}

export async function buildGraduationEve(accountId: string, data: ArcDataPort): Promise<BeatContent> {
  const near = await data.nearGraduation(accountId);
  // The scheduler only routes here when the flag is up; the port is re-read
  // for the precise number and falls back to nameless copy if it vanished.
  const who = near?.nibbin ?? 'One of your Nibbins';
  const remaining = near?.approvedDraftsRemaining ?? null;
  const count =
    remaining === null
      ? 'a handful of approved drafts'
      : remaining === 1
        ? '1 approved draft'
        : `${remaining} approved drafts`;

  return {
    key: 'graduation_eve',
    title: 'Graduation eve',
    body: `${who} is ${count} from graduating. Graduation means working within the spec without waiting on you — every run still lands in the log, and anything odd comes back as a question. The trust is yours to give, and yours to take back.`,
    cards: [],
    celebration: null,
    ctaPath: '/app',
    ctaLabel: 'See how close',
  };
}

export async function buildDiagnosisReveal(
  accountId: string,
  flags: ArcFlags,
  data: ArcDataPort,
): Promise<BeatContent> {
  const names = await data.names(accountId);
  const keeper = names.keeper ?? 'Your Grovekeeper';

  if (!flags.studyActive) {
    // No Observer: "your grove, one fortnight in" + the Field Study pitch retold.
    return {
      key: 'diagnosis_reveal',
      title: 'Your grove, one fortnight in',
      body: `Two weeks ago this was bare ground. ${keeper} here — I’ve written you a short letter about what your grove has learned so far, and what a two-week Field Study on your desk could add to the picture. It runs entirely on your machine; the only thing that ever leaves is the map.`,
      cards: [],
      celebration: { heading: 'A fortnight of growth', body: 'Your grove made it through its first two weeks — that’s worth marking.' },
      ctaPath: '/app',
      ctaLabel: 'Read the letter',
    };
  }

  return {
    key: 'diagnosis_reveal',
    title: 'Your diagnosis is ready',
    body: `${keeper} here. The study is done, the map has grown in, and your diagnosis is ready — where your hours actually go, what they’re worth, and which chores your grove can take off your hands. I’ve also written you a letter: here’s what I learned about how you work.`,
    cards: [],
    celebration: { heading: 'The reveal', body: 'Fourteen days of quiet watching, grown into one map.' },
    ctaPath: '/app',
    ctaLabel: 'Open your diagnosis',
  };
}
