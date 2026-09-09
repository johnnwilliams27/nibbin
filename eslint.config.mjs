import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/coverage/**',
      'reference/**',
      'trust-index/**', // self-contained pnpm workspace with its own eslint.config.mjs

      'tools/grovemap/grovemap.html',
      'apps/web/next-env.d.ts',
      'apps/admin/next-env.d.ts',
    ],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
