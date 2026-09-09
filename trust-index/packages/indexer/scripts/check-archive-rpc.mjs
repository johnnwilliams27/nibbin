/**
 * Does this RPC endpoint actually serve historical logs?
 *
 * Run this BEFORE a population sweep. A full BSC sweep is ~15,400 requests
 * across 76.8M blocks; discovering at request 9,000 that the endpoint silently
 * stops serving old blocks wastes the run and, worse, produces a partial
 * enumeration that looks complete. This asks the one question that matters and
 * answers it in about a second.
 *
 * Measured 2026-09-09: 36 public BSC endpoints were tested and every one
 * failed this check. The pruned full nodes (bsc-dataseed*) answer
 * "limit exceeded" even for a 100-block window, so a smaller chunk size is not
 * a workaround. Expect to need a keyed archive endpoint.
 *
 * Usage:
 *   node scripts/check-archive-rpc.mjs 'https://...your-key...'
 *   ARCHIVE_RPC='https://...' node scripts/check-archive-rpc.mjs
 *
 * Exit 0 = usable for a full sweep. Exit 1 = not usable, with the reason.
 */
const REGISTRY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";
const url = process.argv[2] ?? process.env.ARCHIVE_RPC ?? "";

if (url === "") {
  console.error("Pass an RPC URL, or set ARCHIVE_RPC.");
  process.exit(1);
}

async function rpc(method, params, ms = 20000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: c.signal,
    });
    const j = await r.json();
    if (j.error) throw new Error(j.error.message ?? JSON.stringify(j.error));
    return j.result;
  } finally {
    clearTimeout(t);
  }
}

const hex = (n) => "0x" + Math.floor(n).toString(16);
let failed = false;
const note = (ok, label, detail) => {
  if (!ok) failed = true;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

console.log(`Checking ${url.replace(/[0-9a-f]{16,}/gi, "<key>")}\n`);

let head;
try {
  head = parseInt(await rpc("eth_blockNumber", []), 16);
  note(true, "reachable", `head block ${head}`);
} catch (e) {
  note(false, "reachable", String(e.message).slice(0, 90));
  console.log("\nNot usable: the endpoint did not answer eth_blockNumber.");
  process.exit(1);
}

// The decisive test. ~70M blocks back is near the registry's deploy era on BSC;
// every pruned node refuses here regardless of how small the window is.
const DEEP = Math.max(1, head - 70_000_000);
try {
  const logs = await rpc("eth_getLogs", [
    { address: REGISTRY, fromBlock: hex(DEEP), toBlock: hex(DEEP + 4999) },
  ]);
  note(true, "historical getLogs (5,000-block window at -70M)", `${logs.length} logs`);
} catch (e) {
  note(false, "historical getLogs (5,000-block window at -70M)", String(e.message).slice(0, 90));
}

// Range cap. We want 5,000+. An endpoint that serves archive but caps at 25
// blocks (blockrazor does) turns BSC into ~3M requests, which is not a route.
let bestWindow = 0;
for (const size of [10000, 5000, 2000, 1000, 100, 25]) {
  try {
    await rpc("eth_getLogs", [
      { address: REGISTRY, fromBlock: hex(head - size), toBlock: hex(head) },
    ]);
    bestWindow = size;
    break;
  } catch {
    /* try a smaller window */
  }
}
note(bestWindow >= 2000, "block-range cap", bestWindow === 0 ? "no window accepted" : `${bestWindow} blocks`);

if (bestWindow > 0) {
  const requests = Math.ceil(76_800_000 / bestWindow);
  console.log(`\n  A full BSC sweep at ${bestWindow} blocks/request = ~${requests.toLocaleString()} requests.`);
  if (requests > 200_000) {
    console.log("  That is too many to be practical — you want a larger range cap.");
  }
}

console.log(
  failed
    ? "\nNOT USABLE for a full sweep. Historical logs are the requirement; a node that\n" +
        "serves only recent blocks cannot enumerate the population, and chunking smaller\n" +
        "does not help because the refusal is about archive depth, not range."
    : "\nUSABLE. Run:\n" +
        "  export ARCHIVE_RPC='<this url>'\n" +
        "  pnpm --filter @trust-index/indexer exec tsx scripts/build-population-frame.mts --chain bsc",
);
process.exit(failed ? 1 : 0);
