import { checkRateLimit, errorResponse, jsonResponse } from "@/lib/api-handler";
import { buildEnvelope, buildMeta } from "@/lib/envelope";
import { getDataSource } from "@/lib/get-data-source";

export async function GET(request: Request, ctx: { params: Promise<{ chain: string }> }) {
  const limited = checkRateLimit(request, "anonymous");
  if (limited) return limited;

  const { chain } = await ctx.params;
  const dataSource = getDataSource();
  const stats = await dataSource.getStats(chain);
  if (!stats) {
    return errorResponse("chain_not_indexed", `chain not indexed: ${chain}`);
  }

  const indexed = await dataSource.getIndexedThrough();
  const meta = buildMeta({ indexedThroughBlock: indexed.block, indexedThroughTs: indexed.ts });
  return jsonResponse(buildEnvelope(stats, meta));
}
