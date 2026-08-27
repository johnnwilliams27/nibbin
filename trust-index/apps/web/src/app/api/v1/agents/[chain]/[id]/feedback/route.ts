import { checkRateLimit, errorResponse, jsonResponse } from "@/lib/api-handler";
import { buildEnvelope, buildMeta } from "@/lib/envelope";
import { getDataSource } from "@/lib/get-data-source";
import { clampLimit } from "@/lib/pagination";

export async function GET(request: Request, ctx: { params: Promise<{ chain: string; id: string }> }) {
  const limited = checkRateLimit(request, "anonymous");
  if (limited) return limited;

  const { chain, id } = await ctx.params;
  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor");
  const limitParam = url.searchParams.get("limit");
  const limit = clampLimit(limitParam ? Number(limitParam) : null);

  const dataSource = getDataSource();
  const page = await dataSource.getAgentFeedback(chain, id, { cursor, limit });
  if (!page) {
    return errorResponse("not_found", `no agent ${chain}/${id}`);
  }

  const indexed = await dataSource.getIndexedThrough();
  const meta = buildMeta({ indexedThroughBlock: indexed.block, indexedThroughTs: indexed.ts });
  return jsonResponse(buildEnvelope(page, meta));
}
