/**
 * POST /mcp: JSON-RPC 2.0 exposing the seven MCP_TOOLS (SPEC 13), with the
 * same ApiEnvelope shape and in-band confidence rules as the REST endpoints
 * (a score object always carries confidence; nothing is a side channel).
 */
import { MCP_TOOLS, type McpToolName } from "@trust-index/types";
import type { DataSource } from "./data-source.js";
import { buildEnvelope, buildMeta } from "./envelope.js";
import { clampLimit } from "./pagination.js";

export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: string | number | null;
  method: string;
  params?: Record<string, unknown>;
};

export type JsonRpcResponse =
  | { jsonrpc: "2.0"; id: string | number | null; result: unknown }
  | { jsonrpc: "2.0"; id: string | number | null; error: { code: number; message: string; data?: unknown } };

const JSONRPC_INVALID_REQUEST = -32600;
const JSONRPC_METHOD_NOT_FOUND = -32601;
const JSONRPC_INVALID_PARAMS = -32602;
const JSONRPC_INTERNAL_ERROR = -32603;
const JSONRPC_RATE_LIMITED = -32000;

function isTool(method: string): method is McpToolName {
  return (MCP_TOOLS as readonly string[]).includes(method);
}

function str(params: Record<string, unknown> | undefined, key: string): string | null {
  const v = params?.[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** recompute is the one expensive MCP tool (mirrors GET .../recompute, SPEC 13). */
export function isExpensiveTool(method: string): boolean {
  return method === "recompute";
}

/** Which rate-limit bucket a tool call is charged against (SPEC 13). */
export function bucketForTool(method: string): "anonymous" | "expensive" {
  return isExpensiveTool(method) ? "expensive" : "anonymous";
}

export async function handleMcpCall(
  dataSource: DataSource,
  request: JsonRpcRequest,
): Promise<JsonRpcResponse> {
  const { id, method, params } = request;

  if (request.jsonrpc !== "2.0" || typeof method !== "string") {
    return { jsonrpc: "2.0", id: id ?? null, error: { code: JSONRPC_INVALID_REQUEST, message: "not a JSON-RPC 2.0 request" } };
  }
  if (!isTool(method)) {
    return {
      jsonrpc: "2.0",
      id,
      error: { code: JSONRPC_METHOD_NOT_FOUND, message: `unknown tool "${method}"; see MCP_TOOLS` },
    };
  }

  try {
    switch (method) {
      case "get_agent_score": {
        const chain = str(params, "chain");
        const agentId = str(params, "id");
        if (!chain || !agentId) return invalidParams(id, "chain and id are required");
        const agent = await dataSource.getAgent(chain, agentId);
        if (!agent) return notFound(id, `no agent ${chain}/${agentId}`);
        const meta = buildMeta({
          indexedThroughBlock: agent.score.as_of_block,
          indexedThroughTs: agent.score.computed_at,
          coverageTier: agent.score.coverage_tier,
        });
        return { jsonrpc: "2.0", id, result: buildEnvelope(agent, meta) };
      }

      case "get_agent_feedback": {
        const chain = str(params, "chain");
        const agentId = str(params, "id");
        if (!chain || !agentId) return invalidParams(id, "chain and id are required");
        const cursor = str(params, "cursor");
        const limitRaw = params?.["limit"];
        const limit = clampLimit(typeof limitRaw === "number" ? limitRaw : null);
        const page = await dataSource.getAgentFeedback(chain, agentId, { cursor, limit });
        if (!page) return notFound(id, `no agent ${chain}/${agentId}`);
        const indexed = await dataSource.getIndexedThrough();
        const meta = buildMeta({ indexedThroughBlock: indexed.block, indexedThroughTs: indexed.ts });
        return { jsonrpc: "2.0", id, result: buildEnvelope(page, meta) };
      }

      case "recompute": {
        const chain = str(params, "chain");
        const agentId = str(params, "id");
        if (!chain || !agentId) return invalidParams(id, "chain and id are required");
        const recompute = await dataSource.getRecompute(chain, agentId);
        if (!recompute) return notFound(id, `no agent ${chain}/${agentId}`);
        const meta = buildMeta({
          indexedThroughBlock: recompute.as_of_block,
          indexedThroughTs: recompute.score.computed_at,
          coverageTier: recompute.score.coverage_tier,
        });
        return { jsonrpc: "2.0", id, result: buildEnvelope(recompute, meta) };
      }

      case "get_reviewer_profile": {
        const chain = str(params, "chain");
        const address = str(params, "address");
        if (!chain || !address) return invalidParams(id, "chain and address are required");
        const reviewer = await dataSource.getReviewer(chain, address);
        if (!reviewer) return notFound(id, `no reviewer ${chain}/${address}`);
        const indexed = await dataSource.getIndexedThrough();
        const meta = buildMeta({ indexedThroughBlock: indexed.block, indexedThroughTs: indexed.ts });
        return { jsonrpc: "2.0", id, result: buildEnvelope(reviewer, meta) };
      }

      case "compare_agents": {
        const chain = str(params, "chain");
        const idsRaw = params?.["ids"];
        if (!chain || !Array.isArray(idsRaw) || idsRaw.length === 0) {
          return invalidParams(id, "chain and a non-empty ids array are required");
        }
        const ids = idsRaw.filter((x): x is string => typeof x === "string");
        const agents = (await Promise.all(ids.map((agentId) => dataSource.getAgent(chain, agentId)))).filter(
          (a): a is NonNullable<typeof a> => a !== null,
        );
        const indexed = await dataSource.getIndexedThrough();
        const meta = buildMeta({ indexedThroughBlock: indexed.block, indexedThroughTs: indexed.ts });
        return { jsonrpc: "2.0", id, result: buildEnvelope({ agents }, meta) };
      }

      case "get_ecosystem_stats": {
        const chain = str(params, "chain");
        if (!chain) return invalidParams(id, "chain is required");
        const stats = await dataSource.getStats(chain);
        if (!stats) return notFound(id, `chain not indexed: ${chain}`);
        const indexed = await dataSource.getIndexedThrough();
        const meta = buildMeta({ indexedThroughBlock: stats.indexed_through_block, indexedThroughTs: indexed.ts });
        return { jsonrpc: "2.0", id, result: buildEnvelope(stats, meta) };
      }

      case "get_proof": {
        const chain = str(params, "chain");
        const agentId = str(params, "id");
        if (!chain || !agentId) return invalidParams(id, "chain and id are required");
        const agent = await dataSource.getAgent(chain, agentId);
        if (!agent) return notFound(id, `no agent ${chain}/${agentId}`);
        const meta = buildMeta({ indexedThroughBlock: agent.score.as_of_block, indexedThroughTs: agent.score.computed_at });
        return {
          jsonrpc: "2.0",
          id,
          result: buildEnvelope(
            {
              chain_slug: chain,
              agent_id: agentId,
              anchored: false,
              note: "On-chain anchoring is not available in this fixture-backed deployment. See SPEC 20.1.",
            },
            meta,
          ),
        };
      }
    }
  } catch (err) {
    return {
      jsonrpc: "2.0",
      id,
      error: { code: JSONRPC_INTERNAL_ERROR, message: err instanceof Error ? err.message : "internal error" },
    };
  }
}

function invalidParams(id: string | number | null, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code: JSONRPC_INVALID_PARAMS, message } };
}
function notFound(id: string | number | null, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code: JSONRPC_INVALID_PARAMS, message: `not found: ${message}` } };
}

export const RATE_LIMITED_JSONRPC_CODE = JSONRPC_RATE_LIMITED;
