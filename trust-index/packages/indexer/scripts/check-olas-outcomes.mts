/**
 * Can Olas mech outcomes be attached to ERC-8004 agents?
 *
 * The Olas Mech Marketplace on Base reports 25,378 requests across 58 mechs,
 * and its `MarketplaceDelivery` event carries a `bool[]` of per-request
 * delivery outcomes. That is a direct success signal rather than one inferred
 * from a state machine, which makes it a better calibration source than
 * anything Virtuals ACP exposes.
 *
 * But outcomes are keyed by mech ADDRESS and the registry link is keyed by
 * Olas AGENT ID, so "Olas has per-agent outcomes" is not established until
 * those two join. This script tests the join from both ends:
 *
 *   1. CreateMech(mech, serviceId, mechFactory) gives mech address to Olas
 *      service id, on chain.
 *   2. Agents publishing a marketplace.olas.network URL carry the Olas agent
 *      id in the URL path, and their metadata document carries an explicit
 *      registrations[] entry naming the ERC-8004 agentId and registry.
 *
 * If service id and agent id are the same namespace, the chain closes and
 * calibration has a label set. If they are not, the gap is named rather than
 * assumed away.
 *
 * Usage:
 *   pnpm --filter @trust-index/indexer exec tsx scripts/check-olas-outcomes.mts \
 *     [--cache <dir>] [--rpc <url>] [--from <block>]
 */
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { decodeEventLog, toEventSelector } from "viem";
import { MAINNET_IDENTITY_REGISTRY } from "@trust-index/types";
import { decodeIdentityLog } from "../src/decode.js";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : (process.argv[i + 1] ?? fallback);
}

const CACHE = arg("--cache", "cohort-cache");
const RPCS = arg("--rpc", "https://mainnet.base.org,https://gateway.tenderly.co/public/base")
  .split(",")
  .map((x) => x.trim())
  .filter((x) => x.length > 0);
const IDENTITY = MAINNET_IDENTITY_REGISTRY.toLowerCase();
/** Olas Mech Marketplace proxy on Base, from the autonolas-marketplace config. */
const MARKETPLACE = "0xf24ee42eda0fc9b33b7d41b06ee8ccd2ef7c5020";
const CREATE_MECH = toEventSelector("CreateMech(address,uint256,address)");
const MARKETPLACE_DELIVERY = toEventSelector(
  "MarketplaceDelivery(address,address[],uint256,bytes32[],bool[])",
);
const DELIVERY_ABI = [
  {
    type: "event",
    name: "MarketplaceDelivery",
    inputs: [
      { name: "deliveryMech", type: "address", indexed: true },
      { name: "requesters", type: "address[]", indexed: false },
      { name: "numDeliveries", type: "uint256", indexed: false },
      { name: "requestIds", type: "bytes32[]", indexed: false },
      { name: "deliveredRequests", type: "bool[]", indexed: false },
    ],
  },
] as const;

type LogRow = { topics: string[]; data: string; blockNumber: string };
type JsonRpcReply = { result?: unknown; error?: { message?: string } };
type CachedLog = {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string;
  blockHash: string;
  transactionHash: string;
  logIndex: string;
};

let turn = 0;
async function rpc(body: unknown): Promise<JsonRpcReply> {
  let last = "";
  for (let a = 0; a < 4; a += 1) {
    const endpoint = RPCS[turn % RPCS.length]!;
    turn += 1;
    await new Promise((r) => setTimeout(r, 130));
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status === 429 || res.status >= 500) throw new Error(`http ${res.status}`);
      const j = (await res.json()) as JsonRpcReply;
      if (j.error?.message?.includes("rate limit") === true) throw new Error("rate limit");
      return j;
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
      console.error(`  rpc retry ${a + 1}: ${last}`);
      await new Promise((r) => setTimeout(r, 400 * 2 ** a));
    }
  }
  throw new Error(`rpc failed: ${last}`);
}

async function scan(topic: string, from: number, to: number): Promise<LogRow[]> {
  const out: LogRow[] = [];
  let cursor = from;
  let span = 9000;
  while (cursor <= to) {
    const end = Math.min(cursor + span - 1, to);
    let j: JsonRpcReply;
    try {
      j = await rpc({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_getLogs",
        params: [
          { address: MARKETPLACE, topics: [topic], fromBlock: `0x${cursor.toString(16)}`, toBlock: `0x${end.toString(16)}` },
        ],
      });
    } catch {
      if (span <= 500) throw new Error(`cannot fetch a 500-block span at ${cursor}`);
      span = Math.floor(span / 2);
      continue;
    }
    out.push(...((j.result ?? []) as LogRow[]));
    cursor = end + 1;
  }
  return out;
}

async function main(): Promise<void> {
  const head = Number((await rpc({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] })).result as string);
  // The marketplace predates the registry, but mechs created before it are
  // still the ones delivering now, so the mech roster is scanned from well
  // before the registry deployment.
  const from = Number(arg("--from", "30000000"));
  console.log(`scanning Olas Mech Marketplace ${MARKETPLACE}`);
  console.log(`blocks ${from} to ${head}\n`);

  const mechs = await scan(CREATE_MECH, from, head);
  const mechToService = new Map<string, string>();
  for (const l of mechs) {
    const mech = `0x${(l.topics[1] ?? "").slice(-40)}`.toLowerCase();
    const serviceId = BigInt(l.topics[2] ?? "0x0").toString();
    mechToService.set(mech, serviceId);
  }
  console.log(`CreateMech events: ${mechs.length}, distinct mechs: ${mechToService.size}`);
  const serviceIds = [...new Set(mechToService.values())].sort((a, b) => Number(BigInt(a) - BigInt(b)));
  console.log(`distinct Olas service ids: ${serviceIds.length}`);
  console.log(`service id range: ${serviceIds[0]} to ${serviceIds[serviceIds.length - 1]}`);

  const deliveries = await scan(MARKETPLACE_DELIVERY, from, head);
  console.log(`\nMarketplaceDelivery events: ${deliveries.length}`);
  const perMech = new Map<string, { delivered: number; failed: number }>();
  for (const l of deliveries) {
    try {
      const d = decodeEventLog({
        abi: DELIVERY_ABI,
        data: l.data as `0x${string}`,
        topics: l.topics as [`0x${string}`, ...`0x${string}`[]],
        eventName: "MarketplaceDelivery",
      });
      const a = d.args as unknown as { deliveryMech: string; deliveredRequests: readonly boolean[] };
      const mech = a.deliveryMech.toLowerCase();
      const rec = perMech.get(mech) ?? { delivered: 0, failed: 0 };
      for (const ok of a.deliveredRequests) {
        if (ok) rec.delivered += 1;
        else rec.failed += 1;
      }
      perMech.set(mech, rec);
    } catch {
      /* skip undecodable */
    }
  }
  let totalOk = 0;
  let totalBad = 0;
  for (const r of perMech.values()) {
    totalOk += r.delivered;
    totalBad += r.failed;
  }
  console.log(`mechs with delivery outcomes: ${perMech.size}`);
  console.log(`per-request outcomes: ${totalOk} delivered, ${totalBad} not delivered`);
  console.log(`mechs also seen in CreateMech: ${[...perMech.keys()].filter((m) => mechToService.has(m)).length} of ${perMech.size}`);

  // Registry side: agents publishing an Olas marketplace URL, and the Olas
  // agent id in its path.
  const olasAgents = new Map<string, string>();
  const reader = createInterface({
    input: createReadStream(`${CACHE}/logs.ndjson`, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  for await (const line of reader) {
    if (line.length === 0) continue;
    const c = JSON.parse(line) as CachedLog;
    if (c.address.toLowerCase() !== IDENTITY) continue;
    const d = decodeIdentityLog({
      address: c.address,
      topics: c.topics,
      data: c.data,
      blockNumber: Number(c.blockNumber),
      blockHash: c.blockHash,
      transactionHash: c.transactionHash,
      logIndex: Number(c.logIndex),
    });
    if (d === null) continue;
    if (d.kind !== "registered" && d.kind !== "uriUpdated") continue;
    const m = /marketplace\.olas\.network\/erc8004\/base\/ai-agents\/(\d+)/.exec(d.tokenUri);
    if (m !== null) olasAgents.set(d.agentId, m[1]!);
  }
  const olasIds = [...olasAgents.values()].map((x) => Number(x)).sort((a, b) => a - b);
  console.log(`\nERC-8004 agents publishing an Olas marketplace URL: ${olasAgents.size}`);
  if (olasIds.length > 0) {
    console.log(`Olas ai-agent id range: ${olasIds[0]} to ${olasIds[olasIds.length - 1]}`);
  }

  const serviceSet = new Set(serviceIds);
  const overlap = olasIds.filter((id) => serviceSet.has(String(id)));
  console.log(`\nOlas ai-agent ids that are also mech service ids: ${overlap.length} of ${olasIds.length}`);
  if (overlap.length === 0) {
    console.log(
      `The two id spaces do not coincide. Mech outcomes are keyed by service id and the registry link is keyed by ai-agent id, so joining them needs a mapping this script has not found. Named rather than assumed.`,
    );
  } else {
    console.log(`Sample joinable ids: ${overlap.slice(0, 15).join(", ")}`);
    const labelled: string[] = [];
    for (const [agentId, olasId] of olasAgents) {
      if (!serviceSet.has(olasId)) continue;
      const mech = [...mechToService].find(([, sid]) => sid === olasId)?.[0];
      if (mech !== undefined && perMech.has(mech)) labelled.push(agentId);
    }
    console.log(`ERC-8004 agents with retrievable delivery outcomes: ${labelled.length}`);
    if (labelled.length > 0) console.log(`  sample agent ids: ${labelled.slice(0, 15).join(", ")}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
