/**
 * Raw log disk cache (SPEC 10.1): every log range fetched from a provider is
 * cached before parsing, so re-parsing (a decode logic change, a bug fix)
 * never re-fetches. Keyed by (chainId, contract, fromBlock, toBlock), which
 * matches how the backfill chunks ranges.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { RawLog } from "./chainSource.js";

export interface LogCache {
  has(chainId: number, contract: string, fromBlock: number, toBlock: number): Promise<boolean>;
  put(chainId: number, contract: string, fromBlock: number, toBlock: number, logs: RawLog[]): Promise<void>;
  get(chainId: number, contract: string, fromBlock: number, toBlock: number): Promise<RawLog[] | null>;
  /** List every cached chunk's key, ascending by fromBlock, for a full re-parse pass. */
  listChunks(chainId: number, contract: string): Promise<Array<{ fromBlock: number; toBlock: number }>>;
}

function chunkFileName(fromBlock: number, toBlock: number): string {
  return `${String(fromBlock).padStart(12, "0")}-${String(toBlock).padStart(12, "0")}.json`;
}

export function createFileLogCache(baseDir: string): LogCache {
  function dir(chainId: number, contract: string): string {
    return path.join(baseDir, String(chainId), contract);
  }
  function file(chainId: number, contract: string, fromBlock: number, toBlock: number): string {
    return path.join(dir(chainId, contract), chunkFileName(fromBlock, toBlock));
  }

  return {
    async has(chainId, contract, fromBlock, toBlock) {
      return fs.existsSync(file(chainId, contract, fromBlock, toBlock));
    },
    async put(chainId, contract, fromBlock, toBlock, logs) {
      const d = dir(chainId, contract);
      await fsp.mkdir(d, { recursive: true });
      const tmp = file(chainId, contract, fromBlock, toBlock) + ".tmp";
      await fsp.writeFile(tmp, JSON.stringify(logs), "utf8");
      await fsp.rename(tmp, file(chainId, contract, fromBlock, toBlock));
    },
    async get(chainId, contract, fromBlock, toBlock) {
      const f = file(chainId, contract, fromBlock, toBlock);
      if (!fs.existsSync(f)) return null;
      const raw = await fsp.readFile(f, "utf8");
      return JSON.parse(raw) as RawLog[];
    },
    async listChunks(chainId, contract) {
      const d = dir(chainId, contract);
      if (!fs.existsSync(d)) return [];
      const entries = await fsp.readdir(d);
      const chunks = entries
        .filter((e) => e.endsWith(".json"))
        .map((e) => {
          const m = /^(\d{12})-(\d{12})\.json$/.exec(e);
          if (m === null) return null;
          const from = m[1];
          const to = m[2];
          if (from === undefined || to === undefined) return null;
          return { fromBlock: Number(from), toBlock: Number(to) };
        })
        .filter((x): x is { fromBlock: number; toBlock: number } => x !== null);
      chunks.sort((a, b) => a.fromBlock - b.fromBlock);
      return chunks;
    },
  };
}

/** In-memory LogCache for tests that do not want disk I/O in the hot path. */
export function createInMemoryLogCache(): LogCache {
  const store = new Map<string, RawLog[]>();
  const key = (chainId: number, contract: string, fromBlock: number, toBlock: number): string =>
    `${chainId}:${contract}:${fromBlock}:${toBlock}`;
  return {
    async has(chainId, contract, fromBlock, toBlock) {
      return store.has(key(chainId, contract, fromBlock, toBlock));
    },
    async put(chainId, contract, fromBlock, toBlock, logs) {
      store.set(key(chainId, contract, fromBlock, toBlock), logs);
    },
    async get(chainId, contract, fromBlock, toBlock) {
      return store.get(key(chainId, contract, fromBlock, toBlock)) ?? null;
    },
    async listChunks(chainId, contract) {
      const prefix = `${chainId}:${contract}:`;
      const chunks: Array<{ fromBlock: number; toBlock: number }> = [];
      for (const k of store.keys()) {
        if (!k.startsWith(prefix)) continue;
        const rest = k.slice(prefix.length).split(":");
        const from = rest[0];
        const to = rest[1];
        if (from === undefined || to === undefined) continue;
        chunks.push({ fromBlock: Number(from), toBlock: Number(to) });
      }
      chunks.sort((a, b) => a.fromBlock - b.fromBlock);
      return chunks;
    },
  };
}
