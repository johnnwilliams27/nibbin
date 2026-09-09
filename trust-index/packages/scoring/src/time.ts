/**
 * Pure timestamp arithmetic (SPEC 22). The engine never reads a clock: every
 * timestamp comes from the snapshot as an ISO-8601 UTC string with second
 * precision and a trailing Z, and is parsed here with explicit integer math.
 * No Date object is constructed anywhere in this package.
 */

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/;

/**
 * Days since 1970-01-01 for a proleptic Gregorian civil date. Standard
 * days-from-civil algorithm (Howard Hinnant), integer arithmetic only.
 */
function daysFromCivil(y: number, m: number, d: number): number {
  y -= m <= 2 ? 1 : 0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/**
 * Parse an ISO-8601 UTC timestamp (YYYY-MM-DDTHH:MM:SSZ) to epoch seconds.
 * Throws on any other shape or an out-of-range field. Leap seconds are not
 * representable (seconds field must be 00-59), matching POSIX time.
 */
export function parseIsoUtcSeconds(ts: string): number {
  const m = ISO_RE.exec(ts);
  if (m === null) {
    throw new SyntaxError(`not an ISO-8601 UTC second-precision timestamp: ${JSON.stringify(ts)}`);
  }
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6]);
  if (month < 1 || month > 12) throw new RangeError(`month out of range in ${ts}`);
  const maxDay = DAYS_IN_MONTH[month - 1]! + (month === 2 && isLeap(year) ? 1 : 0);
  if (day < 1 || day > maxDay) throw new RangeError(`day out of range in ${ts}`);
  if (hour > 23 || minute > 59 || second > 59) throw new RangeError(`time out of range in ${ts}`);
  return daysFromCivil(year, month, day) * 86400 + hour * 3600 + minute * 60 + second;
}

/** Whole days between two epoch-second instants, floored. `a` must be >= `b`. */
export function floorDaysBetween(a: number, b: number): number {
  if (a < b) throw new RangeError("floorDaysBetween: a must be >= b");
  return Math.floor((a - b) / 86400);
}
