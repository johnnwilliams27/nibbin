/**
 * The §4.5 drip table, as data. The table is the floor of the experience,
 * not the ceiling — evolution/graduation events fire whenever earned,
 * independent of this calendar (see worker.ts earned-event handling).
 */
import type { BeatDef, BeatKey, QuietHours } from './types';

/** Default delivery window opens mid-morning; reports land in the evening. */
const MORNING = 10;
const EVENING = 18;
const CEREMONY = 17;

export const BEATS: readonly BeatDef[] = [
  { key: 'field_notes_1', day: 1, earliestHour: EVENING, kind: 'standard' },
  { key: 'species', day: 2, earliestHour: MORNING, kind: 'standard' },
  { key: 'training_1', day: 3, earliestHour: MORNING, kind: 'standard' },
  { key: 'journal', day: 4, earliestHour: MORNING, kind: 'standard' },
  // Day 5 is study-or-scan: the whisper needs a running Field Study; everyone
  // else gets a deeper scan insight in the same slot (§4.5 footnote).
  { key: 'study_whisper', day: 5, earliestHour: MORNING, kind: 'standard', requires: 'study', substitute: 'scan_depth' },
  { key: 'half_time', day: 7, earliestHour: CEREMONY, kind: 'ceremony' },
  { key: 'training_2', day: 9, earliestHour: MORNING, kind: 'standard' },
  { key: 'map_preview', day: 10, earliestHour: MORNING, kind: 'ceremony' },
  // Day 12 only exists when someone is close — otherwise the day stays quiet.
  // Quiet is fine: nothing nags, and a manufactured beat would be filler.
  { key: 'graduation_eve', day: 12, earliestHour: MORNING, kind: 'standard', requires: 'near_graduation' },
  { key: 'diagnosis_reveal', day: 14, earliestHour: CEREMONY, kind: 'ceremony' },
] as const;

export const ARC_LENGTH_DAYS = 14;

export const BEAT_KEYS: readonly BeatKey[] = [
  ...BEATS.map((b) => b.key),
  'scan_depth',
] as const;

export function beatDef(key: BeatKey): BeatDef {
  const def = BEATS.find((b) => b.key === key || b.substitute === key);
  if (!def) throw new Error(`unknown beat: ${key}`);
  return def;
}

/** Default quiet hours: nothing between 21:00 and 09:00 local. */
export const DEFAULT_QUIET: QuietHours = { start: 21, end: 9 };

export function inQuietHours(hour: number, quiet: QuietHours): boolean {
  if (quiet.start === quiet.end) return false; // degenerate config = disabled
  return quiet.start < quiet.end
    ? hour >= quiet.start && hour < quiet.end
    : hour >= quiet.start || hour < quiet.end;
}
