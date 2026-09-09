/**
 * Run the A2A behavioural battery over transcripts already on disk.
 *
 * The MCP side has `assess.mts` doing this. A2A had no equivalent, which is why
 * every A2A agent on the BSC index was discoverable, describable, and
 * permanently unrateable: `a2a_agent.v1` puts 0.80 of its weight on behaviour,
 * and nothing was producing any.
 *
 * WHAT THIS SENDS, and the one screen that survives. `runA2aBattery` refuses to
 * invoke a skill whose id, tags or published examples carry a mutating verb —
 * these are DeFi agents on BSC and 13,715 of them declare `x402Support: true`,
 * a live payment rail. Every refusal is recorded with its reason and reaches
 * the rating as OUR gap, never as the agent's failure.
 *
 * Transcripts are read, never re-probed: discovery already established what
 * each agent declares, and re-fetching 50 cards to learn the same thing is
 * traffic someone else pays for.
 *
 * Usage:
 *   pnpm exec tsx scripts/run-a2a-battery.mts --transcripts trial-transcripts \
 *     --out a2a-battery.json [--max-skills 3] [--concurrency 4]
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runA2aBattery } from "../src/a2a/battery.js";
import type { A2aBatteryResult } from "../src/a2a/battery.js";
import type { A2aTranscript } from "../src/a2a/transcript.js";
import { probeIdentity, probeSeed } from "../src/mcp/probe-identity.js";

const argv = process.argv.slice(2);
const arg = (n: string, d: string): string => {
  const i = argv.indexOf(n);
  return i === -1 ? d : (argv[i + 1] ?? d);
};

const DIR = arg("--transcripts", "trial-transcripts");
const OUT = arg("--out", "a2a-battery.json");
const MAX_SKILLS = Number(arg("--max-skills", "3"));
/**
 * Agents, not requests. Each agent takes six sequential calls, so this is the
 * number of DIFFERENT operators being dialled at once — never several at once
 * against one.
 */
const CONCURRENCY = Number(arg("--concurrency", "4"));

const { reproducible } = probeSeed();
if (!reproducible) {
  // Not fatal: probe-identity.ts generates a per-process seed, so the run is
  // still unguessable. It is simply not replayable afterwards, and a published
  // rating nobody can reproduce is worth saying out loud.
  console.warn(
    "TRUST_INDEX_PROBE_SEED is not set: this run uses an ephemeral seed and cannot be replayed.",
  );
}

/** The endpoint to speak JSON-RPC to. The card's interface, not the card's URL. */
function endpointOf(t: A2aTranscript): string | null {
  if (t.reachability?.url != null && t.reachability.url !== "") return t.reachability.url;
  const declared = t.declaration?.interfaces[0]?.url;
  if (typeof declared === "string" && declared !== "") return declared;
  return null;
}

type Loaded = { file: string; transcript: A2aTranscript; endpoint: string };

const loaded: Loaded[] = [];
const skippedSubjects: Array<{ file: string; reason: string }> = [];

for (const f of readdirSync(DIR).filter((x) => x.startsWith("a2a_") && x.endsWith(".json"))) {
  let t: A2aTranscript;
  try {
    t = JSON.parse(readFileSync(join(DIR, f), "utf8")) as A2aTranscript;
  } catch {
    skippedSubjects.push({ file: f, reason: "transcript did not parse" });
    continue;
  }
  const endpoint = endpointOf(t);
  if (endpoint === null) {
    // A declaration finding, and it belongs to the subject. Recorded here only
    // so the count reconciles; a2aToSubject records it as the gap.
    skippedSubjects.push({ file: f, reason: "the card declares no interface to dial" });
    continue;
  }
  const skills = t.declaration?.skills ?? [];
  if (skills.length === 0) {
    skippedSubjects.push({ file: f, reason: "the card declares no skills" });
    continue;
  }
  loaded.push({ file: f, transcript: t, endpoint });
}

console.log(
  `${loaded.length} agents with declared skills, ${skippedSubjects.length} without\n` +
    `up to ${MAX_SKILLS} skills each, ${CONCURRENCY} agents at a time\n`,
);

const results: A2aBatteryResult[] = [];
let cursor = 0;

async function worker(): Promise<void> {
  while (cursor < loaded.length) {
    const item = loaded[cursor++]!;
    const skills = item.transcript.declaration?.skills ?? [];
    try {
      const r = await runA2aBattery(item.endpoint, skills, {
        maxSkills: MAX_SKILLS,
        protocolVersion: item.transcript.declaration?.protocolVersion ?? null,
        // Per-subject probe values, derived from the seed. A fixed injection
        // token in a public repository is a rating an operator can grep for.
        identity: probeIdentity(item.endpoint),
        timeoutMs: 25_000,
      });
      results.push(r);
      const answered = r.skills.filter((s) => s.checks["answers_at_all"] === true).length;
      console.log(
        `  ${String(answered).padStart(2)}/${String(r.skills.length).padEnd(2)} answered` +
          `  ${String(r.skipped.length).padStart(2)} refused  ${item.endpoint.slice(0, 56)}`,
      );
    } catch (e) {
      // A throw here is OUR failure to run the battery. It is recorded as a
      // result with no skills, so the subject reaches scoring with a harness
      // gap rather than disappearing from the denominator.
      results.push({
        endpoint: item.endpoint,
        probedAt: new Date().toISOString(),
        skills: [],
        skipped: [{ skillId: "*", reason: `battery threw: ${String((e as Error).message).slice(0, 140)}` }],
      });
      console.log(`  battery threw: ${String((e as Error).message).slice(0, 50)}  ${item.endpoint.slice(0, 48)}`);
    }
  }
}

await Promise.all(Array.from({ length: Math.min(CONCURRENCY, Math.max(1, loaded.length)) }, worker));

writeFileSync(
  OUT,
  JSON.stringify(
    {
      generated_at: new Date().toISOString(),
      reproducible,
      max_skills: MAX_SKILLS,
      agents_probed: results.length,
      agents_not_probed: skippedSubjects,
      results,
    },
    null,
    1,
  ),
);

const skillsProbed = results.reduce((s, r) => s + r.skills.length, 0);
const skillsRefused = results.reduce((s, r) => s + r.skipped.length, 0);
console.log(`\nagents probed  : ${results.length}`);
console.log(`skills probed  : ${skillsProbed}`);
console.log(`skills refused : ${skillsRefused}  (our screen; recorded as our gap, not their failure)`);
console.log(`-> ${OUT}`);
