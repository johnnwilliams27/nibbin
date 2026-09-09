import type { NextConfig } from 'next';

// Static export: the whole marketplace is a build-time render of data/agents.json.
// Nothing here needs a server at request time, so the deploy target can be Vercel,
// Netlify, GitHub Pages or any bucket. `out/` is the artifact.
const nextConfig: NextConfig = {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
