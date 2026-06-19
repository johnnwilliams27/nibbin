/**
 * Report writer — emits human-readable evidence for an eval run:
 *  - docs/eval/routing-<date>.md  (per-pair scores, clearance + reason, cost delta)
 *  - docs/eval/routing-<date>.json (the structured EvalRun for tooling / the --write step)
 *
 * `renderMarkdown` is pure (no I/O) so it is unit-testable; `writeReport` does
 * the filesystem write. The docs path is resolved relative to THIS file so it
 * lands at the monorepo root's docs/eval regardless of cwd.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JUDGE_MODEL, JUDGE_PROMPT_VERSION } from './judge';
import type { EvalRun, PairResult } from './types';

/** Micro-USD → a short $ string. */
function usd(microUsd: number): string {
  return `$${(microUsd / 1_000_000).toFixed(6)}`;
}

function pairSection(p: PairResult): string {
  const lines: string[] = [];
  lines.push(`### ${p.task} (${p.tier}) — ${p.kind} challenge`);
  lines.push('');
  lines.push(`- Rubric: \`${p.rubricVersion}\``);
  lines.push(`- Incumbent \`${p.incumbent.model}\`: **${p.incumbent.aggregate.toFixed(3)}** (avg cost ${usd(p.incumbent.avgCostMicroUsd)}/call)`);
  lines.push(`- Challenger \`${p.challenger.model}\`: **${p.challenger.aggregate.toFixed(3)}** (avg cost ${usd(p.challenger.avgCostMicroUsd)}/call)`);
  const deltaSign = p.costDeltaMicroUsd <= 0 ? '' : '+';
  lines.push(`- Est. cost delta (challenger − incumbent): ${deltaSign}${usd(p.costDeltaMicroUsd)}/call`);
  lines.push(`- **Cleared: ${p.cleared ? 'YES' : 'no'}** — ${p.reason}`);
  lines.push('');
  lines.push('| fixture | incumbent | challenger |');
  lines.push('| --- | --- | --- |');
  for (let i = 0; i < p.incumbent.scores.length; i++) {
    const inc = p.incumbent.scores[i];
    const ch = p.challenger.scores[i];
    lines.push(`| ${inc.fixtureId} | ${inc.score.toFixed(2)} | ${ch ? ch.score.toFixed(2) : '—'} |`);
  }
  lines.push('');
  return lines.join('\n');
}

export function renderMarkdown(run: EvalRun): string {
  const cleared = run.pairs.filter((p) => p.cleared);
  const head: string[] = [];
  head.push(`# Routing eval — ${run.date}`);
  head.push('');
  head.push(run.mock
    ? '> **MOCK RUN** — deterministic canned outputs + seeded judge. NOT a quality signal; for harness/CI verification only. A real clearance requires a run with `ANTHROPIC_API_KEY` set.'
    : `> Real run. Judge: \`${JUDGE_MODEL}\` (${JUDGE_PROMPT_VERSION}). Quality tolerance: ${run.qualityTolerance}.`);
  head.push('');
  head.push('How to reproduce: `npm run eval:routing -- --mock` (free) or `ANTHROPIC_API_KEY=… npm run eval:routing` (real, spends). Clearance is computed from judge scores — never hardcoded.');
  head.push('');
  head.push('## Clearance rule');
  head.push('');
  head.push(`- A **cost** challenger (cheaper) clears when its aggregate is within \`qualityTolerance\` (${run.qualityTolerance}) of, or above, the incumbent.`);
  head.push('- A **quality** challenger clears only when its aggregate is ≥ the incumbent.');
  head.push('');
  head.push('## Summary');
  head.push('');
  head.push(`Cleared ${cleared.length} of ${run.pairs.length} pair(s).`);
  if (cleared.length > 0) {
    head.push('');
    for (const p of cleared) {
      head.push(`- \`${p.task}\` → arm \`[${p.incumbent.model}, ${p.challenger.model}]\` (incumbent first).`);
    }
  }
  head.push('');
  head.push('## Pairs');
  head.push('');
  const body = run.pairs.map(pairSection).join('\n');
  return `${head.join('\n')}\n${body}`;
}

/** Resolve <repo-root>/docs/eval — this file is at packages/router/eval/report.ts. */
function docsEvalDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', '..', '..', 'docs', 'eval');
}

export interface WrittenReport {
  mdPath: string;
  jsonPath: string;
}

export async function writeReport(run: EvalRun): Promise<WrittenReport> {
  const dir = docsEvalDir();
  await mkdir(dir, { recursive: true });
  const mdPath = resolve(dir, `routing-${run.date}.md`);
  const jsonPath = resolve(dir, `routing-${run.date}.json`);
  await writeFile(mdPath, renderMarkdown(run), 'utf8');
  await writeFile(jsonPath, `${JSON.stringify(run, null, 2)}\n`, 'utf8');
  return { mdPath, jsonPath };
}
