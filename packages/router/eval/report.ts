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

/** A model's avg cost, or "N/A" when no pricing is pinned (e.g. Fable). */
function avgCostLabel(m: PairResult['incumbent']): string {
  return m.costKnown ? `${usd(m.avgCostMicroUsd)}/call` : 'N/A (no pinned price)';
}

/** Render the per-fixture score cell, including the raw samples when present. */
function scoreCell(s: PairResult['incumbent']['scores'][number] | undefined): string {
  if (!s) return '—';
  const base = s.score.toFixed(2);
  // Variance visibility: show the raw samples when multi-sample judging ran.
  if (s.samples && s.samples.length > 1) {
    return `${base} (${s.samples.map((x) => x.toFixed(2)).join(', ')})`;
  }
  return base;
}

function pairSection(p: PairResult): string {
  const lines: string[] = [];
  const splurge = p.reportOnly ? ' — REPORT-ONLY (splurge; never armed)' : '';
  lines.push(`### ${p.task} (${p.tier}) — ${p.kind} challenge${splurge}`);
  lines.push('');
  if (p.reportOnly) {
    lines.push('> **Splurge — report-only.** Scored for insight (is a cheaper model adequate for this belief-earning moment?). NEVER armed into `DEFAULT_TASK_CANDIDATES` regardless of clearance (§6.3).');
    lines.push('');
  }
  lines.push(`- Rubric: \`${p.rubricVersion}\``);
  lines.push(`- Incumbent \`${p.incumbent.model}\`: **${p.incumbent.aggregate.toFixed(3)}** (avg cost ${avgCostLabel(p.incumbent)})`);
  lines.push(`- Challenger \`${p.challenger.model}\`: **${p.challenger.aggregate.toFixed(3)}** (avg cost ${avgCostLabel(p.challenger)})`);
  if (p.costDeltaKnown) {
    const deltaSign = p.costDeltaMicroUsd <= 0 ? '' : '+';
    lines.push(`- Est. cost delta (challenger − incumbent): ${deltaSign}${usd(p.costDeltaMicroUsd)}/call`);
  } else {
    lines.push('- Est. cost delta (challenger − incumbent): N/A (challenger has no pinned price)');
  }
  lines.push(`- **Cleared: ${p.cleared ? 'YES' : 'no'}** — ${p.reason}`);
  if (p.reportOnly && p.cleared) {
    lines.push('  - NOTE: "cleared" here is informational — this splurge pair is NOT armed.');
  }
  lines.push('');
  const multi = p.incumbent.scores.some((s) => s.samples && s.samples.length > 1);
  lines.push(multi ? '| fixture | incumbent (median; samples) | challenger (median; samples) |' : '| fixture | incumbent | challenger |');
  lines.push('| --- | --- | --- |');
  for (let i = 0; i < p.incumbent.scores.length; i++) {
    const inc = p.incumbent.scores[i];
    const ch = p.challenger.scores[i];
    lines.push(`| ${inc.fixtureId} | ${scoreCell(inc)} | ${scoreCell(ch)} |`);
  }
  lines.push('');
  return lines.join('\n');
}

export function renderMarkdown(run: EvalRun): string {
  const cleared = run.pairs.filter((p) => p.cleared);
  // Only NON-reportOnly cleared pairs would actually be armed by --write.
  const armable = cleared.filter((p) => !p.reportOnly);
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
  head.push(`Cleared ${cleared.length} of ${run.pairs.length} pair(s); ${armable.length} armable (splurge report-only pairs are excluded from arming).`);
  if (armable.length > 0) {
    head.push('');
    head.push('Would arm (non-splurge cleared challengers):');
    for (const p of armable) {
      head.push(`- \`${p.task}\` → arm \`[${p.incumbent.model}, ${p.challenger.model}]\` (incumbent first).`);
    }
  }
  const clearedSplurge = cleared.filter((p) => p.reportOnly);
  if (clearedSplurge.length > 0) {
    head.push('');
    head.push('Report-only (splurge — scored "cleared" but NEVER armed, §6.3):');
    for (const p of clearedSplurge) {
      head.push(`- \`${p.task}\` vs \`${p.challenger.model}\` — insight only.`);
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
