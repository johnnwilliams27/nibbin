/**
 * Bounded, read-only ERC-8004 identity refresh. Never calls 8004scan, fetches
 * metadata URLs, executes agent tools or sends transactions. A cached document
 * is historical content at the SAME current tokenURI, not a fresh HTTP reading.
 *
 * node --import tsx scripts/refresh-chain-metadata.mts --frame population.ndjson.gz
 *   --ids agents.json --metadata metadata.ndjson.gz --out fresh-identities.json
 * Without --ids: all inline MCP/A2A declarations plus SHA-ranked, host-balanced
 * HTTP rows (20/host, 1000 HTTP, 1500 total). This is a selection, not a census.
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, writeFile, rename, access } from "node:fs/promises";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { createGunzip, gunzipSync } from "node:zlib";
import { guardedFetch, vetUrl } from "../src/net.js";

export const REGISTRY = "0x8004A169Fb4a3325136bE29aF0cEb6d2e539a432";
const MAX_DOCUMENT_BYTES = 512 * 1024;
type Document = Record<string, unknown>;
export interface FrameRow { agent_id: string; chain_id: number; token_uri: string }
export type Rpc = (method: string, params: unknown[]) => Promise<unknown>;
interface FreshRecord {
  agent_id: string; chain_id: 56; token_uri: string | null; owner: string | null;
  block: number; metadata?: Document; metadata_source?: "current_inline_uri" | "supplied_cache"; error?: string;
}
const isObject = (v: unknown): v is Document => typeof v === "object" && v !== null && !Array.isArray(v);
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
function idOf(value: unknown): string {
  const text = typeof value === "number" && Number.isSafeInteger(value) ? String(value) : value;
  if (typeof text !== "string" || !/^\d+$/.test(text) || BigInt(text) >= 2n ** 256n) throw new Error("Invalid uint256 agent ID");
  return BigInt(text).toString();
}

/** ERC721 standard selectors, with canonical uint256 arguments. */
export function encodeRegistryCall(method: "ownerOf" | "tokenURI", id: string): string {
  return `${method === "ownerOf" ? "0x6352211e" : "0xc87b56dd"}${BigInt(idOf(id)).toString(16).padStart(64, "0")}`;
}
export function decodeRegistryResult(method: "ownerOf" | "tokenURI", value: unknown): string {
  if (typeof value !== "string" || !/^0x(?:[a-fA-F0-9]{2})+$/.test(value)) throw new Error("Invalid ABI hex");
  const hex = value.slice(2);
  if (method === "ownerOf") {
    if (!/^0{24}[a-fA-F0-9]{40}$/.test(hex) || /^0+$/.test(hex)) throw new Error("Invalid ABI owner address");
    return `0x${hex.slice(24).toLowerCase()}`;
  }
  if (hex.length < 128 || BigInt(`0x${hex.slice(0, 64)}`) !== 32n) throw new Error("Invalid ABI string offset");
  const size = BigInt(`0x${hex.slice(64, 128)}`);
  // URI can base64-encode a 512KB document, but never admit unbounded RPC data.
  if (size > BigInt(MAX_DOCUMENT_BYTES * 2)) throw new Error("tokenURI exceeds byte limit");
  const length = Number(size);
  if (hex.length !== 128 + Math.ceil(length / 32) * 64 || /[^0]/.test(hex.slice(128 + length * 2))) throw new Error("Invalid ABI string length/padding");
  return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(hex.slice(128, 128 + length * 2), "hex"));
}

function documentOf(value: unknown): Document | undefined {
  try {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    if (!text || Buffer.byteLength(text) > MAX_DOCUMENT_BYTES) return undefined;
    const parsed: unknown = JSON.parse(text);
    return isObject(parsed) ? parsed : undefined;
  } catch { return undefined; }
}
function inlineDocument(uri: string): Document | undefined {
  if (uri.length > MAX_DOCUMENT_BYTES * 3) return undefined;
  const match = /^data:application\/json(?:;charset=utf-8)?(;base64)?,(.*)$/is.exec(uri);
  if (!match) return undefined;
  try {
    if (match[1] && !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(match[2]!)) return undefined;
    return documentOf(match[1] ? new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(match[2]!, "base64")) : decodeURIComponent(match[2]!));
  } catch { return undefined; }
}
function allowedMetadataUri(raw: string): URL | undefined {
  const vetted = vetUrl(raw);
  if (!vetted.allowed) return undefined;
  const url = vetted.url;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (url.username || url.password || /(^|\.)8004scan\.(app|io|com)$/.test(host)) return undefined;
  return url;
}
export function validateRpcUrl(raw: string): string {
  const url = allowedMetadataUri(raw);
  if (!url || url.protocol !== "https:") throw new Error("RPC must use public HTTPS without credentials or 8004scan");
  return url.href;
}
export function metadataCache(input: unknown): Map<string, Document> {
  const rows = Array.isArray(input) ? input : isObject(input) && Array.isArray(input.records) ? input.records : [input];
  const cache = new Map<string, Document>();
  for (const row of rows) {
    if (!isObject(row) || row.error) continue;
    const uri = row.uri ?? row.url ?? row.token_uri;
    const doc = documentOf(row.doc ?? row.metadata ?? row.document ?? row.body);
    if (typeof uri === "string" && doc) {
      const existing = cache.get(uri);
      // Conflicting cache readings without timestamps cannot establish which is latest.
      if (existing && JSON.stringify(existing) !== JSON.stringify(doc)) throw new Error("Conflicting documents for one cached URI");
      cache.set(uri, doc);
    }
  }
  return cache;
}
function declaresMachine(doc: Document | undefined): boolean {
  if (!doc) return false;
  return [doc.services, doc.endpoints, doc.service, doc.interfaces].some((group) => {
    if (Array.isArray(group)) return group.some((entry) => isObject(entry) && /^(mcp|a2a)$/i.test(String(entry.name ?? entry.type ?? "")));
    return isObject(group) && Object.keys(group).some((key) => /^(mcp|a2a)$/i.test(key));
  });
}
export function readIds(input: unknown, limit = 1500): string[] {
  const values = Array.isArray(input) ? input : isObject(input) ? input.agents ?? input.records : undefined;
  if (!Array.isArray(values)) throw new Error("IDs must be an array or {agents|records: [...]} document");
  const ids = new Set<string>();
  for (const item of values) {
    let value: unknown = item;
    if (isObject(item)) {
      if (item.chain_id !== undefined && Number(item.chain_id) !== 56) throw new Error("IDs contain another chain");
      value = item.token_id ?? item.agent_id;
    }
    if (typeof value === "string" && value.includes(":")) {
      const parts = value.split(":");
      if (parts.length !== 3 || parts[0] !== "56" || parts[1]?.toLowerCase() !== REGISTRY.toLowerCase()) throw new Error("IDs contain another chain or registry");
      value = parts[2];
    }
    ids.add(idOf(value));
  }
  if (ids.size > limit) throw new Error(`Explicit ID count ${ids.size} exceeds limit ${limit}; choose a documented subset or raise --max-total explicitly`);
  return [...ids].sort((a, b) => BigInt(a) < BigInt(b) ? -1 : 1);
}
export function selectCandidates(rows: FrameRow[], options: { maxHttp?: number; perHost?: number; maxTotal?: number } = {}, cache = new Map<string, Document>()) {
  const { maxHttp = 1000, perHost = 20, maxTotal = 1500 } = options;
  if (![maxHttp, perHost, maxTotal].every((n) => Number.isSafeInteger(n) && n > 0)) throw new Error("Selection limits must be positive integers");
  const inline: FrameRow[] = [], hosts = new Map<string, FrameRow[]>();
  const unique = new Map<string, FrameRow>();
  for (const row of rows) {
    if (row.chain_id !== 56) continue;
    const id = idOf(row.agent_id);
    if (unique.has(id)) throw new Error("Duplicate registration in frame");
    unique.set(id, row);
    if (row.token_uri.startsWith("data:")) {
      if (declaresMachine(inlineDocument(row.token_uri))) inline.push(row);
    } else {
      const url = allowedMetadataUri(row.token_uri);
      if (url) {
        const bucket = hosts.get(url.hostname) ?? [];
        bucket.push(row);
        hosts.set(url.hostname, bucket);
      }
    }
  }
  if (inline.length > maxTotal) throw new Error("Inline machine declarations exceed total limit; raise --max-total explicitly");
  const rank = (row: FrameRow) => hash(`${row.agent_id}\n${row.token_uri}`);
  inline.sort((a, b) => rank(a).localeCompare(rank(b)));
  const buckets = [...hosts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, group]) => group.sort((a, b) => Number(declaresMachine(cache.get(b.token_uri))) - Number(declaresMachine(cache.get(a.token_uri))) || rank(a).localeCompare(rank(b))).slice(0, perHost));
  const http: FrameRow[] = [];
  for (let round = 0; round < perHost && http.length < Math.min(maxHttp, maxTotal - inline.length); round++) {
    for (const bucket of buckets) {
      if (http.length >= Math.min(maxHttp, maxTotal - inline.length)) break;
      if (bucket[round]) http.push(bucket[round]!);
    }
  }
  return { rows: [...inline, ...http], summary: { mode: "inline_machine_plus_host_balanced_http", frame_rows: rows.length, inline_machine_selected: inline.length, http_selected: http.length, eligible_http_hosts: hosts.size, per_host_limit: perHost, http_limit: maxHttp, total_limit: maxTotal, policy: "Inline MCP/A2A declarations, then host round-robin; cached machine declarations first within host, deterministic SHA-256 ordering. Not a representative or complete census." } };
}

function blockOf(value: unknown): { number: string; hash: string } {
  if (!isObject(value) || typeof value.number !== "string" || !/^0x[0-9a-f]+$/i.test(value.number) || typeof value.hash !== "string" || !/^0x[0-9a-f]{64}$/i.test(value.hash)) throw new Error("Invalid RPC block");
  if (BigInt(value.number) > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Unsafe block number");
  return { number: value.number, hash: value.hash.toLowerCase() };
}
export async function refreshSelected(rows: FrameRow[], rpc: Rpc, cache: Map<string, Document>) {
  const started = new Date().toISOString();
  if (await rpc("eth_chainId", []) !== "0x38") throw new Error("RPC must report chain 56");
  const block = blockOf(await rpc("eth_getBlockByNumber", ["latest", false]));
  const records = new Array<FreshRecord>(rows.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(4, rows.length) }, async () => {
    while (cursor < rows.length) {
      const index = cursor++, row = rows[index]!;
      const fresh: FreshRecord = { agent_id: idOf(row.agent_id), chain_id: 56, token_uri: null, owner: null, block: Number(BigInt(block.number)) };
      records[index] = fresh;
      try {
        if (row.chain_id !== 56) throw new Error("wrong chain in selected row");
        fresh.owner = decodeRegistryResult("ownerOf", await rpc("eth_call", [{ to: REGISTRY, data: encodeRegistryCall("ownerOf", fresh.agent_id) }, block.number]));
        fresh.token_uri = decodeRegistryResult("tokenURI", await rpc("eth_call", [{ to: REGISTRY, data: encodeRegistryCall("tokenURI", fresh.agent_id) }, block.number]));
      } catch (error) {
        fresh.error = `registry_read_failed: ${error instanceof Error ? error.message.slice(0, 180) : "unknown error"}`;
        continue;
      }
      if (fresh.token_uri.startsWith("data:")) {
        const metadata = inlineDocument(fresh.token_uri);
        if (metadata) { fresh.metadata = metadata; fresh.metadata_source = "current_inline_uri"; }
        else fresh.error = "invalid_inline_metadata";
      } else if (!allowedMetadataUri(fresh.token_uri)) fresh.error = "metadata_uri_disallowed";
      else {
        const metadata = cache.get(fresh.token_uri);
        if (metadata) { fresh.metadata = metadata; fresh.metadata_source = "supplied_cache"; }
        else fresh.error = "metadata_cache_miss";
      }
    }
  }));
  const finalBlock = blockOf(await rpc("eth_getBlockByNumber", [block.number, false]));
  if (finalBlock.hash !== block.hash || BigInt(finalBlock.number) !== BigInt(block.number)) throw new Error("Snapshot block changed during refresh; refusing publication");
  return { snapshot: { chain_id: 56, registry: REGISTRY, block: Number(BigInt(block.number)), block_hash: block.hash, started_at: started, completed_at: new Date().toISOString(), metadata_policy: "cache_only_no_http_refresh; supplied_cache documents are historical and matched by exact current tokenURI" }, records };
}

export function createRpc(raw: string, fetcher: typeof guardedFetch = guardedFetch): Rpc {
  const url = validateRpcUrl(raw);
  let nextId = 0;
  return async (method, params) => {
    if (!["eth_chainId", "eth_getBlockByNumber", "eth_call"].includes(method)) throw new Error("Read-only RPC method required");
    const id = ++nextId;
    const response = await fetcher(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id, method, params }), timeoutMs: 8000, maxBytes: MAX_DOCUMENT_BYTES * 4 + 1024, maxRedirects: 0 });
    if (!response.ok) throw new Error(`RPC transport failed: ${response.reason}`);
    const body: unknown = JSON.parse(response.body);
    if (!isObject(body) || body.jsonrpc !== "2.0" || body.id !== id || body.error || !("result" in body)) throw new Error("RPC returned an error or invalid envelope");
    return body.result;
  };
}
async function loadDocument(path: string): Promise<unknown> {
  const raw = await readFile(path);
  const text = (path.endsWith(".gz") ? gunzipSync(raw, { maxOutputLength: 512 * 1024 * 1024 }) : raw).toString("utf8");
  try { return JSON.parse(text); } catch { return text.split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line) as unknown); }
}
async function loadFrame(path: string): Promise<FrameRow[]> {
  const raw = createReadStream(path);
  const stream = path.endsWith(".gz") ? raw.pipe(createGunzip()) : raw;
  const rows: FrameRow[] = [];
  for await (const line of createInterface({ input: stream, crlfDelay: Infinity })) {
    if (!line.trim()) continue;
    const row: unknown = JSON.parse(line);
    if (!isObject(row) || Number(row.chain_id) !== 56 || typeof row.token_uri !== "string") throw new Error("Malformed or non-BNB frame row");
    rows.push({ agent_id: idOf(row.agent_id), chain_id: 56, token_uri: row.token_uri });
  }
  return rows;
}
export async function main(args: string[]) {
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]!, value = args[i + 1];
    if (!["--frame", "--ids", "--metadata", "--out", "--rpc", "--max-total", "--max-http", "--per-host"].includes(key) || !value || value.startsWith("--") || flags.has(key)) throw new Error(`Invalid/duplicate argument ${key}`);
    flags.set(key, value);
  }
  if (!flags.has("--frame") || !flags.has("--out")) throw new Error("Required: --frame population.ndjson.gz --out new-artifact.json; optional --ids agents.json --metadata metadata.ndjson.gz");
  const out = resolve(flags.get("--out")!);
  try { await access(out); throw new Error("Output already exists; choose a new artifact path"); } catch (error) { if (!(isObject(error) && error.code === "ENOENT")) throw error; }
  const maxTotal = Number(flags.get("--max-total") ?? 1500);
  if (!Number.isSafeInteger(maxTotal) || maxTotal < 1) throw new Error("Invalid total limit");
  const frame = await loadFrame(flags.get("--frame")!);
  const metadataPath = flags.get("--metadata");
  const cache = metadataPath ? metadataCache(await loadDocument(metadataPath)) : new Map<string, Document>();
  const idsPath = flags.get("--ids");
  let selected: FrameRow[], selection: Record<string, unknown>;
  if (idsPath) {
    const ids = readIds(await loadDocument(idsPath), maxTotal);
    const wanted = new Set(ids), byId = new Map(frame.filter((row) => wanted.has(row.agent_id)).map((row) => [row.agent_id, row]));
    if (ids.some((id) => !byId.has(id))) throw new Error("Some explicit IDs are absent from the supplied frame");
    selected = ids.map((id) => byId.get(id)!);
    selection = { mode: "explicit_ids", selected: ids.length, frame_rows: frame.length, total_limit: maxTotal, policy: "Only explicitly supplied IDs refreshed; all other registrations retain historical event provenance." };
  } else {
    const result = selectCandidates(frame, { maxTotal, maxHttp: Number(flags.get("--max-http") ?? 1000), perHost: Number(flags.get("--per-host") ?? 20) }, cache);
    selected = result.rows; selection = result.summary;
  }
  console.log(`Refreshing ${selected.length} identities; metadata is cache-only. No transactions or agent invocations.`);
  const result = await refreshSelected(selected, createRpc(flags.get("--rpc") ?? "https://bsc-rpc.publicnode.com"), cache);
  const artifact = { ...result, selection, sources: { frame: flags.get("--frame"), metadata: metadataPath ?? null, metadata_sha256: metadataPath ? createHash("sha256").update(await readFile(metadataPath)).digest("hex") : null }, summary: { selected: selected.length, metadata_available: result.records.filter((r) => r.metadata).length, gaps: result.records.filter((r) => r.error).length } };
  const temp = `${out}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(artifact, null, 2)}\n`, { flag: "wx" });
  await rename(temp, out);
  console.log(JSON.stringify({ output: out, ...artifact.summary, block: result.snapshot.block }));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Refresh failed"); process.exitCode = 1; });
}
