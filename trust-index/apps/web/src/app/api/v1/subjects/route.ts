import { checkRateLimit, jsonResponse } from "@/lib/api-handler";
import { getRatingsSource } from "@/lib/get-ratings-source";
import { buildRatingsEnvelope, buildRatingsMeta } from "@/lib/ratings-envelope";
import { DEFAULT_PROFILE_ID, todayUtc } from "@/lib/ratings-source";

/**
 * GET /api/v1/subjects
 *
 * What is rated at all: every (kind, registry, profile) with stored ratings,
 * how many subjects each holds, and the most recent day stored for it.
 *
 * An empty list is a 200 and not a 404. "We rate nothing right now" is a true
 * and serviceable answer about our own store, and a caller polling this to find
 * out whether the pipeline is alive should not have to treat that as an error.
 */
export async function GET(request: Request) {
  const limited = checkRateLimit(request, "anonymous");
  if (limited) return limited;

  const kinds = await getRatingsSource().listKinds();
  const meta = buildRatingsMeta({ profile_id: DEFAULT_PROFILE_ID, as_of_day: todayUtc() });
  return jsonResponse(buildRatingsEnvelope({ kinds }, meta));
}
