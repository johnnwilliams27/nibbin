/**
 * Extract a labelling corpus from what we already stored.
 *
 * Reads the 600 persisted probe transcripts and the stored tool calls, turns
 * them into questions, and writes them out unlabelled for a human to answer.
 * No network, no models, no cost.
 *
 * Run:  npx tsx scripts/build-corpus.mts
 * Then: fill in every "label" field in corpus/judge-corpus.json BY HAND, before
 *       any model sees the file. Labelling after seeing model output is not
 *       labelling, it is ratification.
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  buildCorpus,
  declarationItems,
  responseItems,
  type CorpusFile,
  type StoredCall,
  type StoredDeclaration,
} from "../src/judge/corpus.js";

const ROOT = join(import.meta.dirname, "..");
const OUT_DIR = join(ROOT, "corpus");
const CORPUS_VERSION = "corpus.v1";

type Transcript = {
  registry?: { name?: string };
  tools?: {
    ok?: boolean;
    // The field is `declared`. An earlier version of this script read `tools`,
    // found nothing in 600 files, and printed "0 declarations" as though that
    // were a fact about the world. Same failure as the registry parser that
    // read 40,000 rows as an empty registry.
    declared?: { name: string; description: string | null; annotations?: { readOnlyHint?: boolean } | null }[];
  } | null;
};

type BatteryFile = {
  tool: string;
  calls?: { label: string; args: Record<string, unknown>; result?: { textSample?: string; server?: string } }[];
}[];

type CallFile = {
  tool: string;
  server: string;
  args: Record<string, unknown>;
  textSample?: string;
}[];

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

// ---- declarations, from the transcript corpus --------------------------------
const declarations: StoredDeclaration[] = [];
const transcriptDir = join(ROOT, "transcripts");
let transcriptsWithTools = 0;
for (const file of readdirSync(transcriptDir)) {
  const t = readJson<Transcript>(join(transcriptDir, file));
  if (t?.tools?.ok !== true) continue;
  transcriptsWithTools += 1;
  const server = t.registry?.name ?? file.replace(/\.json$/, "");
  for (const tool of t.tools.declared ?? []) {
    declarations.push({
      server,
      tool: tool.name,
      description: tool.description,
      declaredReadOnly: tool.annotations?.readOnlyHint === true,
    });
  }
}

// A successful tools/list that yields no declarations is a parsing failure, not
// a server with no tools. Abort rather than print a corpus we did not read.
if (transcriptsWithTools > 0 && declarations.length === 0) {
  throw new Error(
    `${transcriptsWithTools} transcripts reported a successful tools/list and yielded 0 declarations; the parser is reading the wrong field`,
  );
}

// ---- responses, from stored calls -------------------------------------------
const calls: StoredCall[] = [];
const battery = readJson<BatteryFile>(join(ROOT, "assessment.json")) ?? [];
for (const entry of battery) {
  for (const c of entry.calls ?? []) {
    const text = c.result?.textSample;
    if (typeof text !== "string" || text.length === 0) continue;
    calls.push({ server: c.result?.server ?? "(unknown)", tool: entry.tool, args: c.args, text });
  }
}
const direct = readJson<CallFile>(join(ROOT, "tool-calls.json")) ?? [];
for (const c of direct) {
  if (typeof c.textSample !== "string" || c.textSample.length === 0) continue;
  calls.push({ server: c.server, tool: c.tool, args: c.args, text: c.textSample });
}

// The two call files record the same run from different angles, so most calls
// appear twice — and the battery file does not carry the server name, so the
// two copies get different ids and survive an id-based dedupe. Identity here is
// the call itself: same tool, same arguments, same bytes back.
const seenCall = new Set<string>();
const uniqueCalls = calls.filter((c) => {
  const key = `${c.tool}|${JSON.stringify(c.args)}|${c.text}`;
  if (seenCall.has(key)) return false;
  seenCall.add(key);
  return true;
});
// Prefer the copy that knows which server it came from.
for (const c of uniqueCalls) {
  if (c.server !== "(unknown)") continue;
  const named = calls.find(
    (o) => o.server !== "(unknown)" && o.tool === c.tool && JSON.stringify(o.args) === JSON.stringify(c.args),
  );
  if (named !== undefined) c.server = named.server;
}

// ---- stratify ----------------------------------------------------------------
//
// Not a uniform sample. The classes that decide whether a rating is libel —
// inventions, and refusals mistaken for content — are rare in the wild, so an
// accuracy number over a corpus that is nine-tenths easy answers would tell us
// nothing about the tenth that matters. Declarations are capped so responses do
// not get swamped: the response task is where three implementations have
// already failed.
const DECLARATION_CAP = 120;
const seenDecl = new Set<string>();
const pickedDeclarations = declarations
  .filter((d) => d.declaredReadOnly && (d.description?.trim().length ?? 0) > 0)
  .filter((d) => {
    const k = `${d.server}:${d.tool}`;
    if (seenDecl.has(k)) return false;
    seenDecl.add(k);
    return true;
  })
  .slice(0, DECLARATION_CAP);

const entries = [
  ...responseItems(uniqueCalls).map((item, i) => ({
    item,
    server: uniqueCalls[i]!.server,
    tool: uniqueCalls[i]!.tool,
    capture_note: "response stored as a 300-character sample; the model sees only that",
  })),
  ...declarationItems(pickedDeclarations).map((item) => {
    const src = pickedDeclarations.find((d) => item.id.includes(d.tool.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 48)));
    return { item, server: src?.server ?? "(unknown)", tool: src?.tool ?? "(unknown)" };
  }),
];

// The battery file and the direct-call file overlap, so the same tool+args pair
// appears twice and produces the same id. Left in, the metrics would key both
// on one id and quietly count that item twice — inflating whichever class
// happened to be duplicated. Dedupe on id, keeping the first.
const seenId = new Set<string>();
const unique = entries.filter((e) => {
  if (seenId.has(e.item.id)) return false;
  seenId.add(e.item.id);
  return true;
});
const duplicatesDropped = entries.length - unique.length;

// Written as two files, one per task. A run must be fully labelled to be
// scored, and the two tasks will not finish labelling at the same time; one
// file would mean the finished half waits on the unfinished one.
mkdirSync(OUT_DIR, { recursive: true });
const written: string[] = [];
for (const task of ["response_classification", "declaration_contradiction"] as const) {
  const subset = unique.filter((e) => e.item.request.task === task);
  if (subset.length === 0) continue;
  const corpus = buildCorpus(CORPUS_VERSION, subset);
  const path = join(OUT_DIR, `${task.replace(/_/g, "-")}.json`);
  // Never clobber labels already assigned by hand. Existing labels are carried
  // forward by id; only genuinely new items arrive unlabelled.
  const existing = readJson<CorpusFile>(path);
  if (existing !== null) {
    const byId = new Map(existing.items.map((i) => [i.id, i.label]));
    let carried = 0;
    for (const item of corpus.items) {
      const prior = byId.get(item.id);
      if (prior !== undefined && prior !== null) {
        item.label = prior;
        carried += 1;
      }
    }
    console.log(`  carried ${carried} existing labels into ${task}`);
  }
  writeFileSync(path, `${JSON.stringify(corpus, null, 2)}\n`);
  written.push(`${corpus.items.length} -> ${path}`);
}

const corpus = buildCorpus(CORPUS_VERSION, unique);
for (const w of written) console.log(`wrote ${w}`);
console.log(`  transcripts read:      ${readdirSync(transcriptDir).length}`);
console.log(`  declarations found:    ${declarations.length} (${pickedDeclarations.length} read-only with prose, capped at ${DECLARATION_CAP})`);
console.log(`  stored calls found:    ${calls.length}`);
console.log(`  duplicate ids dropped: ${duplicatesDropped}`);
console.log("");
console.log("summary:");
for (const [k, v] of Object.entries(corpus.summary).sort()) console.log(`  ${k}: ${v}`);
console.log("");
console.log("NEXT: label every item by hand before running the panel.");
