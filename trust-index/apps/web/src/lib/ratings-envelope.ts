/**
 * The envelope for the compendium endpoints.
 *
 * Separate from envelope.ts for the same reason RatingsSource is separate from
 * DataSource, and it is the cleanest illustration of it: `ApiMeta` requires
 * `indexed_through_block: number`. A daily snapshot has no block. Reusing that
 * meta would mean putting a number there — 0, or the chain's latest, or the
 * observation count — and every one of those is a value nobody measured,
 * published in the field a reader uses to decide how current the data is.
 *
 * So this path carries its own meta, which says the things that are actually
 * true of a rating: which day it covers, which profile and methodology produced
 * it, and whether it came out of the store or out of a fixture.
 */
import { ratingsSourceKind } from "./get-ratings-source.js";
import type { Rating, SubjectSnapshot } from "./ratings-source.js";

export type RatingsMeta = {
  rating_methodology_version: string | null;
  profile_id: string;
  /** Most recent day the response was allowed to consider. */
  as_of_day: string;
  /** Where these rows came from. Never inferred by the reader. */
  served_from: "postgres" | "fixture";
  /** True while any served constant is provisional. */
  constants_provisional: boolean;
  /**
   * Plain-language notes about what the reader is looking at. Always an array,
   * empty when there is nothing to say — never a single string that a caller
   * has to parse.
   */
  disclaimers: string[];
};

export type RatingsEnvelope<T> = { data: T; meta: RatingsMeta };

/**
 * Why a withheld rating is withheld, said once, in words.
 *
 * The engine's `composite_suppression_reason` is exact and terse. These lines
 * exist because the terse version has a failure mode: "too little of the
 * profile could be assessed at all" reads, to somebody skimming, as a fact
 * about the subject. It is a fact about US, and where that is what happened the
 * disclaimer says so in the first clause.
 */
export const SUPPRESSION_NOTES: Record<string, string> = {
  "too little of the profile could be assessed at all; see harness_gaps":
    "This rating is withheld because OUR harness could not assess enough of the profile — " +
    "the missing checks are listed under harness_gaps with the capability each needed. " +
    "It is not a statement that the subject scored badly.",
  "capped by a gate; see gates_fired":
    "A gate fired on this subject: a single finding capped the composite rather than being " +
    "averaged away. The finding and the ceiling it imposes are listed under gates_fired.",
  "n_eff below suppression floor":
    "There is too little weighted evidence to publish an estimate. The interval would be " +
    "wider than the scale.",
  "no observations with an accepted provenance":
    "Nothing admissible reached this rating. Evidence existed but not of a kind this " +
    "profile accepts for these dimensions.",
  "too little of the profile's weight has a published dimension":
    "Enough of the profile was assessable, but too little of it produced a publishable " +
    "dimension score.",
};

/**
 * The line every withheld rating carries whether or not its reason is known.
 *
 * A withheld rating is neither a zero nor a missing one, and the one place that
 * is guaranteed to be read is the envelope.
 */
export const WITHHELD_NOTE =
  "A withheld rating is not a score of zero and not missing data: it was computed and " +
  "deliberately not published. Read the suppression reason, not the absence of a number.";

/**
 * The line that goes with every response carrying coverage numbers.
 *
 * Repeated on every payload rather than parked on a methodology page, because
 * the confusion it prevents happens at the moment somebody reads the two
 * numbers, and by then they are not on the methodology page.
 */
export const COVERAGE_NOTE =
  "dimension_coverage and assessment_completeness are two different measurements and must " +
  "not be combined. Coverage is the share of what we could assess that produced a score; " +
  "completeness is the share of the profile we were able to attempt at all. A low " +
  "completeness is our shortfall, not the subject's.";

function noteFor(rating: Rating): string | null {
  if (rating.state === "scored") return null;
  if (rating.suppression_reason === null) return null;
  return SUPPRESSION_NOTES[rating.suppression_reason] ?? null;
}

/**
 * Meta for a response, derived from the rows it actually carries.
 *
 * `rating_methodology_version` is null rather than a guess when the response
 * carries no rows, and null rather than a pick when the rows disagree — two
 * days scored under different methodologies do not have a version between them.
 */
export function buildRatingsMeta(input: {
  profile_id: string;
  as_of_day: string;
  snapshots?: SubjectSnapshot[];
  extraDisclaimers?: string[];
}): RatingsMeta {
  const versions = new Set((input.snapshots ?? []).map((s) => s.rating_methodology_version));
  const disclaimers = [...(input.extraDisclaimers ?? [])];

  const snapshots = input.snapshots ?? [];
  if (snapshots.length > 0) disclaimers.push(COVERAGE_NOTE);
  if (snapshots.some((s) => s.rating.state === "withheld")) disclaimers.push(WITHHELD_NOTE);
  for (const s of snapshots) {
    const note = noteFor(s.rating);
    if (note !== null && !disclaimers.includes(note)) disclaimers.push(note);
  }
  if (versions.size > 1) {
    disclaimers.push(
      "These rows were produced under more than one methodology version and are not directly " +
        "comparable; each row carries its own.",
    );
  }

  return {
    rating_methodology_version: versions.size === 1 ? [...versions][0]! : null,
    profile_id: input.profile_id,
    as_of_day: input.as_of_day,
    served_from: ratingsSourceKind(),
    constants_provisional: true,
    disclaimers,
  };
}

export function buildRatingsEnvelope<T>(data: T, meta: RatingsMeta): RatingsEnvelope<T> {
  return { data, meta };
}
