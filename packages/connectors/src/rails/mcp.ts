/**
 * Generic MCP rail [G] — any MCP server a user supplies (SPEC §4.3).
 *
 * The catalog's long-tail escape hatch and its biggest SSRF surface
 * (docs/RISKS.md §2), so everything goes through the deny-by-default egress
 * proxy: https-only, public IPs, size/time limits. The user's own MCP
 * credential (if any) is pinned to the registered host via credentialHosts —
 * it can never travel on a redirect, and Nibbin vault tokens for OTHER
 * connectors are simply not reachable from this code path.
 *
 * Tool results are quarantined before anything model-shaped sees them: an
 * MCP server's output is exactly as hostile as a stranger's email.
 */
import { safeFetch, type UnsafeTestOverrides } from '../egress/safe-fetch';
import { quarantine, type QuarantinedContent } from '../quarantine';

export interface McpServerConfig {
  /** user-registered endpoint, e.g. https://mcp.example.com/mcp */
  url: string;
  /** optional user-supplied bearer credential for that server only */
  bearerToken?: string;
}

interface JsonRpcResponse {
  jsonrpc?: string;
  id?: number;
  result?: unknown;
  error?: { code: number; message: string };
}

export class McpRailClient {
  private readonly host: string;
  private nextId = 1;
  private sessionId?: string;

  constructor(
    private readonly config: McpServerConfig,
    private readonly unsafeTestOverrides?: UnsafeTestOverrides,
  ) {
    this.host = new URL(config.url).hostname;
  }

  private async rpc(method: string, params: unknown): Promise<unknown> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    };
    if (this.config.bearerToken) headers.authorization = `Bearer ${this.config.bearerToken}`;
    if (this.sessionId) headers['mcp-session-id'] = this.sessionId;
    const res = await safeFetch(
      this.config.url,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ jsonrpc: '2.0', id: this.nextId++, method, params }),
      },
      {
        // no allowlist — any PUBLIC host; the user credential is pinned
        credentialHosts: [this.host],
        maxResponseBytes: 2 * 1024 * 1024,
        timeoutMs: 20_000,
      },
      this.unsafeTestOverrides,
    );
    if (res.status >= 400) throw new Error(`MCP server returned ${res.status}`);
    const sid = res.headers['mcp-session-id'];
    if (sid) this.sessionId = sid;
    const body = res.json() as JsonRpcResponse;
    if (body.error) throw new Error(`MCP error ${body.error.code}: ${body.error.message}`);
    return body.result;
  }

  async initialize(): Promise<unknown> {
    return this.rpc('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'nibbin-connectors', version: '0.1.0' },
    });
  }

  async listTools(): Promise<Array<{ name: string; description?: string }>> {
    const result = (await this.rpc('tools/list', {})) as { tools?: Array<{ name: string; description?: string }> };
    return result.tools ?? [];
  }

  /** Call a tool; the result is quarantined external data, never instructions. */
  async callTool(name: string, args: Record<string, unknown>): Promise<QuarantinedContent> {
    const result = await this.rpc('tools/call', { name, arguments: args });
    return quarantine(JSON.stringify(result), `generic-mcp:${this.host}:${name}`);
  }
}
