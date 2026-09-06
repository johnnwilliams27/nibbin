import { checkRateLimit, errorResponse, jsonResponse } from "@/lib/api-handler";
import { getRatingsSource } from "@/lib/get-ratings-source";
import { buildRatingsEnvelope, buildRatingsMeta } from "@/lib/ratings-envelope";
import { DEFAULT_PROFILE_ID, SERIES_DAYS, todayUtc } from "@/lib/ratings-source";
import { parseSubjectRoute } from "@/lib/subject-route";

/**
 * GET /api/v1/series/:kind/:registry/:subject_id
 *
 * One subject's window of days for a sparkline. Every day in the window is
 * present in the array, in four distinguishable states.
 *
 * The array is dense on purpose and the response says so. A caller that plotted
 * only the days it found rows for would draw a continuous line across a
 * fortnight the collector was down, which is the single most misleading thing
 * this endpoint could produce: it turns our outage into the subject's steady
 * performance.
 *
 * Its own prefix rather than a segment under the subject, because a subject id
 * may itself end in "series"; see lib/subject-route.ts.
 */
const STATE_NOTE =
  "Every day in the window is present. `not_run` means our collector produced nothing that " +
  "day; `not_assessed` means it ran and this subject was not in it; `withheld` means we " +
  "rated it and did not publish; `scored` means we published. Only `scored` days carry a " +
  "composite. Do not interpolate across the other three.";

export async function GET(
  request: Request,
  ctx: { params: Promise<{ kind: string; registry: string; subject_id: string[] }> },
) {
  const limited = checkRateLimit(request, "anonymous");
  if (limited) return limited;

  const parsed = parseSubjectRoute(await ctx.params);
  if (!parsed.ok) return errorResponse("invalid_request", parsed.message);

  const url = new URL(request.url);
  const profile_id = url.searchParams.get("profile_id") ?? DEFAULT_PROFILE_ID;
  const dayParam = url.searchParams.get("through_day");
  const through_day = dayParam !== null && /^\d{4}-\d{2}-\d{2}$/.test(dayParam) ? dayParam : undefined;
  const daysParam = Number(url.searchParams.get("days"));
  const days =
    Number.isFinite(daysParam) && daysParam >= 1 ? Math.min(SERIES_DAYS, Math.floor(daysParam)) : SERIES_DAYS;
  const collector = url.searchParams.get("collector");

  const series = await getRatingsSource().getSubjectSeries(parsed.ref, {
    profile_id,
    days,
    ...(through_day === undefined ? {} : { through_day }),
    ...(collector === null ? {} : { collector }),
  });
  if (series === null) {
    return errorResponse(
      "not_found",
      `no stored rating for ${parsed.ref.kind}/${parsed.ref.source_registry}/${parsed.ref.subject_id} under ${profile_id}`,
    );
  }

  const counts = series.days.reduce<Record<string, number>>((acc, d) => {
    acc[d.state] = (acc[d.state] ?? 0) + 1;
    return acc;
  }, {});

  const meta = buildRatingsMeta({
    profile_id,
    as_of_day: series.through_day,
    extraDisclaimers: [
      STATE_NOTE,
      ...(counts["not_run"] === undefined
        ? []
        : [
            `${counts["not_run"]} of ${series.days.length} days in this window have no collection ` +
              "run at all. That gap is ours; see /api/v1/ratings/health.",
          ]),
    ],
  });
  return jsonResponse(buildRatingsEnvelope({ ...series, day_state_counts: counts }, meta));
}
