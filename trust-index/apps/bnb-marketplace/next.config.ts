import type { NextConfig } from 'next';

// Static export: the whole marketplace is a build-time render of data/agents.json.
// Nothing here needs a server at request time, so the deploy target can be Vercel,
// Netlify, GitHub Pages or any bucket. `out/` is the artifact.
const nextConfig: NextConfig = {
  output: 'export',
  // Keep the interactive preview separate from CI/build output during parallel work.
  distDir: process.env.NIBBIN_DEV_PREVIEW === '1' ? '.next-preview' : '.next',
  // This app is self-contained inside a larger monorepo; without this, Next
  // walks up and picks the repo-root lockfile as the tracing root.
  outputFileTracingRoot: import.meta.dirname,
  trailingSlash: true,
  images: { unoptimized: true },
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
