// Flat config scoped to the trust-index workspace. The host repo at ../ has
// its own eslint.config.mjs, which ignores trust-index/**; neither config
// applies to the other's tree.
//
// The eslint toolchain lives in scripts/ (standalone install, own lockfile),
// so typescript-eslint is resolved from scripts/node_modules explicitly
// rather than from whatever node_modules happens to sit above this file.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(new URL('./scripts/package.json', import.meta.url));
const tseslint = (await import(pathToFileURL(require.resolve('typescript-eslint')).href)).default;

// SPEC 22: the scoring package performs no I/O. Module names banned from
// packages/scoring, with and without the node: prefix, including subpaths.
const ioModules = ['fs', 'http', 'https', 'net', 'dns', 'child_process', 'worker_threads'];
const ioPatterns = ioModules.flatMap((m) => [m, `${m}/*`, `node:${m}`, `node:${m}/*`]);
ioPatterns.push('undici', 'undici/*');

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      // Foundry territory: Solidity sources and build artifacts.
      'contracts/**',
      // Committed golden data, not source.
      'fixtures/snapshots/**',
      '**/.next/**',
    ],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // SPEC 22 determinism rules, hard errors for the auditable core.
    // Tests are covered on purpose: golden tests must be deterministic too.
    files: ['packages/scoring/**/*.ts', 'packages/scoring/**/*.mts', 'packages/scoring/**/*.cts'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'Date',
          property: 'now',
          message: 'SPEC 22: no wall-clock reads in scoring. Use as_of_ts from the snapshot.',
        },
        {
          object: 'Math',
          property: 'random',
          message: 'SPEC 22: no nondeterminism in scoring.',
        },
        {
          object: 'performance',
          property: 'now',
          message: 'SPEC 22: no wall-clock reads in scoring.',
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message:
            'SPEC 22: new Date() with no arguments reads the wall clock. Use as_of_ts from the snapshot.',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ioPatterns,
              message: 'SPEC 22: the scoring package performs no I/O.',
            },
          ],
        },
      ],
    },
  },
);
