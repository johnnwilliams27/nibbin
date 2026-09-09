import { checkRateLimit, errorResponse, jsonResponse } from "@/lib/api-handler";
import { getRatingsSource } from "@/lib/get-ratings-source";
import { buildRatingsEnvelope, buildRatingsMeta } from "@/lib/ratings-envelope";
import { DEFAULT_PROFILE_ID, todayUtc } from "@/lib/ratings-source";
import { parseSubjectRoute } from "@/lib/subject-route";

/**
 * GET /api/v1/subjects/:kind/:registry/:subject_id
 *
 * One subject's most recent snapshot with everything that explains it: the
 * per-dimension results, the gates that fired, and the checks OUR harness could
 * not run.
 *
 * All three are served on withheld ratings too. A withheld rating without its
 * harness gaps is the one shape this endpoint must never produce: it would look
 * like a subject that failed, when the entries say it is a subject we failed to
 * test.
 */
export async function GET(
  request: Request,
  ctx: { params: Promise<{ kind: string; registry: string; subject_id: string[] }> },
) {
  const limited = checkRateLimit(request, "anonymous");
  if (limited) return limited;

  const parsed = parseSubjectRoute(await ctx.params);
  if (!parsed.ok) return errorResponse("invalid_request", parsed.message);

  const url = new URL(request.url);
  const profileParam = url.searchParams.get("profile_id");
  const dayParam = url.searchParams.get("through_day");
  const profile_id = profileParam ?? DEFAULT_PROFILE_ID;
  const through_day = dayParam !== null && /^\d{4}-\d{2}-\d{2}$/.test(dayParam) ? dayParam : undefined;

  const subject = await getRatingsSource().getSubject(parsed.ref, {
    profile_id,
    ...(through_day === undefined ? {} : { through_day }),
  });
  if (subject === null) {
    return errorResponse(
      "not_found",
      `no stored rating for ${parsed.ref.kind}/${parsed.ref.source_registry}/${parsed.ref.subject_id} under ${profile_id}`,
    );
  }

  const meta = buildRatingsMeta({
    profile_id,
    as_of_day: through_day ?? todayUtc(),
    snapshots: [subject],
    ...(subject.harness_gaps.length === 0
      ? {}
      : {
          extraDisclaimers: [
            `${subject.harness_gaps.length} check(s) did not run because our harness lacked a ` +
              "capability. They are listed under harness_gaps and are our defect, not evidence " +
              "about this subject.",
          ],
        }),
  });
  return jsonResponse(buildRatingsEnvelope(subject, meta));
}
