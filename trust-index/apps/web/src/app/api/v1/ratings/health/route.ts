import { checkRateLimit, jsonResponse } from "@/lib/api-handler";
import { getRatingsSource } from "@/lib/get-ratings-source";
import { buildRatingsEnvelope, buildRatingsMeta } from "@/lib/ratings-envelope";
import { DEFAULT_PROFILE_ID, todayUtc } from "@/lib/ratings-source";

/**
 * GET /api/v1/ratings/health
 *
 * The collection run ledger: what the daily job did, each night, and what it
 * said when it failed.
 *
 * This endpoint is what makes `not_run` in a series an honest state rather than
 * a shrug. A reader who sees a hole in a sparkline can come here and find the
 * night, its status, and the first line of the error. A ratings source that
 * publishes gaps without publishing its own uptime is asking to be trusted on
 * the days it happens to have data for.
 */
export async function GET(request: Request) {
  const limited = checkRateLimit(request, "anonymous");
  if (limited) return limited;

  const health = await getRatingsSource().getHealth();
  const failed = health.runs.filter((r) => r.status !== "succeeded");
  const meta = buildRatingsMeta({
    profile_id: DEFAULT_PROFILE_ID,
    as_of_day: todayUtc(),
    extraDisclaimers:
      failed.length === 0
        ? []
        : [
            `${failed.length} of the last ${health.runs.length} recorded runs did not succeed. ` +
              "Days those runs cover read as `not_run` in a series and carry no rating for any subject.",
          ],
  });
  return jsonResponse(buildRatingsEnvelope(health, meta));
}
