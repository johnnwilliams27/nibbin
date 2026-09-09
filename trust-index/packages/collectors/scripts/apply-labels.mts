/**
 * Apply a hand-assigned labelling to the response corpus.
 *
 * Assigned by reading each stored response — WHOLE, this time — and deciding
 * what the tool did, under the tightened rubric in corpus.ts. The single
 * question is: did the tool run and reach a considered position, or did it
 * break?
 *
 * THE CONFLICT, RESTATED BECAUSE IT HAS NOT GONE AWAY. These labels were
 * drafted by a Claude model and Claude models are under test. Most items are
 * not close calls — an asyncpg stack trace in a payload is not a matter of
 * taste — but "most" is not "all". The mitigation is a human review pass over a
 * random sample, and until it happens the Claude leg is provisional.
 *
 * WHAT CHANGED FROM THE FIRST LABELLING, and why every label was reassigned
 * rather than carried forward:
 *
 * 1. The responses are whole now. The first corpus stored 300-character
 *    excerpts, and 45% of the clipped items were scored wrong against 13% of
 *    the whole ones. Labels assigned on fragments were labels about fragments.
 * 2. The rubric moved. "I need more input" is now a refusal and "your input was
 *    invalid" an error, a boundary the old wording left undecidable and five
 *    disagreements landed on. Carrying old labels forward would re-import the
 *    ambiguity the rewrite removed.
 *
 * THE HARD CASES, recorded so a reviewer can disagree with the reasoning rather
 * than just the answer:
 *
 * - #37 ephemeris returns {"error": "provide a location..."}. Keyed as an
 *   error, but it is a request for missing input, so: refusal. The rubric turns
 *   on what the tool did, not on which key it used.
 * - #84 parse_dmarc_report returns "IntoDNS.ai API error: 400 Bad Request -
 *   Provide an XML report". Also asks for input, but an upstream HTTP 400 means
 *   the call did not complete: error.
 * - #105, #109 need a credential or configuration they were not given. The tool
 *   could not do the work: error, not refusal.
 * - #113 describe_metric returns {"error": "unknown_metric"}. That is a
 *   not-found, which is a refusal, whatever the key is called.
 * - #86 advisors_store_readiness_check returns ok:false, "target_rejected". It
 *   ran and declined the target: refusal.
 * - #67, #93, #99 return negative findings as results — invalid document,
 *   insufficient evidence. A validator reporting a failure has answered.
 * - #45 check_availability reports a nonsense domain is available, which is
 *   TRUE and therefore an answer. An earlier fabrication probe called this
 *   class an invention seven times out of eight.
 *
 * Run: npx tsx scripts/apply-labels.mts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CorpusFile } from "../src/judge/corpus.js";

const path = join(import.meta.dirname, "..", "corpus", "response-classification.json");
const corpus = JSON.parse(readFileSync(path, "utf8")) as CorpusFile;

const ERROR = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 15, 18, 19, 20, 21, 25, 26, 27, 28, 32, 52, 53, 61, 73, 78, 80, 81,
  82, 84, 87, 104, 105, 108, 109, 112, 115,
];
const REFUSAL = [
  10, 11, 29, 30, 31, 34, 35, 36, 37, 38, 39, 40, 49, 50, 51, 55, 56, 57, 58, 59, 60, 68, 70, 71, 72,
  74, 75, 76, 77, 86, 97, 98, 102, 103, 113, 114, 117,
];

const LABELS: Record<number, string> = {};
for (const i of ERROR) LABELS[i] = "error";
for (const i of REFUSAL) LABELS[i] = "refusal";
// Everything else ran and produced substantive content, including negative
// findings delivered as results.
for (let i = 0; i < corpus.items.length; i += 1) LABELS[i] ??= "answer";

let applied = 0;
corpus.items.forEach((item, i) => {
  const label = LABELS[i];
  if (label === undefined) return;
  if (!item.request.allowed.includes(label)) throw new Error(`item ${i}: ${label} is not a permitted verdict`);
  item.label = label;
  item.label_note = "drafted from the whole stored response under the tightened rubric; pending human review";
  applied += 1;
});

const counts: Record<string, number> = {};
for (const item of corpus.items) counts[item.label ?? "(unlabelled)"] = (counts[item.label ?? "(unlabelled)"] ?? 0) + 1;
corpus.summary = Object.fromEntries(Object.entries(counts).map(([k, v]) => [`response_classification/${k}`, v]));
corpus.summary.response_classification = corpus.items.length;

writeFileSync(path, `${JSON.stringify(corpus, null, 2)}\n`);
console.log(`labelled ${applied} of ${corpus.items.length} items`);
for (const [k, v] of Object.entries(counts).sort()) console.log(`  ${k}: ${v}`);
console.log("");
console.log("REMAINING LIMITS:");
console.log("  - still no confirmed 'invention' items; that class stays unmeasured");
console.log("  - labels drafted by a Claude model while Claude models are under test");
