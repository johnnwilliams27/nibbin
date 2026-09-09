import { clientKey, jsonResponse } from "@/lib/api-handler";
import { getDataSource } from "@/lib/get-data-source";
import { bucketForTool, handleMcpCall, type JsonRpcRequest, type JsonRpcResponse } from "@/lib/mcp";
import { rateLimiter } from "@/lib/rate-limiter-instance";

function isJsonRpcRequest(v: unknown): v is JsonRpcRequest {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return r["jsonrpc"] === "2.0" && typeof r["method"] === "string";
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "invalid JSON" } },
      { status: 400 },
    );
  }

  if (!isJsonRpcRequest(body)) {
    return jsonResponse(
      { jsonrpc: "2.0", id: null, error: { code: -32600, message: "not a JSON-RPC 2.0 request" } },
      { status: 400 },
    );
  }

  const bucket = bucketForTool(body.method);
  const limitResult = rateLimiter.consume(clientKey(request), bucket);
  if (!limitResult.allowed) {
    const response: JsonRpcResponse = {
      jsonrpc: "2.0",
      id: body.id ?? null,
      error: { code: -32000, message: `rate limit exceeded for ${bucket} calls` },
    };
    return jsonResponse(response, { status: 429 });
  }

  const result = await handleMcpCall(getDataSource(), body);
  return jsonResponse(result);
}
