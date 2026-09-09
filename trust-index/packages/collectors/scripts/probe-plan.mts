/**
 * What would this run CALL, and why?
 *
 * Written after a live re-probe called `add_trade` on a stranger's server four
 * times. The callability guard is now an allowlist and is covered by tests, but
 * a test says the rule behaves as written; only this says what the rule ADMITS
 * on today's corpus. The blast radius of a probe run should be reviewable by a
 * person before the first call goes out, not reconstructed from a log after.
 *
 * It must therefore agree with the run. It did not: this script walked each
 * server's declaration in order and took the first N read-only tools, which is
 * the defect src/mcp/select.ts was written to remove, so the plan a person
 * reviewed and the tools assess.mts actually called had drifted apart. A plan
 * that does not match the run is worse than no plan, so this now calls the same
 * selector assess.mts calls, with the same defaults.
 *
 * Read-only. Makes no network calls.
 *
 * Usage: npx tsx scripts/probe-plan.mts [--max-tools-per-server 3] [--per-shape N]
 *          [--out probe-plan.md]
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { describeSelection, MAX_TOOLS_PER_SERVER, selectToolsForAssessment } from "../src/mcp/select.js";
import type { ProbeTranscript } from "../src/mcp/transcript.js";

const arg = (n: string, d: string): string => {
  const i = process.argv.indexOf(n);
  return i === -1 ? d : (process.argv[i + 1] ?? d);
};
const maxPerServer = Number(arg("--max-tools-per-server", String(MAX_TOOLS_PER_SERVER)));
const perShape = Number(arg("--per-shape", "0"));
const dir = arg("--transcripts", "transcripts");

const inputs = readdirSync(dir)
  .filter((x) => x.endsWith(".json"))
  .sort()
  .map((f) => ({
    server: f.replace(/\.json$/, ""),
    transcript: JSON.parse(readFileSync(`${dir}/${f}`, "utf8")) as ProbeTranscript,
  }));
const declaredCount = inputs.reduce((n, i) => n + (i.transcript.tools?.declared.length ?? 0), 0);
const selection = selectToolsForAssessment(inputs, { perServer: maxPerServer, perShape });
const skippedServers = selection.skippedServers;

type Row = {
  server: string; endpoint: string; tool: string; shape: string; basis: string;
  description: string; rank: number; score: number; why: string;
};
// The reason each tool was chosen travels with it. The point of this file is
// that a person can disagree with the plan before it is executed, and "why this
// tool and not that one" is now a question with an answer.
const planned: Row[] = selection.selected.map((s) => ({
  server: s.server,
  endpoint: s.endpoint,
  tool: s.declaration.name,
  shape: s.shape,
  basis: s.classification.binding.kind === "read_only" ? s.classification.binding.basis : "n/a",
  description: (s.declaration.description ?? "").replace(/\s+/g, " ").slice(0, 160),
  rank: s.rankInServer,
  score: s.informativeness.score,
  why: s.informativeness.reasons.join(", "),
}));

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
lines.push(`- servers skipped entirely: ${skippedServers.length}`);
lines.push(`- servers with tools but none we may call: ${selection.noEligibleTools.length}`);
lines.push(`- servers the global cap dropped to zero: ${selection.starvedByGlobalCap.length}\n`);
lines.push("## Selection\n");
for (const line of describeSelection(selection, perShape)) lines.push(`    ${line}`);
lines.push("");
lines.push("## Why each tool is considered callable\n");
lines.push("`declared` = the operator set readOnlyHint AND nothing contradicts it.");
lines.push("`inferred` = no annotations at all, read-shaped, leading verb on the read allowlist, no write signal.\n");
for (const [b, n] of [...byBasis].sort((a, b2) => b2[1] - a[1])) lines.push(`- **${b}**: ${n}`);
lines.push("\n## By shape\n");
for (const [s, n] of [...byShape].sort((a, b2) => b2[1] - a[1])) lines.push(`- ${s}: ${n}`);
lines.push("\n## Every tool, in full\n");
lines.push("| # | tool | basis | shape | rank | score | why chosen | server | description |");
lines.push("|---|---|---|---|---|---|---|---|---|");
planned.forEach((p, i) => {
  const esc = (s: string) => s.replace(/\|/g, "\\|");
  lines.push(
    `| ${i + 1} | \`${esc(p.tool)}\` | ${p.basis} | ${p.shape} | ${p.rank} | ${p.score} | ${esc(p.why)} | ` +
      `${esc(p.endpoint)} | ${esc(p.description)} |`,
  );
});

const out = arg("--out", "probe-plan.md");
writeFileSync(out, lines.join("\n") + "\n");
console.log(`tools to call:   ${planned.length}`);
console.log(`servers:         ${servers.size}`);
console.log(`request ceiling: ~${planned.length * CALLS_PER_TOOL}`);
console.log(`basis:           ${[...byBasis].map(([b, n]) => `${b}=${n}`).join("  ")}`);
for (const line of describeSelection(selection, perShape)) console.log(line);
console.log(`\nwritten to ${out}`);
