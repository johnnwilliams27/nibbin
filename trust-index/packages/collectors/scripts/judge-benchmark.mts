/**
 * Re-earn the judge headline on the configuration we actually run.
 *
 * WHY THIS EXISTS. `PRODUCTION_JUDGE_EVIDENCE.coverage_adjusted_accuracy` is
 * 0.892, measured over 120 labelled items. That number was scored on WHOLE
 * responses while the production call site was passing the judge a
 * 300-character slice with no truncation marker — the configuration measured at
 * 45% error against 13% on whole ones. The number therefore described a system
 * we were not running. The call site is fixed and the prompt has since changed
 * again (`truncated` is now a required field in the untrusted block), so the
 * headline has to be re-measured rather than assumed to have survived.
 *
 * WHAT IT DOES NOT DO. This does not re-run the seven-structure comparison.
 * That decision — one model, no panel — rested on the voting panel abstaining
 * on 19 of 120 items, which is a property of majority rule and not of any
 * prompt. This measures the single production judge against the same labels, so
 * the headline describes the running system.
 *
 * THE LABELS ARE THE KNOWN WEAKNESS. They were drafted by a Claude model while
 * Claude models were under test, and no human has reviewed a sample. Every
 * item's `label_note` says so. `scripts/label-sensitivity.mts` bounds the
 * exposure; this script does not improve it and must not be read as if it does.
 *
 * Usage:
 *   npx tsx scripts/judge-benchmark.mts --i-have-approval [--limit 120]
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { classifyResponse, type ResponseVerdict } from "../src/judge/index.js";
import { judgeFromEnv, PRODUCTION_JUDGE_MODEL } from "../src/judge/production.js";

const arg = (n: string, d: string): string => {
  const i = process.argv.indexOf(n);
  return i === -1 ? d : (process.argv[i + 1] ?? d);
};
if (!process.argv.includes("--i-have-approval")) {
  console.log("This spends API credit (one call per corpus item). Re-run with --i-have-approval.");
  process.exit(0);
}

const judge = judgeFromEnv();
if (judge === null) {
  console.log("ANTHROPIC_API_KEY is not set — no judge, nothing to measure.");
  process.exit(1);
}

type Item = {
  id: string;
  label: ResponseVerdict | null;
  request: { instruction: string; untrusted: { tool_description: string; query: string; response: string } };
  source: { server: string; tool: string };
};
const corpus = JSON.parse(readFileSync(arg("--corpus", "corpus/response-classification.json"), "utf8")) as {
  corpus_version: string;
  items: Item[];
};
const items = corpus.items.filter((i) => i.label !== null).slice(0, Number(arg("--limit", "1000")));
console.log(`model:   ${PRODUCTION_JUDGE_MODEL}`);
console.log(`corpus:  ${corpus.corpus_version}, ${items.length} labelled items\n`);

type Scored = { id: string; expected: ResponseVerdict; got: ResponseVerdict | null; reason: string; harness: boolean };
const scored: Scored[] = [];

for (const [n, item] of items.entries()) {
  const u = item.request.untrusted;
  // Rebuilt through classifyResponse rather than replaying the stored request,
  // because the point is to measure the CURRENT prompt. These are whole stored
  // responses, so nothing here is truncated.
  try {
    const v = await classifyResponse(
      {
        tool: item.source.tool,
        description: u.tool_description === "(none)" ? null : u.tool_description,
        query: u.query,
        response: u.response,
        truncated: false,
      },
      judge,
    );
    scored.push({ id: item.id, expected: item.label as ResponseVerdict, got: v.verdict, reason: v.reason, harness: false });
  } catch (err) {
    // A rate limit or a provider refusal is OUR failure to obtain a verdict, not
    // the model getting the item wrong. It leaves the denominator entirely —
    // scoring it as a miss is how a previous run reported a model's rate limit
    // as its capability.
    const detail = err instanceof Error ? err.message.slice(0, 120) : "judge threw";
    scored.push({ id: item.id, expected: item.label as ResponseVerdict, got: null, reason: detail, harness: true });
  }
  if ((n + 1) % 20 === 0) console.log(`  ${n + 1}/${items.length}`);
  await new Promise((r) => setTimeout(r, 250));
}

const harnessBlocked = scored.filter((s) => s.harness);
const answered = scored.filter((s) => !s.harness);
const correct = answered.filter((s) => s.got === s.expected);
const abstained = answered.filter((s) => s.got === "unclear" && s.expected !== "unclear");
const wrong = answered.filter((s) => s.got !== s.expected && s.got !== "unclear");

/** Wilson score interval: honest at this n, unlike a normal approximation. */
function wilson(k: number, n: number): [number, number] {
  if (n === 0) return [0, 0];
  const z = 1.96;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const s = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (c - s) / d), Math.min(1, (c + s) / d)];
}

const covAcc = answered.length === 0 ? 0 : correct.length / answered.length;
const [lo, hi] = wilson(correct.length, answered.length);

console.log("\nCOVERAGE-ADJUSTED ACCURACY — an abstention counts as a miss,");
console.log("because a judge that declines the hard questions is not accurate, it is quiet.\n");
console.log(`  items scored:       ${answered.length}`);
console.log(`  correct:            ${correct.length}`);
console.log(`  wrong:              ${wrong.length}`);
console.log(`  abstained:          ${abstained.length}`);
console.log(`  harness-blocked:    ${harnessBlocked.length}  (left the denominator)`);
console.log(`  cov_accuracy:       ${covAcc.toFixed(3)}  [${lo.toFixed(3)}, ${hi.toFixed(3)}]`);

const byLabel = new Map<string, { n: number; ok: number }>();
for (const s of answered) {
  const e = byLabel.get(s.expected) ?? { n: 0, ok: 0 };
  e.n += 1;
  if (s.got === s.expected) e.ok += 1;
  byLabel.set(s.expected, e);
}
console.log("\nby label:");
for (const [label, { n, ok }] of [...byLabel].sort()) {
  console.log(`  ${label.padEnd(10)} ${ok}/${n}`);
}

const confusion = new Map<string, number>();
for (const s of wrong) confusion.set(`${s.expected} -> ${s.got}`, (confusion.get(`${s.expected} -> ${s.got}`) ?? 0) + 1);
if (confusion.size > 0) {
  console.log("\nwhere it goes wrong:");
  for (const [k, v] of [...confusion].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(3)}  ${k}`);
}

mkdirSync("runs", { recursive: true });
const out = `runs/judge-benchmark-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
writeFileSync(
  out,
  JSON.stringify(
    {
      model: PRODUCTION_JUDGE_MODEL,
      corpus_version: corpus.corpus_version,
      measured_on: "whole responses, current prompt, truncated flag present",
      items_scored: answered.length,
      correct: correct.length,
      wrong: wrong.length,
      abstained: abstained.length,
      harness_blocked: harnessBlocked.length,
      coverage_adjusted_accuracy: Number(covAcc.toFixed(4)),
      ci95: [Number(lo.toFixed(4)), Number(hi.toFixed(4))],
      label_caveat: "labels drafted by a Claude model while Claude models were under test; no human sample reviewed",
      scored,
    },
    null,
    2,
  ),
);
console.log(`\nwritten to ${out}`);
