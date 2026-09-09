import { describe, expect, it } from "vitest";
import { createRpc, decodeRegistryResult, encodeRegistryCall, metadataCache, readIds, refreshSelected, selectCandidates, validateRpcUrl } from "../scripts/refresh-chain-metadata.mjs";

const registry = "0x8004A169Fb4a3325136bE29aF0cEb6d2e539a432";
const owner = "0x1111111111111111111111111111111111111111";
const inline = (doc: unknown) => `data:application/json;base64,${Buffer.from(JSON.stringify(doc)).toString("base64")}`;
const word = (n: number) => n.toString(16).padStart(64, "0");
const abiString = (s: string) => `0x${word(32)}${word(Buffer.byteLength(s))}${Buffer.from(s).toString("hex").padEnd(Math.ceil(Buffer.byteLength(s) / 32) * 64, "0")}`;
const row = (id: number, uri: string) => ({ agent_id: String(id), chain_id: 56, token_uri: uri });
function fakeRpc(uris: Record<string, string>, options: { chain?: string; reorg?: boolean; fail?: string } = {}) {
  let blocks = 0;
  return async (method: string, params: unknown[]): Promise<unknown> => {
    if (method === "eth_chainId") return options.chain ?? "0x38";
    if (method === "eth_getBlockByNumber") {
      blocks++;
      expect(params[0]).toBe(blocks === 1 ? "latest" : "0x64");
      return { number: "0x64", hash: `0x${(options.reorg && blocks > 1 ? "bb" : "aa").repeat(32)}` };
    }
    expect(method).toBe("eth_call");
    const call = params[0] as { to: string; data: string };
    expect(call.to).toBe(registry);
    expect(params[1]).toBe("0x64");
    const id = BigInt(`0x${call.data.slice(10)}`).toString();
    if (options.fail === id) throw new Error("execution reverted");
    if (call.data.startsWith("0x6352211e")) return `0x${"0".repeat(24)}${owner.slice(2)}`;
    expect(call.data.slice(0, 10)).toBe("0xc87b56dd");
    return abiString(uris[id]!);
  };
}

describe("fixed-block chain metadata refresh", () => {
  it("encodes ERC721 identities and rejects malformed ABI results", () => {
    expect(encodeRegistryCall("ownerOf", "1")).toBe(`0x6352211e${"0".repeat(63)}1`);
    expect(decodeRegistryResult("ownerOf", `0x${"0".repeat(24)}${owner.slice(2)}`)).toBe(owner);
    expect(decodeRegistryResult("tokenURI", abiString("é"))).toBe("é");
    expect(() => decodeRegistryResult("tokenURI", `0x${word(0)}${word(1)}61`)).toThrow();
    expect(() => decodeRegistryResult("ownerOf", `0x${"f".repeat(64)}`)).toThrow();
    expect(() => encodeRegistryCall("tokenURI", "-1")).toThrow();
  });
  it("refreshes owner and URI at one block, reuses only exact current URI cache", async () => {
    const cache = metadataCache([{ url: "https://example.org/new", metadata: { name: "New" } }, { url: "https://example.org/old", metadata: { name: "Old" } }]);
    const result = await refreshSelected([row(1, "https://example.org/old")], fakeRpc({ "1": "https://example.org/new" }), cache);
    expect(result.records).toEqual([{ agent_id: "1", chain_id: 56, owner, token_uri: "https://example.org/new", block: 100, metadata: { name: "New" }, metadata_source: "supplied_cache" }]);
    expect(result.snapshot.block_hash).toBe(`0x${"aa".repeat(32)}`);
  });
  it("keeps a changed URI cache miss and a burned registration as explicit gaps", async () => {
    const result = await refreshSelected([row(1, "https://example.org/old"), row(2, inline({ name: "stale" }))], fakeRpc({ "1": "https://example.org/missing" }, { fail: "2" }), metadataCache([{ url: "https://example.org/old", metadata: { name: "Old" } }]));
    expect(result.records[0]).toMatchObject({ token_uri: "https://example.org/missing", error: "metadata_cache_miss" });
    expect(result.records[1]).toMatchObject({ owner: null, token_uri: null, error: "registry_read_failed: execution reverted" });
    expect(result.records.every((r) => !r.metadata)).toBe(true);
  });
  it("rejects wrong chain before registry reads and rejects reorg publication", async () => {
    await expect(refreshSelected([row(1, "")], fakeRpc({}, { chain: "0x61" }), new Map())).rejects.toThrow("chain 56");
    await expect(refreshSelected([row(1, "")], fakeRpc({ "1": inline({ name: "Fresh" }) }, { reorg: true }), new Map())).rejects.toThrow("changed");
  });
  it("resolves current inline metadata without HTTP or stale cache", async () => {
    const result = await refreshSelected([row(1, "")], fakeRpc({ "1": inline({ services: [{ name: "MCP", endpoint: "https://example.org/mcp" }] }) }), new Map());
    expect(result.records[0]?.metadata_source).toBe("current_inline_uri");
    expect(result.records[0]?.metadata).toHaveProperty("services");
  });
  it("refuses 8004scan, private and credential metadata even if cached", async () => {
    for (const url of ["https://blob.8004scan.app/a", "https://8004scan.io/a", "https://u:p@example.org/a", "http://127.0.0.1/a"]) {
      const result = await refreshSelected([row(1, "")], fakeRpc({ "1": url }), metadataCache([{ url, metadata: { name: "Unsafe" } }]));
      expect(result.records[0]?.metadata).toBeUndefined();
      expect(result.records[0]?.error).toBe("metadata_uri_disallowed");
    }
  });
  it("bounds active RPC work to four rows", async () => {
    const base = fakeRpc(Object.fromEntries(Array.from({ length: 9 }, (_, i) => [String(i), inline({ name: "x" })])));
    let active = 0, peak = 0;
    const rpc = async (method: string, params: unknown[]) => {
      active++; peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      try { return await base(method, params); } finally { active--; }
    };
    const result = await refreshSelected(Array.from({ length: 9 }, (_, i) => row(i, "")), rpc, new Map());
    expect(result.records).toHaveLength(9);
    expect(peak).toBeLessThanOrEqual(4);
  });
});

describe("bounded selection and supplied cache", () => {
  it("retains machine inline declarations and samples across hosts independent of input order", () => {
    const rows = [row(0, inline({ services: [{ name: "MCP", endpoint: "https://example.org" }] })), row(1, inline({ description: "MCP" })), ...Array.from({ length: 10 }, (_, i) => row(i + 2, `https://a.example.org/${i}`)), row(50, "https://b.example.org/a")];
    const result = selectCandidates(rows, { maxHttp: 2, perHost: 1, maxTotal: 3 });
    expect(result.rows).toHaveLength(3);
    expect(result.rows.some((r) => r.agent_id === "0")).toBe(true);
    expect(result.rows.some((r) => r.agent_id === "50")).toBe(true);
    expect(result.rows.some((r) => r.agent_id === "1")).toBe(false);
    expect(selectCandidates([...rows].reverse(), { maxHttp: 2, perHost: 1, maxTotal: 3 }).rows).toEqual(result.rows);
    expect(() => selectCandidates(rows, { maxTotal: 0 })).toThrow();
  });
  it("reads explicit marketplace IDs without truncation or cross-chain confusion", () => {
    expect(readIds({ agents: [{ agent_id: `56:${registry}:12` }, { chain_id: 56, token_id: 13 }, { chain_id: 56, token_id: 13 }] }, 2)).toEqual(["12", "13"]);
    expect(() => readIds([1, 2, 3], 2)).toThrow("limit");
    expect(() => readIds([{ chain_id: 97, token_id: 1 }], 2)).toThrow("chain");
  });
  it("normalizes supplied documents but excludes cache errors and nonobjects", () => {
    const cache = metadataCache({ records: [{ token_uri: "https://example.org/a", document: { name: "A" } }, { url: "https://example.org/b", body: '{"name":"B"}' }, { url: "https://example.org/c", metadata: {}, error: "failed" }, { url: "https://example.org/d", metadata: [] }] });
    expect([...cache.keys()]).toEqual(["https://example.org/a", "https://example.org/b"]);
    expect(metadataCache([{ uri: "https://example.org/slim", doc: { name: "Slim" } }]).get("https://example.org/slim")).toEqual({ name: "Slim" });
    expect(metadataCache([{ uri: "https://example.org/large", doc: { text: "x".repeat(512 * 1024) } }]).size).toBe(0);
    expect(() => metadataCache([{ uri: "https://example.org/a", doc: { n: 1 } }, { uri: "https://example.org/a", doc: { n: 2 } }])).toThrow("Conflicting");
  });
  it("requires public HTTPS RPC without embedded credentials or scan hosts", () => {
    expect(validateRpcUrl("https://bsc-rpc.publicnode.com")).toBe("https://bsc-rpc.publicnode.com/");
    for (const url of ["http://example.org", "https://u:p@example.org", "https://8004scan.app/rpc", "https://127.0.0.1"]) expect(() => validateRpcUrl(url)).toThrow();
  });
  it("validates RPC envelopes and never admits write methods", async () => {
    let mismatch = false;
    const rpc = createRpc("https://bsc-rpc.publicnode.com", async (_url, options) => {
      expect(options?.maxRedirects).toBe(0);
      expect(options?.timeoutMs).toBe(8000);
      const request = JSON.parse(options!.body!) as { id: number };
      return { ok: true, status: 200, elapsedMs: 1, headers: new Headers(), body: JSON.stringify({ jsonrpc: "2.0", id: mismatch ? request.id + 1 : request.id, result: "0x38" }) };
    });
    expect(await rpc("eth_chainId", [])).toBe("0x38");
    mismatch = true;
    await expect(rpc("eth_chainId", [])).rejects.toThrow("envelope");
    await expect(rpc("eth_sendRawTransaction", ["0x00"])).rejects.toThrow("Read-only");
  });
});
