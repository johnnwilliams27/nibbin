import { checkRateLimit, errorResponse, jsonResponse } from "@/lib/api-handler";
import { buildEnvelope, buildMeta } from "@/lib/envelope";
import { getDataSource } from "@/lib/get-data-source";

/** Expensive: 10 req/min regardless of key (SPEC 13). */
export async function GET(request: Request, ctx: { params: Promise<{ chain: string; id: string }> }) {
  const limited = checkRateLimit(request, "expensive");
  if (limited) return limited;

  const { chain, id } = await ctx.params;
  const recompute = await getDataSource().getRecompute(chain, id);
  if (!recompute) {
    return errorResponse("not_found", `no agent ${chain}/${id}`);
  }

  const meta = buildMeta({
    indexedThroughBlock: recompute.as_of_block,
    indexedThroughTs: recompute.score.computed_at,
    coverageTier: recompute.score.coverage_tier,
  });
  return jsonResponse(buildEnvelope(recompute, meta));
}
