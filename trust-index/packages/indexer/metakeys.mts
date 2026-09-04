import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { decodeEventLog } from "viem";
import { MAINNET_IDENTITY_REGISTRY } from "@trust-index/types";
import { IDENTITY_REGISTRY_ABI } from "./src/abi.js";
import { TOPIC0 } from "./src/decode.js";

const IDENTITY = MAINNET_IDENTITY_REGISTRY.toLowerCase();

async function main() {
  const keyCounts = new Map<string, number>();
  const samples = new Map<string, string[]>();
  const agentsPerKey = new Map<string, Set<string>>();
  let total = 0;

  const reader = createInterface({
    input: createReadStream("cohort-cache/logs.ndjson", { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  for await (const line of reader) {
    if (line.length === 0) continue;
    const c = JSON.parse(line) as { address: string; topics: string[]; data: string };
    if (c.address.toLowerCase() !== IDENTITY) continue;
    if ((c.topics[0] ?? "").toLowerCase() !== TOPIC0.metadataSet.toLowerCase()) continue;
    total += 1;
    try {
      const d = decodeEventLog({
        abi: IDENTITY_REGISTRY_ABI,
        data: c.data as `0x${string}`,
        topics: c.topics as [`0x${string}`, ...`0x${string}`[]],
        eventName: "MetadataSet",
      });
      const a = d.args as unknown as { agentId: bigint; metadataKey: string; metadataValue: string };
      const key = a.metadataKey;
      keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
      const set = agentsPerKey.get(key) ?? new Set<string>();
      set.add(a.agentId.toString());
      agentsPerKey.set(key, set);
      const list = samples.get(key) ?? [];
      if (list.length < 2) {
        const hex = a.metadataValue.replace(/^0x/, "");
        let text = "";
        for (let i = 0; i + 1 < hex.length; i += 2) {
          const code = parseInt(hex.slice(i, i + 2), 16);
          text += code >= 32 && code < 127 ? String.fromCharCode(code) : ".";
        }
        list.push(text.slice(0, 80));
        samples.set(key, list);
      }
    } catch {
      /* skip */
    }
  }

  const rows = [...keyCounts].sort((a, b) => b[1] - a[1]);
  console.log(`MetadataSet events: ${total}, distinct keys: ${keyCounts.size}`);
  console.log(`\n=== TOP 20 KEYS ===`);
  for (const [k, n] of rows.slice(0, 20)) {
    console.log(`${String(n).padStart(7)} events, ${String(agentsPerKey.get(k)!.size).padStart(6)} agents  ${JSON.stringify(k)}`);
    for (const s of samples.get(k) ?? []) console.log(`          ${s}`);
  }
  const interesting = rows.filter(([k]) => /virtual|acp|olas|job|commerce|wallet|account|platform|bind/i.test(k));
  console.log(`\n=== KEYS THAT MIGHT CARRY A PLATFORM IDENTITY ===`);
  for (const [k, n] of interesting) {
    console.log(`${String(n).padStart(7)} events, ${String(agentsPerKey.get(k)!.size).padStart(6)} agents  ${JSON.stringify(k)}`);
    for (const s of samples.get(k) ?? []) console.log(`          ${s}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
