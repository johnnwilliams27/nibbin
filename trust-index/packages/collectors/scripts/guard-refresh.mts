/**
 * Refuse to publish a probe run that looks like OUR failure rather than the
 * population's.
 *
 * WHY AN UNATTENDED PROBE RUN NEEDS THIS AND A MANUAL ONE DOES NOT. When a
 * person runs the sweep they see the output: a screen of timeouts is obvious
 * and nobody merges it. A weekly job has no such reader. If the runner loses
 * DNS, or an egress proxy starts refusing, or a dependency upgrade breaks TLS,
 * every endpoint comes back unmeasured — and the merge would faithfully write
 * "we could not reach it" across the whole index. That is rule 1 violated at
 * population scale, automatically, every week, with nobody in the loop.
 *
 * THE ASYMMETRY THIS RESTS ON. These endpoints sit on hundreds of independent
 * hosts run by unrelated operators. Any one of them can go down in a week and
 * that is a real finding worth publishing. Hundreds going down in the same
 * hour is not a fact about them; it is a fact about us. So the guard does not
 * ask "did anything get worse" — things get worse, and saying so is the job.
 * It asks whether the change is too CORRELATED to be about the subjects.
 *
 * WHAT COUNTS AS A REGRESSION. Only a subject that ANSWERED in the baseline and
 * produced NO READING now. An endpoint that answers with a 404, an auth wall or
 * a rate limit is still answering — those are subject facts and rule 3 says so
 * — and they never trip this guard however much they move.
 *
 * Exit 0 = publish. Exit 1 = do not merge, and the reason is on stdout.
 *
 * Usage:
 *   pnpm exec tsx scripts/guard-refresh.mts --baseline old-probes.json \
 *     --candidate new-probes.json [--max-regression 0.25] [--min-baseline 20]
 */
import { existsSync, readFileSync } from "node:fs";
import type { ProbeTranscript } from "../src/mcp/transcript.js";
import type { A2aTranscript } from "../src/a2a/transcript.js";
import { isSubjectFact } from "../src/a2a/transcript.js";

const arg = (n: string, d: string): string => {
  const i = process.argv.indexOf(n);
  return i === -1 ? d : (process.argv[i + 1] ?? d);
};

const BASELINE = arg("--baseline", "");
const CANDIDATE = arg("--candidate", "");
/**
 * Share of previously-answering endpoints that may go silent before the run is
 * treated as our fault. 0.25 is a judgement, not a measurement, and it is
 * deliberately loose: it has to tolerate a genuinely bad week for a platform
 * that hosts a quarter of the population, while catching the runner losing its
 * network — which takes everything, not a quarter.
 */
const MAX_REGRESSION = Number(arg("--max-regression", "0.25"));
/** Below this many answering endpoints in the baseline, the ratio is noise. */
const MIN_BASELINE = Number(arg("--min-baseline", "20"));
/** The candidate must still cover this share of the baseline's endpoints. */
const MIN_COVERAGE = Number(arg("--min-coverage", "0.9"));

type EndpointResult = { endpoint: string; mcp: ProbeTranscript | null; a2a: A2aTranscript | null };

/**
 * Did the endpoint answer us at all?
 *
 * Deliberately generous. A 401, a 429, a 404 and an HTML page are all answers —
 * the server was there and said something. Only silence counts as no reading:
 * a transport error, a timeout, a DNS failure, a 5xx, or our own guard
 * declining to dial.
 */
function answered(r: EndpointResult): boolean {
  const m = r.mcp;
  if (m != null) {
    if (m.handshake?.ok === true) return true;
    if (m.auth?.required === true) return true;
    if (m.rate_limit?.limited === true) return true;
    if (m.attempts?.some((a) => a.status !== null && a.status < 500)) return true;
  }
  const a = r.a2a;
  if (a != null) {
    if (a.discovery != null && isSubjectFact(a.discovery.outcome)) return true;
    const v = a.reachability?.verdict;
    if (v !== undefined && v !== "unmeasured" && v !== "refused") return true;
  }
  return false;
}

/**
 * A path that was GIVEN and does not exist is a mistake, not a first run.
 *
 * The first version treated both as "no baseline" and published unguarded.
 * Caught by testing it: a relative path resolved against the wrong working
 * directory printed "no baseline" and waved the run through — a typo silently
 * disabling the very check that stops us publishing our own outage. A guard
 * that fails open on operator error is not a guard. Only an OMITTED baseline
 * means first run.
 */
function load(path: string, label: string): Map<string, EndpointResult> {
  if (path === "") return new Map();
  if (!existsSync(path)) {
    console.log(`REFUSE: --${label} was given as ${path} and no such file exists.`);
    console.log("Omit the flag entirely for a genuine first run; do not point it at nothing.");
    process.exit(1);
  }
  const doc = JSON.parse(readFileSync(path, "utf8")) as { results?: EndpointResult[] };
  return new Map((doc.results ?? []).map((r) => [r.endpoint, r]));
}

const base = load(BASELINE, "baseline");
const cand = load(CANDIDATE, "candidate");

if (cand.size === 0) {
  console.log("REFUSE: the candidate run has no endpoints at all.");
  process.exit(1);
}

// A first run has nothing to compare against, and refusing it would mean the
// guard could never be adopted. Publish, and say that is what happened.
if (base.size === 0) {
  console.log(`no baseline to compare against; publishing ${cand.size} endpoints unguarded.`);
  process.exit(0);
}

const coverage = cand.size / base.size;
const baseAnswered = [...base.values()].filter(answered);
const wentSilent = baseAnswered.filter((b) => {
  const c = cand.get(b.endpoint);
  // Dropped from the target list entirely is a coverage question, handled
  // above; it is not evidence that the subject stopped answering.
  return c !== undefined && !answered(c);
});
const candAnswered = [...cand.values()].filter(answered).length;
const regression = baseAnswered.length === 0 ? 0 : wentSilent.length / baseAnswered.length;

console.log(`baseline : ${base.size} endpoints, ${baseAnswered.length} answering`);
console.log(`candidate: ${cand.size} endpoints, ${candAnswered} answering`);
console.log(`coverage : ${(coverage * 100).toFixed(1)}% of baseline endpoints present`);
console.log(
  `went silent: ${wentSilent.length} of ${baseAnswered.length} previously-answering ` +
    `(${(regression * 100).toFixed(1)}%, limit ${(MAX_REGRESSION * 100).toFixed(0)}%)`,
);

const problems: string[] = [];
if (coverage < MIN_COVERAGE) {
  problems.push(
    `the candidate covers only ${(coverage * 100).toFixed(1)}% of the baseline's endpoints ` +
      `(floor ${(MIN_COVERAGE * 100).toFixed(0)}%) — the sweep did not finish`,
  );
}
if (baseAnswered.length >= MIN_BASELINE && regression > MAX_REGRESSION) {
  problems.push(
    `${wentSilent.length} of ${baseAnswered.length} endpoints that answered last time returned ` +
      `nothing at all. Hundreds of unrelated operators do not fail in the same hour; this is far ` +
      `more likely our network, our egress, or a broken dependency than a population-wide outage`,
  );
}

if (problems.length > 0) {
  console.log("\nREFUSE to publish this run:");
  for (const p of problems) console.log(`  - ${p}`);
  console.log(
    "\nNothing has been merged. The transcripts are on disk for inspection. If the loss is real,\n" +
      "re-run with a higher --max-regression and the reason recorded in the run log.",
  );
  for (const b of wentSilent.slice(0, 10)) console.log(`    silent: ${b.endpoint}`);
  process.exit(1);
}

console.log("\nOK to publish.");
process.exit(0);
