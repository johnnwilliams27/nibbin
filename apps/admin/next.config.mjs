import { withSentryConfig } from '@sentry/nextjs';

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@nibbin/shared'],
  // CI gates typecheck/lint; the deploy build just compiles (see apps/web).
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
