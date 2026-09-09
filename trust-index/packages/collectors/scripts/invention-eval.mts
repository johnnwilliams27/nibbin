/**
 * Measure the one class the corpus could not: invention.
 *
 * The fabrication hunt probed 117 retrieval tools with a string that cannot
 * exist in any corpus and flagged 32 as returning a substantive answer. Reading
 * all 32 by hand, most are honest — an empty result set that happens to be long
 * and structured, an error object, a rate limit, or a correct answer about a
 * name that genuinely is unregistered. SIX are real.
 *
 * That ratio is itself the finding worth keeping: a structural heuristic
 * ("substantive, not refused, not an error") over-flagged by better than five
 * to one. It is the same failure that killed the word-list contradiction rule
 * and the original fabrication probe, and it is exactly the wall where a judge
 * has to take over from a pattern.
 *
 * WHAT COUNTS AS INVENTION HERE, and the calls that were close:
 *
 *   INVENTION — confident content for a query that cannot have an answer:
 *     get_skill              returned a live market-data skill for a skill name
 *                            that does not exist, as though it were the answer
 *     search_products        Uniqlo listings for gibberish
 *     search_cerebrium       real documentation pages for gibberish
 *     search_law_articles    "5 related articles" with semantic-match prose
 *     search_web_pages       an FCC lookup page for gibberish
 *     public_search_news     Bitcoin news for gibberish
 *
 *   NOT INVENTION, though the heuristic flagged them:
 *     check_availability     a nonsense name IS unregistered; that is correct
 *     search_ens_names       same, for ENS
 *     agentra_get_wallet     demo data, explicitly labelled "demo": true with a
 *                            note saying so. Disclosed, therefore not deceptive
 *     search_docs            returns near-matches while stating plainly "no
 *                            confident match — do not fabricate an answer".
 *                            Transparency, not fabrication
 *     duvera__..._search     count 0, results [] inside an approval envelope
 *     get_merchant           an unknown_merchant error object
 *     web_search_exa         a rate limit, which is ours
 *
 * Run: npx tsx scripts/invention-eval.mts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { classifyResponse } from "../src/judge/index.js";
import { judgeFromEnv, PRODUCTION_JUDGE_MODEL } from "../src/judge/production.js";

const ROOT = join(import.meta.dirname, "..");

/** Hand-assigned, by reading every candidate in full. Indices into `suspicious`. */
const INVENTION = new Set([1, 6, 11, 21, 23, 26]);
/** Genuinely undecidable from the stored response; excluded rather than guessed. */
const EXCLUDE = new Set([31]);

type Row = { server: string; tool: string; args: Record<string, unknown>; result: { text?: string; textSample?: string } };
const file = JSON.parse(readFileSync(join(ROOT, "fabrication-candidates.json"), "utf8")) as { suspicious: Row[] };

const judge = judgeFromEnv();
if (judge === null) {
  console.error("ANTHROPIC_API_KEY is not set; nothing to measure.");
  process.exit(1);
}

type Scored = { i: number; tool: string; expected: string; got: string; reason: string };
const scored: Scored[] = [];

for (const [i, row] of file.suspicious.entries()) {
  if (EXCLUDE.has(i)) continue;
  const text = row.result.text ?? row.result.textSample ?? "";
  if (text.length === 0) continue;
  const expected = INVENTION.has(i) ? "invention" : "not_invention";
  try {
    const v = await classifyResponse(
      {
        tool: row.tool,
        description: null,
        query: JSON.stringify(row.args),
        response: text,
        // These rows are read from stored transcripts, where `text` is the
        // whole captured response. Nothing here is re-truncated.
        truncated: false,
      },
      judge,
    );
    scored.push({ i, tool: row.tool, expected, got: v.verdict, reason: v.reason });
  } catch (err) {
    console.log(`  #${i} ${row.tool}: judge failed — ${err instanceof Error ? err.message.slice(0, 90) : "?"}`);
  }
  await new Promise((r) => setTimeout(r, 200));
}

// Recall is what matters here: a missed invention is a fabricating tool rated
// as if it answered. A false positive is an accusation, which is worse per
// instance but easier to see, so both are reported rather than combined.
const inventions = scored.filter((s) => s.expected === "invention");
const others = scored.filter((s) => s.expected !== "invention");
const caught = inventions.filter((s) => s.got === "invention");
const falseAccusations = others.filter((s) => s.got === "invention");

console.log(`judge: ${PRODUCTION_JUDGE_MODEL}`);
console.log(`scored: ${scored.length} candidates (${inventions.length} real inventions, ${others.length} not)\n`);

console.log("REAL INVENTIONS — did the judge catch them?");
for (const s of inventions) {
  console.log(`  ${s.got === "invention" ? "CAUGHT " : "MISSED "} ${s.tool.padEnd(28)} said "${s.got}" — ${s.reason.slice(0, 90)}`);
}
console.log("");
console.log("HONEST RESPONSES — did the judge accuse any of them?");
for (const s of falseAccusations) {
  console.log(`  ACCUSED ${s.tool.padEnd(28)} — ${s.reason.slice(0, 90)}`);
}
if (falseAccusations.length === 0) console.log("  none");

console.log("");
console.log(`invention recall:        ${caught.length}/${inventions.length}`);
console.log(`false accusations:       ${falseAccusations.length}/${others.length}`);
console.log("");
console.log("for comparison, the structural heuristic that produced these candidates:");
console.log(`  flagged ${file.suspicious.length}, of which ${INVENTION.size} were real — ${(((file.suspicious.length - INVENTION.size) / file.suspicious.length) * 100).toFixed(0)}% false positive`);
