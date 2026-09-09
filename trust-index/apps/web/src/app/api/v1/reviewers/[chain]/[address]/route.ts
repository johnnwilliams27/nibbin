import { checkRateLimit, errorResponse, jsonResponse } from "@/lib/api-handler";
import { buildEnvelope, buildMeta } from "@/lib/envelope";
import { getDataSource } from "@/lib/get-data-source";

export async function GET(request: Request, ctx: { params: Promise<{ chain: string; address: string }> }) {
  const limited = checkRateLimit(request, "anonymous");
  if (limited) return limited;

  const { chain, address } = await ctx.params;
  const dataSource = getDataSource();
  const reviewer = await dataSource.getReviewer(chain, address);
  if (!reviewer) {
    return errorResponse("not_found", `no reviewer ${chain}/${address}`);
  }

  const indexed = await dataSource.getIndexedThrough();
  const meta = buildMeta({ indexedThroughBlock: indexed.block, indexedThroughTs: indexed.ts });
  return jsonResponse(buildEnvelope(reviewer, meta));
}
