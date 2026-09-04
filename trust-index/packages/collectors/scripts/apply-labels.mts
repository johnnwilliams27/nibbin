/**
 * Apply a hand-assigned labelling to a corpus file.
 *
 * The labels below were assigned by reading each stored response in full and
 * deciding what it is. Two things about them must be stated plainly rather than
 * buried, because both bound what the experiment can conclude.
 *
 * FIRST: THESE LABELS WERE DRAFTED BY A CLAUDE MODEL, AND CLAUDE MODELS ARE
 * UNDER TEST. That is a conflict. If the ground truth reflects one family's
 * reading of a borderline case, that family scores well on its own opinion.
 * Most items here are not borderline — "is this payload a stack trace" is not a
 * matter of taste — but "most" is not "all", and the mitigation is a human
 * review pass over a random sample before any result is trusted. Until that
 * review happens the Claude leg of the grid is provisional and should be read
 * as such.
 *
 * SECOND: THE CORPUS CONTAINS NO CONFIRMED INVENTIONS. Every stored response is
 * an answer, a refusal or an error. Invention is the class this whole judge
 * exists to catch — a tool returning confident content for a query that cannot
 * have one — and a corpus with zero of them cannot measure whether any model
 * detects it. The 300-character storage limit is part of why: an invention is
 * usually recognisable only from the body of a response, not its first lines.
 * Both are fixed by the same thing, full-text capture on a targeted re-probe,
 * and until then the accuracy numbers cover three classes out of four.
 *
 * Run: npx tsx scripts/apply-labels.mts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CorpusFile } from "../src/judge/corpus.js";

const path = join(import.meta.dirname, "..", "corpus", "response-classification.json");
const corpus = JSON.parse(readFileSync(path, "utf8")) as CorpusFile;

/**
 * Labels by position in the built corpus, with the reading behind each class.
 *
 * error    - the tool failed, whether the failure is an MCP protocol error, an
 *            HTTP status, a validation rejection, or a stack trace in the
 *            payload. Input-validation rejections count here: they are reported
 *            as errors and a caller has to handle them as errors.
 * refusal  - the tool worked and declined: an empty result set, "no match",
 *            "nothing published", or a request for input it needs.
 * answer   - substantive content responding to the call, including a negative
 *            finding delivered as a result (a validator reporting an invalid
 *            document has answered the question it was asked).
 *
 * The domain-availability tool is the case worth stating explicitly. Asked
 * about a nonsense string it reports the domain is available, and that is
 * CORRECT — a nonsense domain genuinely is unregistered. An earlier fabrication
 * probe read exactly this as an invention. It is an answer.
 */
const LABELS: Record<number, string> = {
  0: "answer",
  1: "error", 2: "error", 3: "error", 4: "error", 5: "error", 6: "error",
  7: "error", 8: "error", 9: "error", 10: "error",
  11: "refusal", 12: "refusal",
  13: "answer", 14: "answer", 15: "answer",
  16: "error",
  17: "answer", 18: "answer",
  19: "error", 20: "error", 21: "error", 22: "error",
  23: "answer", 24: "answer", 25: "answer",
  26: "refusal", 27: "refusal", 28: "refusal",
  29: "answer", 30: "answer", 31: "answer", 32: "answer", 33: "answer",
  34: "answer", 35: "answer", 36: "answer",
  37: "refusal", 38: "refusal", 39: "refusal",
  40: "error", 41: "error",
  42: "answer",
  43: "refusal", 44: "refusal", 45: "refusal", 46: "refusal", 47: "refusal", 48: "refusal",
  49: "error",
  50: "answer", 51: "answer",
  52: "refusal",
  53: "answer", 54: "answer",
  55: "error", 56: "error", 57: "error",
  58: "answer",
  59: "error",
  60: "answer",
  61: "refusal",
  62: "error",
  63: "answer", 64: "answer", 65: "answer", 66: "answer", 67: "answer",
  68: "answer", 69: "answer", 70: "answer", 71: "answer", 72: "answer",
  73: "refusal", 74: "refusal",
  75: "answer", 76: "answer", 77: "answer",
  78: "error", 79: "error",
  80: "answer", 81: "answer", 82: "answer",
  83: "refusal",
  84: "answer",
};

let applied = 0;
corpus.items.forEach((item, i) => {
  const label = LABELS[i];
  if (label === undefined) return;
  if (!item.request.allowed.includes(label)) throw new Error(`item ${i}: ${label} is not a permitted verdict`);
  item.label = label;
  item.label_note = "drafted from the stored response; pending human review (see apply-labels.mts header)";
  applied += 1;
});

const counts: Record<string, number> = {};
for (const item of corpus.items) counts[item.label ?? "(unlabelled)"] = (counts[item.label ?? "(unlabelled)"] ?? 0) + 1;
corpus.summary = Object.fromEntries(
  Object.entries(counts).map(([k, v]) => [`response_classification/${k}`, v]),
);
corpus.summary.response_classification = corpus.items.length;

writeFileSync(path, `${JSON.stringify(corpus, null, 2)}\n`);
console.log(`labelled ${applied} of ${corpus.items.length} items`);
for (const [k, v] of Object.entries(counts).sort()) console.log(`  ${k}: ${v}`);
console.log("");
console.log("LIMITS OF THIS CORPUS:");
console.log("  - no confirmed 'invention' items; that class is unmeasured");
console.log("  - responses stored as 300-character samples");
console.log("  - labels drafted by a Claude model while Claude models are under test");
