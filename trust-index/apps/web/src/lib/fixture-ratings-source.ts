/**
 * FixtureRatingsSource: the compendium with zero infrastructure.
 *
 * Reads a committed sample of the real store (fixtures/ratings/compendium.json,
 * generated from the live mcp-registry population) and applies the same
 * filtering, ordering and pagination the Postgres source asks the database for.
 * `test/ratings-source.test.ts` runs one contract suite against both, which is
 * what "drop-in compatible" has to mean if it is to mean anything.
 *
 * The fixture is a SAMPLE and says so. It carries five subjects chosen to cover
 * every state the reader has to be able to tell apart — a scored rating, a
 * rating withheld for incompleteness, a withheld rating with a gate fired, and
 * the coverage-1.00/completeness-0.13 case — plus series exercising all four
 * day-states. What it does NOT do is claim a population it does not have:
 * `listKinds()` counts these rows, not the six hundred they were drawn from.
 *
 * ORDERING PARITY IS THE FIDDLY PART and it is where a fixture source usually
 * lies. Postgres sorts a null composite with NULLS LAST; JavaScript's default
 * comparator would sort `null` as less than every number, i.e. exactly the
 * withheld-is-zero bug in sorting clothes. `compareRatings` below reproduces
 * NULLS LAST explicitly.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { clampLimit, decodeCursor, encodeCursor } from "./pagination.js";
import {
  DEFAULT_PROFILE_ID,
  SERIES_DAYS,
  type RatedKind,
  type RatingsHealth,
  type RatingsSource,
  type SubjectDetail,
  type SubjectDetailQuery,
  type SubjectListOrder,
  type SubjectListQuery,
  type SubjectPage,
  type SubjectRef,
  type SubjectSeries,
  type SubjectSeriesQuery,
  type SubjectSnapshot,
} from "./ratings-source.js";

const HERE = dirname(fileURLToPath(import.meta.url));
// apps/web/src/lib -> trust-index/fixtures/ratings
const FIXTURE_FILE = join(HERE, "..", "..", "..", "..", "fixtures", "ratings", "compendium.json");

type CompendiumFixture = {
  fixture_version: string;
  through_day: string;
  note: string;
  health: RatingsHealth;
  subjects: SubjectDetail[];
  series: SubjectSeries[];
};

let cache: CompendiumFixture | null = null;

function load(): CompendiumFixture {
  cache ??= JSON.parse(readFileSync(FIXTURE_FILE, "utf8")) as CompendiumFixture;
  return cache;
}

function sameRef(a: SubjectRef, b: SubjectRef): boolean {
  return a.kind === b.kind && a.source_registry === b.source_registry && a.subject_id === b.subject_id;
}

/** The listing row of a detail row: the detail minus the parts only a detail serves. */
function toSnapshot(d: SubjectDetail): SubjectSnapshot {
  // Destructure-to-omit: the four names exist only to be dropped from `rest`.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { source: _source, dimensions: _dimensions, gates_fired: _gates, harness_gaps: _gaps, ...rest } = d;
  return rest;
}

/**
 * Postgres's ordering, reproduced.
 *
 * NULLS LAST in both directions: a withheld rating has no place on a score axis
 * at either end. Falling back to the subject key makes the order total, so
 * paging cannot repeat or skip a row — the same reason the SQL does it.
 */
function compareRatings(a: SubjectSnapshot, b: SubjectSnapshot, order: SubjectListOrder): number {
  // Compared field by field rather than through a joined key string. Joining
  // needs a separator that cannot occur in either part, and subject ids here
  // contain slashes, dots and colons; comparing the columns in order is what
  // Postgres does and needs no separator at all.
  const tie = () => {
    if (a.ref.source_registry !== b.ref.source_registry) {
      return a.ref.source_registry < b.ref.source_registry ? -1 : 1;
    }
    if (a.ref.subject_id !== b.ref.subject_id) return a.ref.subject_id < b.ref.subject_id ? -1 : 1;
    return 0;
  };

  if (order === "subject_asc") return tie();
  if (order === "day_desc") {
    if (a.utc_day !== b.utc_day) return a.utc_day < b.utc_day ? 1 : -1;
    return tie();
  }
  const av = a.rating.state === "scored" ? Number(a.rating.composite) : null;
  const bv = b.rating.state === "scored" ? Number(b.rating.composite) : null;
  if (av === null && bv === null) return tie();
  if (av === null) return 1;
  if (bv === null) return -1;
  if (av !== bv) return order === "composite_desc" ? bv - av : av - bv;
  return tie();
}

export class FixtureRatingsSource implements RatingsSource {
  async listSubjects(q: SubjectListQuery): Promise<SubjectPage> {
    const profile_id = q.profile_id ?? DEFAULT_PROFILE_ID;
    const throughDay = q.through_day ?? load().through_day;

    const inKind = load()
      .subjects.filter(
        (s) =>
          s.ref.kind === q.kind &&
          s.profile_id === profile_id &&
          (q.source_registry === undefined || s.ref.source_registry === q.source_registry) &&
          s.utc_day <= throughDay,
      )
      .map(toSnapshot);

    const state = q.state ?? "all";
    const filtered = inKind.filter(
      (s) => state === "all" || (state === "scored" ? s.rating.state === "scored" : s.rating.state === "withheld"),
    );
    filtered.sort((a, b) => compareRatings(a, b, q.order ?? "composite_desc"));

    const limit = clampLimit(q.limit ?? null);
    const offset = decodeCursor(q.cursor ?? null);
    const items = filtered.slice(offset, offset + limit);
    const nextOffset = offset + items.length;
    return {
      items,
      next_cursor: nextOffset < filtered.length ? encodeCursor(nextOffset) : null,
      total: filtered.length,
      total_unfiltered: inKind.length,
    };
  }

  async getSubject(ref: SubjectRef, q?: SubjectDetailQuery): Promise<SubjectDetail | null> {
    const profile_id = q?.profile_id ?? DEFAULT_PROFILE_ID;
    const through = q?.through_day ?? load().through_day;
    return (
      load().subjects.find((s) => sameRef(s.ref, ref) && s.profile_id === profile_id && s.utc_day <= through) ?? null
    );
  }

  async getSubjectSeries(ref: SubjectRef, q?: SubjectSeriesQuery): Promise<SubjectSeries | null> {
    const profile_id = q?.profile_id ?? DEFAULT_PROFILE_ID;
    const found = load().series.find((s) => sameRef(s.ref, ref) && s.profile_id === profile_id);
    if (found === undefined) return null;
    const days = q?.days ?? SERIES_DAYS;
    // Narrowing keeps the tail, matching the store: a shorter window is the most
    // recent N days, and every day in it is still present.
    const window = found.days.slice(Math.max(0, found.days.length - days));
    return {
      ...found,
      days: window,
      from_day: window[0]?.utc_day ?? found.from_day,
    };
  }

  async listKinds(): Promise<RatedKind[]> {
    const byKey = new Map<string, RatedKind>();
    for (const s of load().subjects) {
      const k = JSON.stringify([s.ref.kind, s.ref.source_registry, s.profile_id]);
      const at = byKey.get(k);
      if (at === undefined) {
        byKey.set(k, {
          kind: s.ref.kind,
          source_registry: s.ref.source_registry,
          profile_id: s.profile_id,
          subjects: 1,
          latest_day: s.utc_day,
        });
        continue;
      }
      at.subjects += 1;
      if (s.utc_day > at.latest_day) at.latest_day = s.utc_day;
    }
    return [...byKey.values()].sort((a, b) =>
      a.kind === b.kind ? a.source_registry.localeCompare(b.source_registry) : a.kind.localeCompare(b.kind),
    );
  }

  async getHealth(): Promise<RatingsHealth> {
    return load().health;
  }
}
