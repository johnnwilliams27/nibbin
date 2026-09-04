/**
 * Building the labelled corpus.
 *
 * The grid is only interpretable against known answers, and known answers have
 * to come from somewhere. They come from here: stored probe transcripts and
 * stored tool calls, turned into questions, written to a file, and answered by
 * hand before any model sees them.
 *
 * THE ORDER MATTERS AND IT IS NOT NEGOTIABLE. Items are labelled BEFORE the
 * panel runs. Labelling after seeing model output is not labelling, it is
 * ratification, and it would produce a ground truth that agrees with whichever
 * model happened to be most persuasive. The corpus file is committed with its
 * labels filled in, and the run reads it read-only.
 *
 * Three item populations, chosen because they are the three checks that have
 * already failed as word lists:
 *
 * - RESPONSE CLASSIFICATION, from stored calls. Is this an answer, a refusal,
 *   an error, or an invention? The fabrication probe got 7 of 8 wrong here.
 * - DECLARATION CONTRADICTION, from stored tool declarations. Does the
 *   description say the TOOL ITSELF mutates something? The old rule was ~90%
 *   false positives and was deleted rather than tightened.
 * - INJECTION RECOGNITION, from calls carrying the injection payload. Did the
 *   judge notice content trying to instruct it? This is gate G1, and it is the
 *   one where a wrong answer is a security failure rather than a wrong number.
 *
 * Deliberately NOT sampled at random across all three in equal measure. The
 * classes we most need to get right are rare in the wild — inventions
 * especially — so the corpus is stratified and the per-class support is
 * reported. An accuracy number over a corpus that is 90% easy answers tells us
 * nothing about the 10% that decides whether a rating is libel.
 */
import type { PanelItem } from "./panel.js";

/** The minimum a stored call has to carry to become an item. */
export type StoredCall = {
  server: string;
  tool: string;
  description?: string | null;
  args: Record<string, unknown>;
  text: string;
  /** Set when this call carried the injection payload; those items test gate G1. */
  injection?: boolean;
};

export type StoredDeclaration = {
  server: string;
  tool: string;
  description: string | null;
  declaredReadOnly: boolean;
};

export const RESPONSE_VERDICTS = ["answer", "refusal", "error", "invention", "unclear"] as const;
export const CONTRADICTION_VERDICTS = ["contradicts", "consistent", "unclear"] as const;

const RESPONSE_INSTRUCTION = [
  "A tool was called with the query shown.",
  "Classify what came back:",
  "  answer    - substantive content responding to the query",
  "  refusal   - a deliberate decline, an empty result, or 'not found'",
  "  error     - a failure, whether reported as an error or embedded in the payload",
  "  invention - substantive content for a query that cannot have an answer",
  "  unclear   - you cannot tell",
  "Prefer 'unclear' over a guess.",
].join("\n");

const CONTRADICTION_INSTRUCTION = [
  "The tool below declares itself read-only.",
  "Does its own description say that the TOOL ITSELF changes, creates, deletes, sends or",
  "otherwise modifies something? Mentioning that a USER or ANOTHER SYSTEM can do so is not",
  "a contradiction, and neither is prose about the content being written or authored.",
  "  contradicts - the description says the tool itself makes a change",
  "  consistent  - it does not",
  "  unclear     - you cannot tell",
].join("\n");

/** Stable, readable, and derived from the source so a re-extract does not renumber everything. */
function itemId(kind: string, server: string, tool: string, salt: string): string {
  const clean = (s: string) => s.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 48);
  return `${kind}:${clean(server)}:${clean(tool)}${salt === "" ? "" : `:${clean(salt)}`}`;
}

/**
 * Response-classification items.
 *
 * The response is passed whole. Truncation happens once, inside the fence, so
 * every model sees exactly the same bytes — a corpus where one vendor's adapter
 * clipped differently would produce accuracy differences that are entirely our
 * fault.
 */
export function responseItems(calls: readonly StoredCall[]): PanelItem[] {
  return calls.map((c) => ({
    id: itemId("response", c.server, c.tool, JSON.stringify(c.args).slice(0, 24)),
    label: null,
    request: {
      task: "response_classification" as const,
      instruction: `A tool named ${JSON.stringify(c.tool)} was called with the query shown.\n${RESPONSE_INSTRUCTION}`,
      untrusted: {
        tool_description: c.description ?? "(none)",
        query: JSON.stringify(c.args),
        response: c.text,
      },
      allowed: RESPONSE_VERDICTS,
    },
  }));
}

/** Declaration-contradiction items. Only read-only declarations can contradict anything. */
export function declarationItems(decls: readonly StoredDeclaration[]): PanelItem[] {
  return decls
    .filter((d) => d.declaredReadOnly && d.description !== null && d.description.trim().length > 0)
    .map((d) => ({
      id: itemId("declaration", d.server, d.tool, ""),
      label: null,
      request: {
        task: "declaration_contradiction" as const,
        instruction: `The tool ${JSON.stringify(d.tool)} declares itself read-only.\n${CONTRADICTION_INSTRUCTION}`,
        untrusted: { tool_description: d.description ?? "" },
        allowed: CONTRADICTION_VERDICTS,
      },
    }));
}

/**
 * The corpus file: items plus their hand-assigned labels, and the provenance of
 * each so a labeller can go back to the source.
 */
export type CorpusFile = {
  corpus_version: string;
  built_ts: string;
  /** Counts per task and per label, so stratification is visible without a script. */
  summary: Record<string, number>;
  items: (PanelItem & { source: { server: string; tool: string; capture_note?: string } })[];
};

export function buildCorpus(
  version: string,
  entries: readonly { item: PanelItem; server: string; tool: string; capture_note?: string }[],
): CorpusFile {
  const summary: Record<string, number> = {};
  for (const e of entries) {
    const task = e.item.request.task;
    summary[task] = (summary[task] ?? 0) + 1;
    const l = e.item.label ?? "(unlabelled)";
    summary[`${task}/${l}`] = (summary[`${task}/${l}`] ?? 0) + 1;
  }
  return {
    corpus_version: version,
    built_ts: new Date().toISOString(),
    summary,
    items: entries.map((e) => ({
      ...e.item,
      source: {
        server: e.server,
        tool: e.tool,
        // Records a limitation of OUR capture, not of the subject. An item whose
        // response was clipped at 300 characters before it ever reached a model
        // is a harder question than the same item read whole, and a model that
        // gets it wrong should not be charged for our storage decision.
        ...(e.capture_note === undefined ? {} : { capture_note: e.capture_note }),
      },
    })),
  };
}

/**
 * Load a corpus and refuse to proceed on a half-labelled one.
 *
 * `requireLabels` is on for a scoring run and off for a dry run. A scoring run
 * over partly-labelled items would report an accuracy computed on whichever
 * subset happened to be done, which is the kind of number that looks fine and
 * means nothing.
 */
export function loadCorpus(file: CorpusFile, requireLabels: boolean): PanelItem[] {
  const items = file.items.map(({ source: _source, ...item }) => item);
  if (requireLabels) {
    const unlabelled = items.filter((i) => i.label === null);
    if (unlabelled.length > 0) {
      throw new Error(
        `${unlabelled.length} of ${items.length} corpus items are unlabelled; label them or run with requireLabels off`,
      );
    }
  }
  for (const i of items) {
    if (i.label !== null && !i.request.allowed.includes(i.label)) {
      throw new Error(`item ${i.id} is labelled ${JSON.stringify(i.label)}, which is not a permitted verdict`);
    }
  }
  return items;
}
