import { withSentryConfig } from '@sentry/nextjs';

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@nibbin/creatures', '@nibbin/drip', '@nibbin/email', '@nibbin/keeper', '@nibbin/redaction', '@nibbin/router', '@nibbin/shared'],
  // CI gates typecheck and lint on every PR (npm run typecheck / lint / build),
  // so the deploy build must not re-run them — Vercel's production install omits
  // the root-level devDependencies (typescript, eslint, @types/node) that those
  // checks need, which otherwise fails the build. The deploy just compiles.
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
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
