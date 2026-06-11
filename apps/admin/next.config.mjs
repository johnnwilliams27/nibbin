/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@nibbin/shared'],
  // CI gates typecheck/lint; the deploy build just compiles (see apps/web).
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
};

export default nextConfig;
