import { checkRateLimit, errorResponse, jsonResponse } from "@/lib/api-handler";
import { buildEnvelope, buildMeta } from "@/lib/envelope";
import { getDataSource } from "@/lib/get-data-source";

export async function GET(request: Request, ctx: { params: Promise<{ chain: string; id: string }> }) {
  const limited = checkRateLimit(request, "anonymous");
  if (limited) return limited;

  const { chain, id } = await ctx.params;
  const agent = await getDataSource().getAgent(chain, id);
  if (!agent) {
    return errorResponse("not_found", `no agent ${chain}/${id}`);
  }

  const meta = buildMeta({
    indexedThroughBlock: agent.score.as_of_block,
    indexedThroughTs: agent.score.computed_at,
    coverageTier: agent.score.coverage_tier,
  });
  return jsonResponse(buildEnvelope(agent, meta));
}
