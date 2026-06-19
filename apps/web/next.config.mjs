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
  // The computer_use serverless launch loads @sparticuz/chromium via a dynamic
  // import whose specifier is assembled at RUNTIME (lib/planner/browser.ts), so
  // Next's output-file-tracing (nft) can't statically discover it and won't bundle
  // the ~62 MB brotli chromium binary into the function. Force-include the package
  // (binary + build/) on the routes that can launch it: the planner page (which
  // hosts the startPlanRun/respondToPlanRun Server Actions) and the channel
  // webhooks (which run plans inline via ingestInbound). The .br files are ~67 MB
  // total — comfortably under Vercel's 250 MB unzipped function limit (Chromium is
  // inflated to /tmp at runtime, not shipped in the bundle).
  outputFileTracingIncludes: {
    '/app/planner': ['../../node_modules/@sparticuz/chromium/**'],
    '/api/channels/telegram': ['../../node_modules/@sparticuz/chromium/**'],
    '/api/channels/sms': ['../../node_modules/@sparticuz/chromium/**'],
    '/api/channels/whatsapp': ['../../node_modules/@sparticuz/chromium/**'],
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
