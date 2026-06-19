/**
 * `--write` wiring: for cleared (task → challenger) pairs from a REAL run,
 * populate `DEFAULT_TASK_CANDIDATES[task] = [incumbent, challenger]` in
 * packages/router/src/tiers.ts — incumbent FIRST (the safe default / guaranteed
 * fallback; reinforcement only shifts AMONG the set). This is what arms
 * reinforcement for a task.
 *
 * `armCandidatesSource` is a PURE string transform (testable, dry-run-able) that
 * rewrites the DEFAULT_TASK_CANDIDATES object literal. `applyClearedPairs` is the
 * filesystem wrapper the CLI calls.
 *
 * IMPORTANT: this is an ACTIVATION step. It is NOT run in the harness PR — the
 * empty candidate set ships unchanged so the `route-unchanged` invariant stays
 * green. A populated set is a follow-up PR carrying a real run's report as
 * evidence. The mechanism + its dry-run test are the deliverable here.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EvalRun } from './types';

/**
 * task → [incumbent, ...clearedChallengers] for the run. A task may be
 * challenged by MORE THAN ONE candidate (e.g. complex_plan carries both a
 * cheaper Haiku cost-challenger AND an Opus quality-challenger); if several
 * clear, they GROUP into ONE ordered set — incumbent first, then each cleared
 * challenger in matrix order — never duplicate object keys. Reinforcement then
 * picks cheapest-within-quality among the whole set.
 */
export function clearedEntries(run: EvalRun): Array<[string, string[]]> {
  const byTask = new Map<string, string[]>();
  for (const p of run.pairs) {
    if (!p.cleared) continue;
    // First cleared pair for the task seeds the set with the incumbent (the
    // safe default / guaranteed fallback). All pairs for a task share an
    // incumbent; subsequent pairs only append their challenger.
    const set = byTask.get(p.task) ?? [p.incumbent.model];
    if (!set.includes(p.challenger.model)) set.push(p.challenger.model);
    byTask.set(p.task, set);
  }
  return [...byTask.entries()];
}

/** The generated body lines for the DEFAULT_TASK_CANDIDATES object. */
function renderEntries(entries: Array<[string, string[]]>): string {
  if (entries.length === 0) {
    return [
      '  // Intentionally empty — every task resolves to its single configured model',
      '  // until the team adds an eval-cleared second candidate. This pins zero',
      '  // behavior change at ship: see the route-unchanged test.',
    ].join('\n');
  }
  return entries
    .map(([task, models]) =>
      `  // Eval-cleared ${new Date().toISOString().slice(0, 10)} — see docs/eval/routing-*.md\n` +
      `  ${task}: [${models.map((m) => `'${m}'`).join(', ')}],`,
    )
    .join('\n');
}

/**
 * Rewrite the DEFAULT_TASK_CANDIDATES object literal in tiers.ts source.
 * Pure: takes the current file text + cleared entries, returns the new text.
 * Throws if the marker block can't be located (fail-loud, never a silent no-op).
 */
export function armCandidatesSource(
  source: string,
  entries: Array<[string, string[]]>,
): string {
  const marker = 'export const DEFAULT_TASK_CANDIDATES';
  const declStart = source.indexOf(marker);
  if (declStart === -1) {
    throw new Error('arm: could not find DEFAULT_TASK_CANDIDATES declaration in tiers.ts');
  }
  const open = source.indexOf('{', declStart);
  if (open === -1) throw new Error('arm: malformed DEFAULT_TASK_CANDIDATES (no opening brace)');
  // Find the matching close brace for the object literal.
  let depth = 0;
  let close = -1;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close === -1) throw new Error('arm: malformed DEFAULT_TASK_CANDIDATES (unbalanced braces)');

  const before = source.slice(0, open + 1);
  const after = source.slice(close);
  return `${before}\n${renderEntries(entries)}\n${after}`;
}

const TIERS_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'src',
  'tiers.ts',
);

export interface WriteResult {
  /** Tasks whose candidate set was armed. */
  edited: string[];
  /** The new tiers.ts source (returned so a dry run can inspect without writing). */
  source: string;
}

/**
 * Apply cleared pairs to tiers.ts. With `dryRun: true` (the default in tests),
 * it computes the new source WITHOUT writing — the testable, side-effect-free
 * deliverable. The CLI calls it with `dryRun: false` after a real run.
 */
export async function applyClearedPairs(
  run: EvalRun,
  opts: { dryRun?: boolean } = {},
): Promise<WriteResult> {
  const entries = clearedEntries(run);
  const current = await readFile(TIERS_PATH, 'utf8');
  const next = armCandidatesSource(current, entries);
  if (!opts.dryRun) await writeFile(TIERS_PATH, next, 'utf8');
  return { edited: entries.map(([task]) => task), source: next };
}
