/**
 * What would this run CALL, and why?
 *
 * Written after a live re-probe called `add_trade` on a stranger's server four
 * times. The callability guard is now an allowlist and is covered by tests, but
 * a test says the rule behaves as written; only this says what the rule ADMITS
 * on today's corpus. The blast radius of a probe run should be reviewable by a
 * person before the first call goes out, not reconstructed from a log after.
 *
 * Read-only. Makes no network calls.
 *
 * Usage: npx tsx scripts/probe-plan.mts [--max-tools-per-server 3] [--out probe-plan.md]
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { classifyTool } from "../src/mcp/shape.js";
import type { ProbeTranscript } from "../src/mcp/transcript.js";

const arg = (n: string, d: string): string => {
  const i = process.argv.indexOf(n);
  return i === -1 ? d : (process.argv[i + 1] ?? d);
};
const maxPerServer = Number(arg("--max-tools-per-server", "3"));
const dir = arg("--transcripts", "transcripts");

type Row = { server: string; endpoint: string; tool: string; shape: string; basis: string; description: string };
const planned: Row[] = [];
const skippedServers: Array<{ endpoint: string; why: string }> = [];
let declaredCount = 0;

for (const f of readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
  const t = JSON.parse(readFileSync(`${dir}/${f}`, "utf8")) as ProbeTranscript;
  if (t.tools?.ok !== true) {
    skippedServers.push({ endpoint: t.endpoint, why: "no tool listing" });
    continue;
  }
  if (t.auth?.required === true) {
    skippedServers.push({ endpoint: t.endpoint, why: "auth required" });
    continue;
  }
  let taken = 0;
  for (const d of t.tools.declared) {
    declaredCount += 1;
    const c = classifyTool(d);
    if (c.binding.kind !== "read_only") continue;
    if (taken >= maxPerServer) break;
    planned.push({
      server: f.replace(/\.json$/, ""),
      endpoint: t.endpoint,
      tool: d.name,
      shape: c.shape,
      basis: c.binding.basis,
      description: (d.description ?? "").replace(/\s+/g, " ").slice(0, 160),
    });
    taken += 1;
  }
}

const servers = new Set(planned.map((p) => p.endpoint));
const byShape = new Map<string, number>();
const byBasis = new Map<string, number>();
for (const p of planned) {
  byShape.set(p.shape, (byShape.get(p.shape) ?? 0) + 1);
  byBasis.set(p.basis, (byBasis.get(p.basis) ?? 0) + 1);
}

const CALLS_PER_TOOL = 6;
const lines: string[] = [];
lines.push("# Probe plan — what this run would call\n");
lines.push(`Generated from ${dir}/ with --max-tools-per-server ${maxPerServer}. No network calls were made.\n`);
lines.push(`- tools declared across the corpus: **${declaredCount}**`);
lines.push(`- tools this run would call: **${planned.length}**`);
lines.push(`- distinct servers contacted: **${servers.size}**`);
lines.push(`- upper bound on requests: **~${planned.length * CALLS_PER_TOOL}** (${CALLS_PER_TOOL} per tool)`);
lines.push(`- servers skipped entirely: ${skippedServers.length}\n`);
lines.push("## Why each tool is considered callable\n");
lines.push("`declared` = the operator set readOnlyHint AND nothing contradicts it.");
lines.push("`inferred` = no annotations at all, read-shaped, leading verb on the read allowlist, no write signal.\n");
for (const [b, n] of [...byBasis].sort((a, b2) => b2[1] - a[1])) lines.push(`- **${b}**: ${n}`);
lines.push("\n## By shape\n");
for (const [s, n] of [...byShape].sort((a, b2) => b2[1] - a[1])) lines.push(`- ${s}: ${n}`);
lines.push("\n## Every tool, in full\n");
lines.push("| # | tool | basis | shape | server | description |");
lines.push("|---|---|---|---|---|---|");
planned.forEach((p, i) => {
  const esc = (s: string) => s.replace(/\|/g, "\\|");
  lines.push(`| ${i + 1} | \`${esc(p.tool)}\` | ${p.basis} | ${p.shape} | ${esc(p.endpoint)} | ${esc(p.description)} |`);
});

const out = arg("--out", "probe-plan.md");
writeFileSync(out, lines.join("\n") + "\n");
console.log(`tools to call:   ${planned.length}`);
console.log(`servers:         ${servers.size}`);
console.log(`request ceiling: ~${planned.length * CALLS_PER_TOOL}`);
console.log(`basis:           ${[...byBasis].map(([b, n]) => `${b}=${n}`).join("  ")}`);
console.log(`\nwritten to ${out}`);
