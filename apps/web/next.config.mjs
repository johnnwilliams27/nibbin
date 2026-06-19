import { withSentryConfig } from '@sentry/nextjs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pin the file-tracing root to the monorepo root (apps/web/../..) so the
  // outputFileTracingIncludes globs below resolve the hoisted @sparticuz/chromium
  // binary deterministically in CI/Vercel (not just via lockfile auto-detection).
  outputFileTracingRoot: resolve(__dirname, '../..'),
  transpilePackages: ['@nibbin/channels', '@nibbin/connectors', '@nibbin/creatures', '@nibbin/drip', '@nibbin/email', '@nibbin/keeper', '@nibbin/redaction', '@nibbin/router', '@nibbin/shared'],
  // The computer_use serverless launch drives @sparticuz/chromium via
  // `playwright-core` (lib/planner/browser.ts). Both are loaded via dynamic
  // `import()`; the specifiers are now STATIC LITERALS so nft can trace them, but
  // we ALSO force-include both packages' files here (belt-and-suspenders) so they
  // ship even if nft misses a transitive path. @sparticuz/chromium carries the
  // ~62 MB brotli chromium binary (inflated to /tmp at runtime, not shipped
  // decompressed); playwright-core is the bundled-browser-free driver engine.
  // Force-include on the routes that can launch it: the planner page (which hosts
  // the startPlanRun/respondToPlanRun Server Actions) and the channel webhooks
  // (which run plans inline via ingestInbound). Total stays comfortably under
  // Vercel's 250 MB unzipped function limit.
  outputFileTracingIncludes: {
    '/app/planner': [
      '../../node_modules/@sparticuz/chromium/**',
      '../../node_modules/playwright-core/**',
    ],
    '/api/channels/telegram': [
      '../../node_modules/@sparticuz/chromium/**',
      '../../node_modules/playwright-core/**',
    ],
    '/api/channels/sms': [
      '../../node_modules/@sparticuz/chromium/**',
      '../../node_modules/playwright-core/**',
    ],
    '/api/channels/whatsapp': [
      '../../node_modules/@sparticuz/chromium/**',
      '../../node_modules/playwright-core/**',
    ],
    // Legal pages read their HTML from reference/ at module load; trace the
    // files so they are bundled into the Vercel function output.
    '/privacy': ['../../reference/privacy.html'],
    '/terms': ['../../reference/terms.html'],
    '/data-ai': ['../../reference/data-ai.html'],
    '/subprocessors': ['../../reference/subprocessors.html'],
  },
  // CI gates typecheck and lint on every PR (npm run typecheck / lint / build),
  // so the deploy build must not re-run them — Vercel's production install omits
  // the root-level devDependencies (typescript, eslint, @types/node) that those
  // checks need, which otherwise fails the build. The deploy just compiles.
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
  // @nibbin/redaction (unlike the other workspace packages) uses NodeNext
  // `.js`-extension relative imports in its TS source (`from './ner.js'`).
  // webpack won't map those to `.ts` on its own, so teach the resolver to try
  // `.ts`/`.tsx` for a `.js` request (real `.js` still resolves — it's last).
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
};

// Source-map upload only happens when SENTRY_ORG/PROJECT/AUTH_TOKEN are set
// (Vercel prod); without them the wrapper builds normally and skips upload.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  widenClientFileUpload: true,
  silent: !process.env.CI,
  disableLogger: true,
});
