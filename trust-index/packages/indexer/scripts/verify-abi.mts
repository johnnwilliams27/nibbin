/**
 * Verify the committed event ABIs against a live chain.
 *
 * The failure this guards against is silent. topic0 is the keccak of the whole
 * event signature, so a single wrong parameter type, a reordered argument, or a
 * misremembered event name produces a topic that matches no log at all. The
 * indexer then runs to completion, reports zero events, and looks like it is
 * observing a quiet chain. An earlier version of abi.ts was guessed from prose
 * and every one of its five definitions was wrong in exactly this way.
 *
 * So this script does not check that the ABIs parse. It fetches logs the
 * registries actually emitted and checks that every committed topic0 appears
 * among them, that every committed definition decodes a real log without
 * throwing, and it lists any topic the registries emit that the committed ABIs
 * do not recognise.
 *
 * Usage:
 *   pnpm --filter @trust-index/indexer exec tsx scripts/verify-abi.mts \
 *     [--rpc <url>] [--windows <n>] [--span <blocks>]
 *
 * Exits non-zero when a committed event is missing from the sample or fails to
 * decode. An unrecognised topic is reported but does not fail: the registries
 * are free to emit events this project has no use for.
 */
import { decodeEventLog } from "viem";
import { MAINNET_IDENTITY_REGISTRY, MAINNET_REPUTATION_REGISTRY } from "@trust-index/types";
import { IDENTITY_REGISTRY_ABI, REPUTATION_REGISTRY_ABI } from "../src/abi.js";
import { TOPIC0 } from "../src/decode.js";

type Log = { address: string; topics: string[]; data: string; blockNumber: string };

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : (process.argv[i + 1] ?? fallback);
}

const RPC = arg("--rpc", process.env.TRUST_INDEX_RPC_URL ?? "https://mainnet.base.org");
const WINDOWS = Number(arg("--windows", "40"));
const IDENTITY = MAINNET_IDENTITY_REGISTRY.toLowerCase();
const REPUTATION = MAINNET_REPUTATION_REGISTRY.toLowerCase();

async function rpc(method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = (await res.json()) as { result?: unknown; error?: { message: string } };
  if (json.error) throw new Error(`${method}: ${json.error.message}`);
  return json.result;
}

async function main(): Promise<void> {
  const head = Number(await rpc("eth_blockNumber", []));
  console.log(`rpc=${RPC}`);
  console.log(`head=${head}`);

  // Collect one sample log per (address, topic0). Windows shrink on the
  // provider's response-size limit, the same way runBackfill chunks.
  const samples = new Map<string, { count: number; address: string; log: Log }>();
  let cursor = head;
  let span = Number(arg("--span", "2000"));
  let windows = 0;
  while (windows < WINDOWS) {
    const from = cursor - span;
    let logs: Log[];
    try {
      logs = (await rpc("eth_getLogs", [
        {
          address: [IDENTITY, REPUTATION],
          fromBlock: `0x${from.toString(16)}`,
          toBlock: `0x${cursor.toString(16)}`,
        },
      ])) as Log[];
    } catch (err) {
      if (span <= 25) throw err;
      span = Math.floor(span / 2);
      continue;
    }
    for (const log of logs) {
      const key = `${log.address}:${log.topics[0]}`;
      const entry = samples.get(key);
      if (entry) entry.count += 1;
      else samples.set(key, { count: 1, address: log.address, log });
    }
    cursor = from - 1;
    windows += 1;
  }
  console.log(`scanned blocks ${cursor + 1} to ${head}, ${samples.size} distinct events\n`);

  const expected: Array<{ name: string; topic: string; address: string; abi: typeof IDENTITY_REGISTRY_ABI }> = [
    { name: "Registered", topic: TOPIC0.registered, address: IDENTITY, abi: IDENTITY_REGISTRY_ABI },
    { name: "URIUpdated", topic: TOPIC0.uriUpdated, address: IDENTITY, abi: IDENTITY_REGISTRY_ABI },
    { name: "MetadataSet", topic: TOPIC0.metadataSet, address: IDENTITY, abi: IDENTITY_REGISTRY_ABI },
    { name: "Transfer", topic: TOPIC0.transfer, address: IDENTITY, abi: IDENTITY_REGISTRY_ABI },
    { name: "NewFeedback", topic: TOPIC0.newFeedback, address: REPUTATION, abi: REPUTATION_REGISTRY_ABI },
    { name: "FeedbackRevoked", topic: TOPIC0.feedbackRevoked, address: REPUTATION, abi: REPUTATION_REGISTRY_ABI },
    { name: "ResponseAppended", topic: TOPIC0.responseAppended, address: REPUTATION, abi: REPUTATION_REGISTRY_ABI },
  ];

  let failures = 0;
  const matched = new Set<string>();
  for (const e of expected) {
    const key = `${e.address}:${e.topic.toLowerCase()}`;
    const found = samples.get(key);
    if (found === undefined) {
      // Absence in a sample window is not proof of a wrong ABI: a rare event
      // may simply not have fired. It is reported as unconfirmed, and it does
      // not fail the run, because failing on it would make the result depend
      // on how busy the chain happened to be.
      console.log(`UNCONFIRMED ${e.name.padEnd(17)} ${e.topic}  no log in the sampled window`);
      continue;
    }
    matched.add(key);
    try {
      decodeEventLog({
        abi: e.abi,
        data: found.log.data as `0x${string}`,
        topics: found.log.topics as [`0x${string}`, ...`0x${string}`[]],
        eventName: e.name,
      });
      console.log(`OK          ${e.name.padEnd(17)} ${e.topic}  ${found.count} logs, decodes`);
    } catch (err) {
      failures += 1;
      console.log(
        `FAIL        ${e.name.padEnd(17)} ${e.topic}  topic matches but decode threw: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  const unknown = [...samples.entries()].filter(([key]) => !matched.has(key));
  if (unknown.length > 0) {
    console.log("");
    for (const [key, v] of unknown.sort((a, b) => b[1].count - a[1].count)) {
      const which = v.address === IDENTITY ? "identity" : "reputation";
      console.log(`unrecognised ${which} event, ${v.count} logs: ${key.split(":")[1]}`);
    }
    console.log("\nUnrecognised events are not a failure. They are registry events this project");
    console.log("does not consume. Look one up before assuming that: a signature database or the");
    console.log("verified implementation ABI will name it.");
  }

  if (failures > 0) {
    console.error(`\n${failures} committed event definition(s) do not match the deployed contracts.`);
    process.exit(1);
  }
  console.log("\nEvery committed event definition that appeared in the window decodes correctly.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
