import { jsonResponse } from "@/lib/api-handler";
import { buildEnvelope, buildMeta } from "@/lib/envelope";
import { getDataSource } from "@/lib/get-data-source";

/**
 * Bulk data dumps are unlimited and unauthenticated (SPEC 13): this is the
 * public-good guarantee, so no rate limit applies here.
 */
export async function GET() {
  const dataSource = getDataSource();
  const dumps = await dataSource.getDumps();
  const indexed = await dataSource.getIndexedThrough();
  const meta = buildMeta({ indexedThroughBlock: indexed.block, indexedThroughTs: indexed.ts });
  return jsonResponse(buildEnvelope(dumps, meta));
}
