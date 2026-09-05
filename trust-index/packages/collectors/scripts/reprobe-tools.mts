/**
 * Re-probe a named set of tools, and nothing else.
 *
 * For when a CHECK changed rather than the subject. Re-deriving observations by
 * editing a stored assessment file would be faster and is the wrong instinct:
 * measurement data should come out of the instrument, not out of a text editor.
 * Five or six calls to the handful of servers actually affected is cheap.
 *
 * Usage: npx tsx scripts/reprobe-tools.mts --i-have-approval --tools a,b,c --out x.json
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { classifyTool } from "../src/mcp/shape.js";
import { runBattery, type BatteryOutcome } from "../src/mcp/battery.js";
import { parseRpcBody } from "../src/mcp/probe.js";
import { guardedFetch } from "../src/net.js";
import type { ProbeTranscript } from "../src/mcp/transcript.js";
import { judgeFromEnv } from "../src/judge/production.js";
import { probeIdentity } from "../src/mcp/probe-identity.js";

const arg = (n: string, d: string): string => {
  const i = process.argv.indexOf(n);
  return i === -1 ? d : (process.argv[i + 1] ?? d);
};
if (!process.argv.includes("--i-have-approval")) {
  console.log("This CALLS tools on third-party servers. Re-run with --i-have-approval.");
  process.exit(0);
}
const wanted = new Set(arg("--tools", "").split(",").map((x) => x.trim()).filter((x) => x !== ""));
if (wanted.size === 0) { console.log("--tools is required"); process.exit(1); }

const judge = judgeFromEnv();
const out: Array<BatteryOutcome & { server: string; endpoint: string }> = [];

for (const f of readdirSync("transcripts").filter((x) => x.endsWith(".json")).sort()) {
  const t = JSON.parse(readFileSync(`transcripts/${f}`, "utf8")) as ProbeTranscript;
  if (t.tools?.ok !== true || t.auth?.required === true) continue;
  for (const d of t.tools.declared) {
    if (!wanted.has(d.name)) continue;
    const c = classifyTool(d);
    if (c.binding.kind !== "read_only") continue;
    const id = probeIdentity(t.endpoint);
    const H = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-06-18",
      "user-agent": id.userAgent,
    };
    const r = await guardedFetch(t.endpoint, {
      method: "POST", headers: H, timeoutMs: 10_000,
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: id.clientName, version: id.clientVersion } } }),
    });
    if (!r.ok) { console.log(`  ${d.name}: no session`); continue; }
    const sid = r.headers.get("mcp-session-id");
    await guardedFetch(t.endpoint, {
      method: "POST", timeoutMs: 10_000,
      headers: sid === null ? H : { ...H, "mcp-session-id": sid },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }),
    });
    try {
      const o = await runBattery(d, c, {
        observerId: "probe:mcp:v1", ts: new Date().toISOString().slice(0, 19) + "Z",
        endpoint: t.endpoint, sessionId: sid, parseBody: parseRpcBody, spacingMs: 350, timeoutMs: 12_000,
        identity: id, ...(judge === null ? {} : { judge }),
      });
      out.push({ ...o, server: f.replace(/\.json$/, ""), endpoint: t.endpoint });
      const v = (k: string) => o.observations.find((x) => x.observation_key.split(":")[0] === k)?.value ?? "-";
      console.log(`  ${d.name.padEnd(34)} inj=${v("ignores_embedded_instruction")}  obeys=${v("any_tool_obeys_embedded_instruction")}  targets=${v("content_targets_the_rater")}`);
    } catch (err) {
      console.log(`  ${d.name}: REFUSED ${err instanceof Error ? err.message : err}`);
    }
  }
}
writeFileSync(arg("--out", "reprobe.json"), JSON.stringify(out, null, 2));
console.log(`\n${out.length} tools re-probed`);
