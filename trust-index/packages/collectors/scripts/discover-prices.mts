/**
 * What do the metered tools actually charge?
 *
 * A 402 states its terms before any payment, so the real tariff is readable for
 * nothing. This replaces an estimate that spanned 100x between its median and
 * its worst case with a measurement. Free: it never signs anything.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { classifyTool } from "../src/mcp/shape.js";
import { selectToolsForAssessment } from "../src/mcp/select.js";
import { synthesizeInput } from "../src/mcp/invoke.js";
import { discoverPrice, atomicToUsd } from "../src/x402.js";
import { probeIdentity } from "../src/mcp/probe-identity.js";
import { jitteredSpacing } from "../src/mcp/probe-identity.js";
import type { ProbeTranscript } from "../src/mcp/transcript.js";

const inputs = readdirSync("transcripts").filter((f) => f.endsWith(".json")).map((f) => ({
  server: f.replace(/\.json$/, ""),
  transcript: JSON.parse(readFileSync(`transcripts/${f}`, "utf8")) as ProbeTranscript,
}));
const sel = selectToolsForAssessment(inputs, { perServer: 3, perShape: 0 });
const metered = sel.selected.filter((s) => classifyTool(s.declaration).metered);
console.log(`probing ${metered.length} metered tools across ${new Set(metered.map((m) => m.server)).size} servers for price\n`);

type Row = { server: string; endpoint: string; tool: string; usd: number | null; scheme: string | null; network: string | null; status: number | null; note: string | null };
const rows: Row[] = [];
for (const [i, s] of metered.entries()) {
  const id = probeIdentity(s.endpoint);
  const args = synthesizeInput(s.declaration.inputSchema).args;
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: s.declaration.name, arguments: args } });
  try {
    const q = await discoverPrice(s.endpoint, body, {
      headers: { "mcp-protocol-version": "2025-06-18", "user-agent": id.userAgent },
      tool: s.declaration.name,
    });
    rows.push({
      server: s.server, endpoint: s.endpoint, tool: s.declaration.name,
      usd: q.cheapest?.maxAmountRequired != null ? atomicToUsd(q.cheapest.maxAmountRequired) : null,
      scheme: q.cheapest?.scheme ?? null, network: q.cheapest?.network ?? null,
      status: q.status, note: q.note,
    });
  } catch (e) {
    rows.push({ server: s.server, endpoint: s.endpoint, tool: s.declaration.name, usd: null, scheme: null, network: null, status: null, note: String(e).slice(0, 80) });
  }
  if ((i + 1) % 10 === 0) console.log(`  ${i + 1}/${metered.length}`);
  await new Promise((r) => setTimeout(r, jitteredSpacing(350)));
}
writeFileSync("price-discovery.json", JSON.stringify(rows, null, 2));

const priced = rows.filter((r) => r.usd !== null && r.usd > 0);
const total = priced.reduce((a, r) => a + r.usd! * 6, 0);
console.log(`\n=== MEASURED ===`);
console.log(`tools quoting a real price:  ${priced.length} of ${rows.length}`);
console.log(`cost of a full sweep (6 calls/tool): $${total.toFixed(4)}`);
const byNet = new Map<string, number>();
for (const r of priced) byNet.set(`${r.scheme}/${r.network}`, (byNet.get(`${r.scheme}/${r.network}`) ?? 0) + 1);
console.log(`schemes: ${[...byNet].map(([k, v]) => `${k} x${v}`).join(", ") || "none"}`);
if (priced.length > 0) {
  const us = priced.map((r) => r.usd!).sort((a, b) => a - b);
  console.log(`per call: min $${us[0]!.toFixed(4)}  median $${us[Math.floor(us.length/2)]!.toFixed(4)}  max $${us[us.length-1]!.toFixed(4)}`);
  console.log(`\nmost expensive:`);
  for (const r of [...priced].sort((a,b)=>b.usd!-a.usd!).slice(0,8)) console.log(`  $${r.usd!.toFixed(4)}/call  ${r.server.slice(0,34).padEnd(34)} ${r.tool}`);
}
const unpriced = rows.filter((r) => r.usd === null);
const notes = new Map<string, number>();
for (const r of unpriced) notes.set(r.note ?? `status ${r.status}`, (notes.get(r.note ?? `status ${r.status}`) ?? 0) + 1);
console.log(`\nno price returned (${unpriced.length}):`);
for (const [n, c] of [...notes].sort((a,b)=>b[1]-a[1]).slice(0,6)) console.log(`  ${String(c).padStart(3)}  ${n}`);
