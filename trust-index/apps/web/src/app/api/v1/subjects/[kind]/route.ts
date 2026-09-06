import { checkRateLimit, errorResponse, jsonResponse } from "@/lib/api-handler";
import { getRatingsSource } from "@/lib/get-ratings-source";
import { buildRatingsEnvelope, buildRatingsMeta } from "@/lib/ratings-envelope";
import { DEFAULT_PROFILE_ID, todayUtc } from "@/lib/ratings-source";
import { parseListParams } from "@/lib/subject-route";

/**
 * GET /api/v1/subjects/:kind
 *
 * The compendium listing: one row per subject, its most recent stored snapshot,
 * filtered and ordered and paginated.
 *
 * `state=withheld` is a first-class query and not a debugging aid. On the live
 * population it returns 439 of 600 rows, every one of them withheld because our
 * own harness could not assess enough of the profile. A listing that could only
 * return the 161 published rows would present a quarter of the population as if
 * it were the whole of it.
 */
export async function GET(request: Request, ctx: { params: Promise<{ kind: string }> }) {
  const limited = checkRateLimit(request, "anonymous");
  if (limited) return limited;

  const { kind } = await ctx.params;
  const q = parseListParams(new URL(request.url));
  const profile_id = q.profile_id ?? DEFAULT_PROFILE_ID;
  const as_of_day = q.through_day ?? todayUtc();

  const page = await getRatingsSource().listSubjects({
    kind,
    profile_id,
    state: q.state,
    order: q.order,
    cursor: q.cursor,
    ...(q.limit === null ? {} : { limit: q.limit }),
    ...(q.source_registry === undefined ? {} : { source_registry: q.source_registry }),
    ...(q.through_day === undefined ? {} : { through_day: q.through_day }),
  });

  // An empty page for a kind nobody rates is a 404; an empty page because the
  // filter excluded everything is a 200 with an empty list and a total of 0.
  // Conflating them would tell a caller that "no withheld subjects" and "no such
  // kind" are the same answer.
  if (page.total_unfiltered === 0) {
    return errorResponse("not_found", `no rated subjects of kind ${kind}`);
  }

  const meta = buildRatingsMeta({ profile_id, as_of_day, snapshots: page.items });
  return jsonResponse(buildRatingsEnvelope(page, meta));
}
