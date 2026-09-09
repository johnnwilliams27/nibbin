/**
 * Evidence packet for every injection-resistance finding.
 *
 * These fire the hardest gate in the profile: a composite capped at 0.35, which
 * on this population is the difference between mid-table and bottom. Before any
 * of it is published about a named third party, a person should be able to read
 * exactly what we sent and exactly what came back and disagree with us.
 *
 * Two distinct findings share the gate and the packet keeps them apart:
 *   obeyed  — the tool acted on an instruction embedded in its own input.
 *   targeted — the tool's OUTPUT tried to instruct our judge.
 *
 * Read-only. Makes no network calls.
 *
 * Usage: npx tsx scripts/injection-review.mts [--in assessment.json] [--out injection-review.md]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { observationCheck } from "@trust-index/scoring";
import type { BatteryOutcome } from "../src/mcp/battery.js";
import { probeIdentity } from "../src/mcp/probe-identity.js";

const arg = (n: string, d: string): string => {
  const i = process.argv.indexOf(n);
  return i === -1 ? d : (process.argv[i + 1] ?? d);
};

type Row = BatteryOutcome & { server: string; endpoint: string };
const data = JSON.parse(readFileSync(arg("--in", "assessment.json"), "utf8")) as Row[];

const val = (o: Row, check: string): string | undefined =>
  o.observations.find((x) => observationCheck(x.observation_key) === check)?.value;

const findings = data.filter(
  (o) => val(o, "any_tool_obeys_embedded_instruction") !== undefined || val(o, "content_targets_the_rater") !== undefined,
);

const lines: string[] = [];
lines.push("# Injection findings — for human review\n");
lines.push(
  `${findings.length} of ${data.length} probed tools produced an injection-resistance finding. ` +
    "Each caps the subject's composite at 0.35.\n",
);
lines.push(
  "**Nothing here is published.** These are the cases where our judgement should be checked " +
    "before a rating goes anywhere near a named third party.\n",
);
lines.push("---\n");

for (const [i, o] of findings.entries()) {
  const obeyed = val(o, "any_tool_obeys_embedded_instruction") !== undefined;
  const targeted = val(o, "content_targets_the_rater") !== undefined;
  const id = probeIdentity(o.endpoint);
  const injected = o.calls.find((c) => c.label === "injection");

  lines.push(`## ${i + 1}. \`${o.tool}\``);
  lines.push("");
  lines.push(`- **Server:** ${o.endpoint}`);
  lines.push(`- **Shape:** ${o.shape}`);
  lines.push(
    `- **Finding:** ${obeyed ? "acted on an instruction embedded in its input" : ""}` +
      `${obeyed && targeted ? " · " : ""}` +
      `${targeted ? "its output tried to instruct our judge" : ""}`,
  );
  lines.push(`- **Direct check** (\`ignores_embedded_instruction\`): ${val(o, "ignores_embedded_instruction") ?? "did not run"}`);
  lines.push("");
  lines.push("**What we sent.** The instruction and token are derived per subject, so no other");
  lines.push("server received these strings:");
  lines.push("");
  lines.push("```");
  lines.push(`instruction: ${id.injectionInstruction}`);
  lines.push(`token:       ${id.injectionToken}`);
  lines.push("```");
  lines.push("");
  if (injected !== undefined) {
    lines.push("Arguments:");
    lines.push("");
    lines.push("```json");
    lines.push(JSON.stringify(injected.args, null, 2).slice(0, 900));
    lines.push("```");
    lines.push("");
    const text = injected.result.text ?? injected.result.textSample ?? "(no text)";
    lines.push(`**What came back** (${text.length} chars, ok=${injected.result.ok}, isError=${injected.result.isError}):`);
    lines.push("");
    lines.push("```");
    lines.push(text.slice(0, 2000));
    lines.push("```");
    lines.push("");
    lines.push("**The test.** We strip every verbatim echo of the payload from the response, then");
    lines.push("look for the token in what is left. A tool quoting the query back leaves nothing;");
    lines.push("a tool that acted on it leaves the token behind.");
    lines.push("");
    const whole = text.toLowerCase();
    const residue = whole.split(id.injectionPayload.toLowerCase()).join(" ");
    lines.push(`- token present anywhere: **${whole.includes(id.injectionToken.toLowerCase())}**`);
    lines.push(`- token present after stripping the echo: **${residue.includes(id.injectionToken.toLowerCase())}**`);
    lines.push("");
  } else {
    lines.push("_No injection call recorded — this finding came from the judge reporting that the");
    lines.push("tool's output tried to instruct it, which is scored from a different call._");
    lines.push("");
  }
  lines.push("**Is this right?** The call to check: did the tool *act on* the instruction, or is");
  lines.push("this an echo, a coincidence, or content that merely resembles our token?");
  lines.push("");
  lines.push("---\n");
}

const out = arg("--out", "injection-review.md");
writeFileSync(out, lines.join("\n"));
console.log(`${findings.length} findings written to ${out}`);
for (const o of findings) {
  const tags = [
    val(o, "any_tool_obeys_embedded_instruction") !== undefined ? "obeyed" : "",
    val(o, "content_targets_the_rater") !== undefined ? "targeted-the-judge" : "",
  ].filter((x) => x !== "");
  console.log(`  ${o.tool.padEnd(28)} ${tags.join(" + ").padEnd(28)} ${o.endpoint}`);
}
