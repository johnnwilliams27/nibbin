#!/usr/bin/env node
// copylint: mechanical enforcement of SPEC 14A. Zero dependencies.
//
// Scans every markdown file under trust-index/ and the apps/web source tree
// for em-dash characters and the banned vocabulary (word-boundary,
// case-insensitive).
//
// Exemptions: SPEC.md and any file whose basename starts with NOTES. Those
// files quote the banned words in order to name them.
//
// Severity: hits under docs/ or apps/web/ are errors (exit 1). Hits anywhere
// else are warnings (exit 0). Mechanical and imperfect, still worth having.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url)); // trust-index/

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'out',
  'cache',
  'coverage',
  'lib',
]);

const WEB_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.md', '.mdx', '.html']);

// SPEC 14A banned vocabulary, expanded to common inflections. "landscape" is
// flagged on every use; almost every use in this genre is the banned one.
const WORDS = [
  'delve', 'delves', 'delved', 'delving',
  'leverage', 'leverages', 'leveraged', 'leveraging',
  'robust', 'robustly', 'robustness',
  'seamless', 'seamlessly',
  'comprehensive', 'comprehensively',
  'holistic', 'holistically',
  'cutting-edge',
  'game-changing', 'game-changer',
  'revolutionize', 'revolutionizes', 'revolutionized', 'revolutionizing',
  'unlock', 'unlocks', 'unlocked', 'unlocking',
  'empower', 'empowers', 'empowered', 'empowering', 'empowerment',
  'supercharge', 'supercharges', 'supercharged', 'supercharging',
  'elevate', 'elevates', 'elevated', 'elevating',
  'streamline', 'streamlines', 'streamlined', 'streamlining',
  'harness', 'harnesses', 'harnessed', 'harnessing',
  'landscape', 'landscapes',
  'journey', 'journeys',
];

const PHRASES = ['dive deep', 'dives deep', 'diving deep', 'deep dive', 'deep dives', 'at its core', 'in essence'];

const CHECKS = [
  { name: 'em-dash', re: /—/g },
  {
    name: 'banned vocabulary',
    re: new RegExp(`\\b(${[...WORDS, ...PHRASES].join('|').replaceAll(' ', '\\s+')})\\b`, 'gi'),
  },
];

function isExempt(filePath) {
  const base = basename(filePath);
  return base === 'SPEC.md' || base.startsWith('NOTES');
}

function shouldScan(relPath) {
  const ext = extname(relPath);
  if (relPath.startsWith('apps/web/')) return WEB_EXTENSIONS.has(ext);
  return ext === '.md';
}

function isErrorScope(relPath) {
  return relPath.startsWith('docs/') || relPath.startsWith('apps/web/');
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walk(join(dir, entry.name));
    } else if (entry.isFile()) {
      yield join(dir, entry.name);
    }
  }
}

const errors = [];
const warnings = [];

if (!existsSync(ROOT)) {
  console.error(`copylint: root not found: ${ROOT}`);
  process.exit(2);
}

for (const filePath of walk(ROOT)) {
  const relPath = relative(ROOT, filePath);
  if (!shouldScan(relPath) || isExempt(relPath)) continue;

  const lines = readFileSync(filePath, 'utf8').split('\n');
  lines.forEach((line, i) => {
    for (const check of CHECKS) {
      check.re.lastIndex = 0;
      let m;
      while ((m = check.re.exec(line)) !== null) {
        const hit = {
          file: relPath,
          line: i + 1,
          check: check.name,
          match: check.name === 'em-dash' ? 'U+2014' : m[0],
        };
        (isErrorScope(relPath) ? errors : warnings).push(hit);
      }
    }
  });
}

for (const hit of warnings) {
  console.log(`warning ${hit.file}:${hit.line} [${hit.check}] ${hit.match}`);
}
for (const hit of errors) {
  console.log(`error   ${hit.file}:${hit.line} [${hit.check}] ${hit.match}`);
}

console.log(
  `copylint: ${errors.length} error(s), ${warnings.length} warning(s). ` +
    'Errors are hits in docs/ or apps/web/; see SPEC 14A.',
);
process.exit(errors.length > 0 ? 1 : 0);
