/**
 * Beat content, in the Grovekeeper's voice (brand-voice skill): warm,
 * plainspoken, first person, sentence case, no urgency, no guilt. Trust is
 * "earned"/"yours to give"; demotion is dignified; streaks are training
 * streaks only.
 */
import { buildDiagnosisReveal, buildGraduationEve, buildHalfTime, buildMapPreview } from './ceremonies';
import { buildFirstFieldNotes } from './field-notes';
import type { ArcDataPort, ArcFlags, BeatContent, BeatKey } from './types';

const SPECIES_TEMPERAMENTS = [
  { title: 'Sprout', body: 'Patient and steady — happiest with chores that come back every week.' },
  { title: 'Wisp', body: 'Quick and light. First to notice something new in the inbox.' },
  { title: 'Shellback', body: 'Careful to a fault. The one you want near anything involving money.' },
  { title: 'Longear', body: 'A listener. Picks up the way your clients phrase things and keeps it.' },
  { title: 'Puff', body: 'Cheerfully tireless with the small, fiddly stuff nobody else wants.' },
  { title: 'Glim', body: 'Sees patterns early. Good at spotting the same chore wearing different clothes.' },
];

async function buildSpecies(accountId: string, data: ArcDataPort): Promise<BeatContent> {
  const names = await data.names(accountId);
  const first = names.firstNibbin;
  return {
    key: 'species',
    title: 'Meet the six species',
    body: first
      ? `Every Nibbin is one of six species, each with its own temperament. ${first} is just the first — your grove has room.`
      : 'Every Nibbin is one of six species, each with its own temperament. Your grove has room for more than one.',
    cards: SPECIES_TEMPERAMENTS,
    celebration: null,
    ctaPath: '/app',
    ctaLabel: 'Wander the grove',
  };
}

async function buildTraining(accountId: string, data: ArcDataPort, second: boolean): Promise<BeatContent> {
  const names = await data.names(accountId);
  const who = names.firstNibbin ?? 'your Nibbin';
  if (!second) {
    return {
      key: 'training_1',
      title: 'Five minutes of training',
      body: `${who} has set aside the three drafts it was least sure about. Reviewing them takes about five minutes, and every correction gets written into the journal — you’ll see exactly what was learned, each time.`,
      cards: [],
      celebration: null,
      ctaPath: '/app',
      ctaLabel: 'Start the session',
    };
  }
  return {
    key: 'training_2',
    title: 'Training session two',
    body: `${who} has three more uncertain drafts ready for your eye. One thing I want to say plainly: you can always send anyone back a grade — back to drafts is a fine place to be, and good instinct on your part. Trust here is yours to give, never something a streak hands out.`,
    cards: [],
    celebration: null,
    ctaPath: '/app',
    ctaLabel: 'Review the drafts',
  };
}

async function buildJournal(accountId: string, data: ArcDataPort): Promise<BeatContent> {
  const [entries, names] = await Promise.all([data.journal(accountId), data.names(accountId)]);
  const who = names.firstNibbin ?? 'your Nibbin';
  return {
    key: 'journal',
    title: `What ${who} has learned about you`,
    body:
      entries.length > 0
        ? `Four days in, ${who}’s journal has its first real pages. Here’s what it has learned about how you like things done.`
        : `Four days in, ${who}’s journal is still mostly blank pages — that’s normal. Every draft you correct writes a line in it. Here’s where it will all live.`,
    cards: entries.slice(0, 4).map((e) => ({ title: e.nibbin, body: e.learned })),
    celebration: null,
    ctaPath: '/app',
    ctaLabel: 'Open the journal',
  };
}

function buildStudyWhisper(): BeatContent {
  // C1/C7: the "~6h in {app}" teaser is computed and shown ON-DEVICE only.
  // This cloud beat points at it without carrying any study numbers. The
  // privacy claim must match C7 exactly: what the study WATCHES stays on the
  // machine; the redacted map is the one thing that ever leaves, at review —
  // never claim "nothing ever leaves" (claims-auditor M5 finding).
  return {
    key: 'study_whisper',
    title: 'The study is whispering',
    body: 'Your Field Study has been watching quietly from your desk all week. What it watches stays on your machine — when the study ends, the only thing that will ever leave is the redacted map, and only when you say so. It’s starting to see the shape of something. Open your grove on that computer and it’ll show you the first sketch.',
    cards: [],
    celebration: null,
    ctaPath: '/app',
    ctaLabel: 'Take a look',
  };
}

async function buildScanDepth(accountId: string, data: ArcDataPort): Promise<BeatContent> {
  const insights = await data.unseenInsights(accountId);
  return {
    key: 'scan_depth',
    title: 'Something the scan turned up',
    body:
      insights.length > 0
        ? 'I went a layer deeper into your connected accounts today and found something worth your time.'
        : 'I went a layer deeper into your connected accounts today. Nothing big enough to bring you yet — connecting another account would give me more ground to walk.',
    cards: insights.slice(0, 2).map((i) => ({ title: 'From the scan', body: i.text })),
    celebration: null,
    ctaPath: '/app',
    ctaLabel: 'See the details',
  };
}

export interface ContentCtx {
  accountId: string;
  /** Local calendar day of delivery (user's tz). */
  today: string;
  startedAt: Date;
  tz: string;
  flags: ArcFlags;
  data: ArcDataPort;
}

export async function buildBeatContent(beat: BeatKey, ctx: ContentCtx): Promise<BeatContent> {
  switch (beat) {
    case 'field_notes_1':
      return buildFirstFieldNotes(ctx.accountId, ctx.today, ctx.data);
    case 'species':
      return buildSpecies(ctx.accountId, ctx.data);
    case 'training_1':
      return buildTraining(ctx.accountId, ctx.data, false);
    case 'journal':
      return buildJournal(ctx.accountId, ctx.data);
    case 'study_whisper':
      return buildStudyWhisper();
    case 'scan_depth':
      return buildScanDepth(ctx.accountId, ctx.data);
    case 'half_time':
      return buildHalfTime(ctx.accountId, ctx.today, ctx.startedAt, ctx.tz, ctx.flags, ctx.data);
    case 'training_2':
      return buildTraining(ctx.accountId, ctx.data, true);
    case 'map_preview':
      return buildMapPreview(ctx.accountId, ctx.data);
    case 'graduation_eve':
      return buildGraduationEve(ctx.accountId, ctx.data);
    case 'diagnosis_reveal':
      return buildDiagnosisReveal(ctx.accountId, ctx.flags, ctx.data);
  }
}
